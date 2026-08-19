"""Triggering eval — the Evaluation capability, run through ``ctx.llm``.

Does the skill *fire* on the right prompts and *stay silent* on the wrong
ones? The evaluator owns its method — it builds a prompt battery (positives
that should trigger the candidate, negatives that should not) and runs each
prompt against a selection roster where the profile's sibling skills act as
the distractor library. Model access is handed in: ``llm`` is Hermes'
``ctx.llm`` facade, the host-owned, audited entry to the user's active model.

The emitted evaluation result is a structured run-record plus an ``insight``
— it is never shown raw. ``render_insights`` is the plain-language surface.

Stdlib only, no imports from sibling modules — callers hand in the roster.
"""

import hashlib

NO_SKILL = "none"

_BATTERY_SCHEMA = {
    "type": "object",
    "properties": {
        "positives": {"type": "array", "items": {"type": "string"}},
        "negatives": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["positives", "negatives"],
}

_SELECT_SCHEMA = {
    "type": "object",
    "properties": {
        "selected": {
            "type": "string",
            "description": "The chosen skill's name, or 'none' when no skill applies",
        },
    },
    "required": ["selected"],
}

_INSIGHT_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["passed", "mixed", "failed"]},
        "summary": {"type": "string"},
        "findings": {"type": "array", "items": {"type": "string"}},
        "watch": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "summary", "findings", "watch"],
}


def _roster_block(roster):
    return "\n".join(
        f"- {entry['name']}: {entry['description'] or '(no description)'}"
        for entry in roster
    )


def _shuffled(roster, prompt):
    """Deterministic per-prompt roster order, so position never favours the candidate."""
    return sorted(
        roster,
        key=lambda entry: hashlib.sha256(
            (prompt + " " + entry["name"]).encode("utf-8")
        ).hexdigest(),
    )


def _build_battery(candidate, roster, llm, size, timeout):
    distractors = [e for e in roster if e["name"] != candidate["name"]]
    instructions = (
        "You are building a triggering eval for an agent skill. Write "
        f"{size} POSITIVE user prompts that clearly call for the candidate "
        f"skill, and {size} NEGATIVE user prompts that must NOT select it — "
        "make negatives realistic near-misses: requests that fit a competing "
        "skill below, or fit none of them. Prompts are one or two sentences, "
        "written the way a real user types."
    )
    body = f"Candidate skill:\n- {candidate['name']}: {candidate['description']}\n"
    if distractors:
        body += "\nCompeting skills:\n" + _roster_block(distractors)
    result = llm.complete_structured(
        instructions=instructions,
        input=[{"type": "text", "text": body}],
        json_schema=_BATTERY_SCHEMA,
        schema_name="agent-branch.battery",
        purpose="agent-branch.triggering-eval.battery",
        temperature=0.4,
        max_tokens=1024,
        timeout=timeout,
    )
    if result.parsed is None:
        return None
    positives = [p.strip() for p in result.parsed.get("positives", []) if p.strip()]
    negatives = [n.strip() for n in result.parsed.get("negatives", []) if n.strip()]
    return positives[:size], negatives[:size]


def _select(prompt, roster, llm, timeout):
    ordered = _shuffled(roster, prompt)
    instructions = (
        "You route user prompts to agent skills. Given the roster, pick the "
        "single skill that should handle the prompt, or 'none' when no skill "
        "applies. Judge only by the descriptions."
    )
    body = f"Roster:\n{_roster_block(ordered)}\n\nUser prompt:\n{prompt}"
    result = llm.complete_structured(
        instructions=instructions,
        input=[{"type": "text", "text": body}],
        json_schema=_SELECT_SCHEMA,
        schema_name="agent-branch.select",
        purpose="agent-branch.triggering-eval.select",
        temperature=0.0,
        max_tokens=128,
        timeout=timeout,
    )
    if result.parsed is None:
        return None
    selected = str(result.parsed.get("selected", NO_SKILL)).strip()
    known = {entry["name"] for entry in roster}
    return selected if selected in known else NO_SKILL


def _fallback_insight(totals):
    hit_rate = totals["positive_hits"], totals["positives"]
    silent_rate = totals["negative_correct"], totals["negatives"]
    perfect = hit_rate[0] == hit_rate[1] and silent_rate[0] == silent_rate[1]
    verdict = "passed" if perfect else (
        "failed" if hit_rate[0] == 0 else "mixed"
    )
    return {
        "verdict": verdict,
        "summary": (
            f"Fired on {hit_rate[0]} of {hit_rate[1]} prompts that should trigger it; "
            f"stayed silent on {silent_rate[0]} of {silent_rate[1]} that shouldn't."
        ),
        "findings": [],
        "watch": [],
    }


def _generate_insight(candidate, selections, totals, llm, timeout):
    runs = "\n".join(
        f"- prompt: {s['prompt']!r} expected: {s['expected']} got: {s['selected']}"
        + (" (HIT)" if s["hit"] else " (MISS)")
        for s in selections
    )
    try:
        result = llm.complete_structured(
            instructions=(
                "Interpret this triggering-eval run for the skill author in "
                "plain language. verdict: passed (clean), mixed, or failed. "
                "summary: one or two sentences on what the run showed. "
                "findings: concrete misfires and what in the description "
                "caused them. watch: things to keep an eye on."
            ),
            input=[{
                "type": "text",
                "text": f"Skill: {candidate['name']}: {candidate['description']}\n\nRuns:\n{runs}",
            }],
            json_schema=_INSIGHT_SCHEMA,
            schema_name="agent-branch.insight",
            purpose="agent-branch.triggering-eval.insight",
            temperature=0.0,
            max_tokens=512,
            timeout=timeout,
        )
        if result.parsed is not None:
            return result.parsed
    except Exception:  # noqa: BLE001 — insight is best-effort; totals still stand
        pass
    return _fallback_insight(totals)


def evaluate(candidate, roster, profile_name, llm, battery_size=4, timeout=60):
    """Run a triggering eval; emit the evaluation result (the run-record).

    ``candidate`` and every ``roster`` entry are ``{"name", "description"}``
    dicts; the roster includes the candidate. Model failures surface as an
    ``error`` field on the result rather than an exception.
    """
    result = {
        "kind": "triggering-eval",
        "profile": profile_name,
        "skill": candidate["name"],
        "roster_size": len(roster),
        "selections": [],
        "totals": {},
        "insight": None,
        "error": None,
    }
    try:
        battery = _build_battery(candidate, roster, llm, battery_size, timeout)
    except Exception as exc:  # noqa: BLE001 — reported on the result
        result["error"] = f"battery generation failed: {exc}"
        return result
    if battery is None:
        result["error"] = "battery generation returned no usable prompts"
        return result
    positives, negatives = battery
    if not positives or not negatives:
        result["error"] = "battery generation returned an empty side"
        return result

    selections = []
    for prompt, expected in [(p, candidate["name"]) for p in positives] + [
        (n, NO_SKILL) for n in negatives
    ]:
        try:
            selected = _select(prompt, roster, llm, timeout)
        except Exception as exc:  # noqa: BLE001 — reported per prompt
            selections.append(
                {"prompt": prompt, "expected": expected,
                 "selected": None, "hit": False, "error": str(exc)}
            )
            continue
        if selected is None:
            selections.append(
                {"prompt": prompt, "expected": expected,
                 "selected": None, "hit": False, "error": "unparseable selection"}
            )
            continue
        hit = (
            selected == expected
            if expected != NO_SKILL
            else selected != candidate["name"]
        )
        selections.append(
            {"prompt": prompt, "expected": expected, "selected": selected, "hit": hit}
        )
    result["selections"] = selections
    result["totals"] = {
        "positives": len(positives),
        "positive_hits": sum(
            1 for s in selections if s["expected"] != NO_SKILL and s["hit"]
        ),
        "negatives": len(negatives),
        "negative_correct": sum(
            1 for s in selections if s["expected"] == NO_SKILL and s["hit"]
        ),
    }
    result["insight"] = _generate_insight(
        candidate, selections, result["totals"], llm, timeout
    )
    return result


def render_insights(result):
    """The Insights surface — plain language the author can act on."""
    if result.get("error"):
        return (
            f"Triggering eval for '{result['skill']}' could not run: {result['error']}"
        )
    insight = result["insight"] or {}
    totals = result["totals"]
    lines = [
        f"Triggering eval — '{result['skill']}' in profile '{result['profile']}' "
        f"(against {result['roster_size'] - 1} competing skills): "
        f"{insight.get('verdict', 'mixed')}.",
        insight.get("summary", ""),
    ]
    if insight.get("findings"):
        lines.append("Findings:")
        lines.extend(f"- {item}" for item in insight["findings"])
    if insight.get("watch"):
        lines.append("Watch:")
        lines.extend(f"- {item}" for item in insight["watch"])
    misses = [s for s in result["selections"] if not s["hit"]]
    if misses:
        lines.append("Missed prompts:")
        lines.extend(
            f"- {s['prompt']!r} → {s['selected'] or 'no answer'} (expected {s['expected']})"
            for s in misses
        )
    lines.append(
        f"Scored {totals['positive_hits']}/{totals['positives']} positives, "
        f"{totals['negative_correct']}/{totals['negatives']} negatives."
    )
    return "\n".join(line for line in lines if line)

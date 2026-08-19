"""agent-branch plugin — registration.

Wires the two capabilities onto Hermes surfaces:

- Profile analysis (offline, deterministic) — tool, ``/branch analyze``,
  ``hermes agent-branch analyze``.
- Triggering eval (model-backed, through ``ctx.llm``) — tool,
  ``/branch eval``, ``hermes agent-branch eval``.

The desktop pane (``desktop/plugin.js``) and dashboard backend
(``dashboard/plugin_api.py``) render the same artifacts read-only.
"""

import json
import logging

from . import analysis, profiles, records, schemas, triggering_eval

logger = logging.getLogger(__name__)

_USAGE = (
    "Usage: /branch profiles | analyze [profile] | eval <skill> [profile] "
    "| insights [profile]"
)


def _config(ctx):
    return {
        "battery_size": int(ctx.get_config("battery_size", default=4)),
        "max_skills": int(ctx.get_config("max_skills", default=64)),
        "eval_timeout": int(ctx.get_config("eval_timeout", default=60)),
    }


def _snapshot_or_error(name, max_skills):
    snapshot = profiles.profile_snapshot(name or "default", max_skills=max_skills)
    if snapshot is None:
        known = ", ".join(p["name"] for p in profiles.list_profiles()) or "(none)"
        return None, f"No profile named '{name}'. Profiles here: {known}."
    return snapshot, None


def _roster(snapshot):
    return [
        {"name": s["name"] or s["dir_name"], "description": s["description"]}
        for s in snapshot["skills"]
        if s["present"] and not s["truncated"]
    ]


def _run_eval(ctx, skill_name, profile_name):
    """Shared by the tool, slash command, and CLI. Returns (result, error)."""
    cfg = _config(ctx)
    snapshot, error = _snapshot_or_error(profile_name, cfg["max_skills"])
    if error:
        return None, error
    roster = _roster(snapshot)
    candidate = next(
        (e for e in roster if e["name"] == skill_name),
        None,
    ) or next(
        (
            {"name": s["name"] or s["dir_name"], "description": s["description"]}
            for s in snapshot["skills"]
            if s["dir_name"] == skill_name and s["present"]
        ),
        None,
    )
    if candidate is None:
        known = ", ".join(s["dir_name"] for s in snapshot["skills"]) or "(none)"
        return None, (
            f"No skill '{skill_name}' in profile '{snapshot['name']}'. "
            f"Skills there: {known}."
        )
    if not candidate["description"]:
        return None, (
            f"Skill '{skill_name}' has no description, so a triggering eval "
            "cannot run. Run the profile analysis first and fix the description."
        )
    result = triggering_eval.evaluate(
        candidate,
        roster,
        snapshot["name"],
        ctx.llm,
        battery_size=cfg["battery_size"],
        timeout=cfg["eval_timeout"],
    )
    if not result.get("error"):
        try:
            records.save_record(result)
        except Exception:  # noqa: BLE001 — persistence must not eat the result
            logger.exception("agent-branch: failed to persist evaluation record")
    return result, None


# --- tools -----------------------------------------------------------------


def _profiles_summary(max_skills):
    rows = []
    for entry in profiles.list_profiles():
        snapshot = profiles.profile_snapshot(entry["name"], max_skills=max_skills)
        if snapshot is None:
            continue
        artifact = analysis.analyze(snapshot)
        rows.append(
            {
                "name": entry["name"],
                "path": entry["path"],
                "skills": artifact["skill_count"],
                "score": artifact["score"],
                "findings": sum(artifact["counts"].values()),
            }
        )
    return rows


def _tool_profiles(ctx, args, **kwargs):
    try:
        return json.dumps({"profiles": _profiles_summary(_config(ctx)["max_skills"])})
    except Exception as exc:  # noqa: BLE001 — tools return error JSON, never raise
        return json.dumps({"error": f"profile listing failed: {exc}"})


def _tool_analyze(ctx, args, **kwargs):
    try:
        snapshot, error = _snapshot_or_error(
            (args.get("profile") or "default").strip(), _config(ctx)["max_skills"]
        )
        if error:
            return json.dumps({"error": error})
        return json.dumps(analysis.analyze(snapshot))
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": f"analysis failed: {exc}"})


def _tool_eval(ctx, args, **kwargs):
    try:
        skill = (args.get("skill") or "").strip()
        if not skill:
            return json.dumps({"error": "Pass the skill's directory name."})
        result, error = _run_eval(ctx, skill, (args.get("profile") or "default").strip())
        if error:
            return json.dumps({"error": error})
        return json.dumps(
            {
                "skill": result["skill"],
                "profile": result["profile"],
                "error": result["error"],
                "totals": result["totals"],
                "insight": result["insight"],
                "insights_text": triggering_eval.render_insights(result),
            }
        )
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": f"triggering eval failed: {exc}"})


# --- slash command ---------------------------------------------------------


def _handle_branch(ctx, raw_args):
    parts = raw_args.split()
    verb = parts[0] if parts else "help"
    try:
        if verb == "profiles":
            rows = _profiles_summary(_config(ctx)["max_skills"])
            if not rows:
                return "No Hermes profiles found."
            return "\n".join(
                f"{row['name']}: score {row['score']}/100, {row['skills']} skills, "
                f"{row['findings']} findings"
                for row in rows
            )
        if verb == "analyze":
            snapshot, error = _snapshot_or_error(
                parts[1] if len(parts) > 1 else "default",
                _config(ctx)["max_skills"],
            )
            if error:
                return error
            return analysis.render_analysis(analysis.analyze(snapshot))
        if verb == "eval":
            if len(parts) < 2:
                return "Usage: /branch eval <skill> [profile]"
            result, error = _run_eval(
                ctx, parts[1], parts[2] if len(parts) > 2 else "default"
            )
            return error or triggering_eval.render_insights(result)
        if verb == "insights":
            profile = parts[1] if len(parts) > 1 else None
            rows = records.list_records(profile=profile, limit=10)
            if not rows:
                return "No past runs yet. Run one with /branch eval <skill> [profile]."
            return "\n".join(
                f"{row['created_at']} — {row['skill']} ({row['profile']}): "
                + (
                    row["error"]
                    or f"{row['verdict']} — {(row['insight'] or {}).get('summary', '')}"
                )
                for row in rows
            )
        return _USAGE
    except Exception as exc:  # noqa: BLE001 — a slash command answers, never raises
        logger.exception("agent-branch: /branch %s failed", verb)
        return f"/branch {verb} failed: {exc}"


# --- CLI -------------------------------------------------------------------


def _make_cli(ctx):
    def handler(args):
        verb = getattr(args, "branch_command", None)
        if verb == "profiles":
            print(_handle_branch(ctx, "profiles"))
        elif verb == "analyze":
            print(_handle_branch(ctx, f"analyze {args.profile}"))
        elif verb == "eval":
            print(_handle_branch(ctx, f"eval {args.skill} {args.profile}"))
        elif verb == "insights":
            print(_handle_branch(ctx, f"insights {args.profile}".rstrip()))
        else:
            print("Usage: hermes agent-branch <profiles|analyze|eval|insights>")

    def setup(subparser):
        subs = subparser.add_subparsers(dest="branch_command")
        subs.add_parser("profiles", help="List profiles with quality scores")
        analyze = subs.add_parser("analyze", help="Analyse a profile's configuration")
        analyze.add_argument("profile", nargs="?", default="default")
        run = subs.add_parser("eval", help="Run a triggering eval for a skill")
        run.add_argument("skill")
        run.add_argument("profile", nargs="?", default="default")
        insights = subs.add_parser("insights", help="Show past run Insights")
        insights.add_argument("profile", nargs="?", default="")
        subparser.set_defaults(func=handler)

    return setup, handler


def register(ctx):
    ctx.register_tool(
        name="agent_branch_profiles",
        toolset="agent-branch",
        schema=schemas.PROFILES,
        handler=lambda args, **kwargs: _tool_profiles(ctx, args, **kwargs),
    )
    ctx.register_tool(
        name="agent_branch_analyze",
        toolset="agent-branch",
        schema=schemas.ANALYZE,
        handler=lambda args, **kwargs: _tool_analyze(ctx, args, **kwargs),
    )
    ctx.register_tool(
        name="agent_branch_triggering_eval",
        toolset="agent-branch",
        schema=schemas.TRIGGERING_EVAL,
        handler=lambda args, **kwargs: _tool_eval(ctx, args, **kwargs),
    )
    ctx.register_command(
        "branch",
        handler=lambda raw: _handle_branch(ctx, raw),
        description="agent.branch — profile analysis and skill triggering evals",
        args_hint="profiles | analyze [profile] | eval <skill> [profile] | insights [profile]",
    )
    setup, handler = _make_cli(ctx)
    ctx.register_cli_command(
        name="agent-branch",
        help="Profile analysis and skill triggering evals",
        setup_fn=setup,
        handler_fn=handler,
    )

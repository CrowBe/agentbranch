"""Profile analysis — the pure, offline Analysis capability.

``analyze(snapshot)`` reads a profile snapshot (see profiles.py) and emits a
deterministic artifact: findings with exact path/line evidence, an actionable
fix per finding, and a quality score. No I/O, no model call — the same
snapshot always produces the same artifact.

Stdlib only, no imports from sibling modules — the dashboard backend loads
this file directly via importlib.
"""

import re

SEVERITY_DEDUCTION = {"error": 15, "warning": 7, "info": 2}

_TRIGGER_CUE_RE = re.compile(
    r"\buse (this|when|it)\b|\bwhen (the user|asked|you)\b|\btrigger", re.IGNORECASE
)

_MIN_DESCRIPTION_CHARS = 40
_MAX_DESCRIPTION_CHARS = 1024
_MIN_BODY_CHARS = 200
_OVERLAP_THRESHOLD = 0.5

_STOPWORDS = frozenset(
    "a an and are as at be but by for from has have if in into is it its of on or "
    "that the this to use used using when with you your".split()
)


def _finding(fid, severity, message, fix, path=None, line=None):
    finding = {"id": fid, "severity": severity, "message": message, "fix": fix}
    if path is not None:
        finding["evidence"] = {"path": path}
        if line is not None:
            finding["evidence"]["line"] = line
    return finding


def _content_tokens(text):
    return {
        token
        for token in re.findall(r"[a-z0-9]+", text.lower())
        if len(token) > 2 and token not in _STOPWORDS
    }


def _profile_findings(snapshot):
    findings = []
    if not snapshot["config"]["present"]:
        findings.append(
            _finding(
                "P001", "warning",
                "config.yaml is missing — this profile runs entirely on defaults.",
                "Create config.yaml in the profile root (hermes -p <name> config) so the profile's behaviour is explicit.",
                path="config.yaml",
            )
        )
    elif snapshot["config"].get("parse_error"):
        findings.append(
            _finding(
                "P002", "error",
                "config.yaml does not parse: " + snapshot["config"]["parse_error"],
                "Fix the YAML syntax — a broken config silently falls back to defaults.",
                path="config.yaml",
            )
        )
    if not snapshot["soul"]["present"] or snapshot["soul"]["chars"] == 0:
        findings.append(
            _finding(
                "P010", "warning",
                "SOUL.md is missing or empty — the profile has no persona.",
                "Write SOUL.md so this profile behaves distinctly from its siblings.",
                path="SOUL.md",
            )
        )
    if not snapshot["memory"]["present"]:
        findings.append(
            _finding(
                "P011", "info",
                "memories/MEMORY.md is missing — the profile starts every session cold.",
                "Let the agent curate MEMORY.md, or seed it with durable project context.",
                path="memories/MEMORY.md",
            )
        )
    if not snapshot["user"]["present"]:
        findings.append(
            _finding(
                "P012", "info",
                "memories/USER.md is missing — the profile knows nothing about its user.",
                "Seed USER.md with who the profile works for and how they like to work.",
                path="memories/USER.md",
            )
        )
    if not snapshot["skills"]:
        findings.append(
            _finding(
                "P020", "info",
                "The profile has no skills.",
                "Add skills under skills/<name>/SKILL.md to give the profile reusable procedures.",
                path="skills",
            )
        )
    if snapshot.get("skills_capped"):
        findings.append(
            _finding(
                "P021", "info",
                "Skill count exceeds the analysis bound — only the first batch was analysed.",
                "Raise max_skills in the plugin settings, or split the profile.",
                path="skills",
            )
        )
    return findings


def _skill_findings(skill):
    findings = []
    path = skill["path"]
    if not skill["present"]:
        findings.append(
            _finding(
                "S000", "error",
                f"skills/{skill['dir_name']}/ has no SKILL.md.",
                "Add a SKILL.md, or remove the empty directory.",
                path=path,
            )
        )
        return findings
    if skill["truncated"]:
        findings.append(
            _finding(
                "S009", "info",
                "SKILL.md exceeds the read bound and was skipped.",
                "Move bulk reference material into companion files and keep SKILL.md lean.",
                path=path,
            )
        )
        return findings
    if skill["frontmatter_error"]:
        findings.append(
            _finding(
                "S001", "error",
                "SKILL.md frontmatter is broken: " + skill["frontmatter_error"] + ".",
                "Open the file with a '---' fenced block containing name and description.",
                path=path, line=1,
            )
        )
        return findings
    if not skill["name"]:
        findings.append(
            _finding(
                "S002", "error",
                "The skill declares no name.",
                "Add 'name:' to the frontmatter, matching the directory name.",
                path=path, line=skill["name_line"] or 1,
            )
        )
    elif skill["name"] != skill["dir_name"]:
        findings.append(
            _finding(
                "S003", "warning",
                f"Frontmatter name '{skill['name']}' differs from directory '{skill['dir_name']}'.",
                "Make them match — mismatches break addressing and installs.",
                path=path, line=skill["name_line"],
            )
        )
    description = skill["description"]
    if not description:
        findings.append(
            _finding(
                "S004", "error",
                "The skill has no description — it can never be selected.",
                "Add a 'description:' that says what the skill does and when to use it.",
                path=path, line=skill["description_line"] or 1,
            )
        )
    else:
        if len(description) < _MIN_DESCRIPTION_CHARS:
            findings.append(
                _finding(
                    "S005", "warning",
                    f"The description is {len(description)} characters — too thin to trigger reliably.",
                    "Say what the skill does and the situations it should fire in.",
                    path=path, line=skill["description_line"],
                )
            )
        if len(description) > _MAX_DESCRIPTION_CHARS:
            findings.append(
                _finding(
                    "S006", "warning",
                    f"The description is {len(description)} characters — long descriptions crowd the selection prompt.",
                    "Tighten it; move detail into the body.",
                    path=path, line=skill["description_line"],
                )
            )
        if not _TRIGGER_CUE_RE.search(description):
            findings.append(
                _finding(
                    "S007", "info",
                    "The description never says when to use the skill.",
                    "Add an explicit cue ('Use when …') so selection has something to match on.",
                    path=path, line=skill["description_line"],
                )
            )
    if skill["body_chars"] < _MIN_BODY_CHARS:
        findings.append(
            _finding(
                "S008", "warning",
                f"The body is {skill['body_chars']} characters — too thin to change behaviour.",
                "Write the actual procedure: steps, boundaries, and failure handling.",
                path=path,
            )
        )
    return findings


def _overlap_findings(skills):
    findings = []
    described = [s for s in skills if s.get("description")]
    for i, first in enumerate(described):
        first_tokens = _content_tokens(first["description"])
        if not first_tokens:
            continue
        for second in described[i + 1 :]:
            second_tokens = _content_tokens(second["description"])
            if not second_tokens:
                continue
            union = first_tokens | second_tokens
            jaccard = len(first_tokens & second_tokens) / len(union)
            if jaccard >= _OVERLAP_THRESHOLD:
                findings.append(
                    _finding(
                        "X001", "warning",
                        f"Descriptions of '{first['dir_name']}' and '{second['dir_name']}' overlap "
                        f"({int(jaccard * 100)}% shared vocabulary) — selection between them is ambiguous.",
                        "Differentiate the descriptions, or merge the skills.",
                        path=first["path"], line=first["description_line"],
                    )
                )
    return findings


def analyze(snapshot):
    """Emit the profile-analysis artifact for one snapshot."""
    findings = _profile_findings(snapshot)
    for skill in snapshot["skills"]:
        findings.extend(_skill_findings(skill))
    findings.extend(_overlap_findings(snapshot["skills"]))
    findings.sort(
        key=lambda f: (
            f.get("evidence", {}).get("path", ""),
            f.get("evidence", {}).get("line", 0),
            f["id"],
        )
    )
    score = 100
    counts = {"error": 0, "warning": 0, "info": 0}
    for finding in findings:
        counts[finding["severity"]] += 1
        score -= SEVERITY_DEDUCTION[finding["severity"]]
    return {
        "kind": "profile-analysis",
        "profile": snapshot["name"],
        "score": max(score, 0),
        "counts": counts,
        "skill_count": len(snapshot["skills"]),
        "findings": findings,
    }


def render_analysis(artifact):
    """Plain-language rendering of an analysis artifact."""
    lines = [
        f"Profile '{artifact['profile']}' — quality score {artifact['score']}/100 "
        f"({artifact['skill_count']} skills)."
    ]
    if not artifact["findings"]:
        lines.append("No findings — the configuration is in good shape.")
        return "\n".join(lines)
    for finding in artifact["findings"]:
        evidence = finding.get("evidence", {})
        where = evidence.get("path", "")
        if evidence.get("line"):
            where += f":{evidence['line']}"
        prefix = {"error": "✗", "warning": "!", "info": "·"}[finding["severity"]]
        lines.append(f"{prefix} [{where}] {finding['message']}")
        lines.append(f"    fix: {finding['fix']}")
    return "\n".join(lines)

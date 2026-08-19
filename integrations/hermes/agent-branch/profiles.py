"""Profile discovery and source snapshots for Hermes profiles.

A Hermes profile is a HERMES_HOME directory: the default profile is the root
itself (``~/.hermes``), named profiles live under ``<root>/profiles/<name>/``.

A snapshot is a bounded, read-only view of the configuration surface of one
profile: config presence, persona/memory files, and every skill's SKILL.md
with line-accurate frontmatter positions so findings can point at the exact
line that produced them. Nothing here is executed, and secret-bearing files
(``.env``, ``auth.json``, sessions, credentials) are never read.

Stdlib only, no imports from sibling modules — the dashboard backend loads
this file directly via importlib.
"""

import os
import re
from pathlib import Path

# Files that are never read, whatever a profile contains.
_NEVER_READ = {".env", "auth.json", "credentials.json"}

MAX_FILE_BYTES = 256 * 1024

_PROFILE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def hermes_root() -> Path:
    """The Hermes root directory (the one that owns ``profiles/``)."""
    env = os.environ.get("HERMES_HOME")
    if env:
        path = Path(env).expanduser()
        # When HERMES_HOME points inside a profile, the root is its grandparent.
        if path.parent.name == "profiles":
            return path.parent.parent
        return path
    return Path.home() / ".hermes"


def list_profiles(root=None):
    """Every profile under *root*: the default profile plus named ones."""
    root = Path(root) if root else hermes_root()
    profiles = []
    if root.is_dir():
        profiles.append({"name": "default", "path": str(root)})
    profiles_dir = root / "profiles"
    if profiles_dir.is_dir():
        for child in sorted(profiles_dir.iterdir()):
            if child.is_dir() and _PROFILE_ID_RE.match(child.name):
                profiles.append({"name": child.name, "path": str(child)})
    return profiles


def resolve_profile(name, root=None):
    """Path of the named profile, or None when it doesn't exist."""
    root = Path(root) if root else hermes_root()
    if not name or name == "default":
        return root if root.is_dir() else None
    if not _PROFILE_ID_RE.match(name):
        return None
    path = root / "profiles" / name
    return path if path.is_dir() else None


def _read_bounded(path: Path):
    """(text, truncated) — never raises, never reads secret files."""
    if path.name in _NEVER_READ:
        return None, False
    try:
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            return None, True
        return path.read_text(encoding="utf-8", errors="replace"), False
    except OSError:
        return None, False


def _parse_frontmatter(text):
    """Tolerant SKILL.md frontmatter scan with line numbers (1-based).

    Returns (fields, body_start_line, error). ``fields`` maps key ->
    {"value": str, "line": int}. Handles plain scalars and simple folded /
    indented continuations, which covers the Agent Skills frontmatter shape
    (``name``, ``description``). Not a YAML parser by design — the point is
    line-accurate evidence, not full YAML.
    """
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, 1, "missing frontmatter block"
    fields = {}
    current = None
    for idx in range(1, len(lines)):
        line = lines[idx]
        if line.strip() == "---":
            return fields, idx + 2, None
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if match:
            value = match.group(2).strip()
            if value in (">", "|", ">-", "|-"):
                value = ""
            current = match.group(1)
            fields[current] = {"value": value, "line": idx + 1}
        elif current and line.startswith((" ", "\t")) and line.strip():
            joined = (fields[current]["value"] + " " + line.strip()).strip()
            fields[current]["value"] = joined
    return fields, len(lines) + 1, "unterminated frontmatter block"


def _skill_entry(skill_dir: Path, profile_root: Path):
    skill_md = skill_dir / "SKILL.md"
    rel = str(skill_md.relative_to(profile_root))
    entry = {
        "dir_name": skill_dir.name,
        "path": rel,
        "present": skill_md.is_file(),
        "truncated": False,
        "frontmatter_error": None,
        "name": "",
        "name_line": None,
        "description": "",
        "description_line": None,
        "body_chars": 0,
    }
    if not entry["present"]:
        return entry
    text, truncated = _read_bounded(skill_md)
    entry["truncated"] = truncated
    if text is None:
        return entry
    fields, body_start, error = _parse_frontmatter(text)
    entry["frontmatter_error"] = error
    if "name" in fields:
        entry["name"] = fields["name"]["value"]
        entry["name_line"] = fields["name"]["line"]
    if "description" in fields:
        entry["description"] = fields["description"]["value"]
        entry["description_line"] = fields["description"]["line"]
    body_lines = text.split("\n")[body_start - 1 :]
    entry["body_chars"] = len("\n".join(body_lines).strip())
    return entry


def _file_facts(path: Path):
    if not path.is_file():
        return {"present": False, "chars": 0}
    text, truncated = _read_bounded(path)
    if text is None:
        return {"present": True, "chars": -1 if truncated else 0}
    return {"present": True, "chars": len(text.strip())}


def profile_snapshot(name, root=None, max_skills=64):
    """A bounded configuration snapshot of one profile, or None if missing."""
    profile_root = resolve_profile(name, root)
    if profile_root is None:
        return None
    snapshot = {
        "name": name or "default",
        "root": str(profile_root),
        "config": {"present": False},
        "soul": _file_facts(profile_root / "SOUL.md"),
        "memory": _file_facts(profile_root / "memories" / "MEMORY.md"),
        "user": _file_facts(profile_root / "memories" / "USER.md"),
        "skills": [],
        "skills_capped": False,
    }
    config_path = profile_root / "config.yaml"
    if config_path.is_file():
        snapshot["config"]["present"] = True
        text, truncated = _read_bounded(config_path)
        snapshot["config"]["parse_error"] = None
        if text is not None and not truncated:
            try:
                import yaml  # available inside the Hermes runtime

                yaml.safe_load(text)
            except ImportError:
                pass
            except Exception as exc:  # noqa: BLE001 — reported as a finding
                snapshot["config"]["parse_error"] = str(exc).split("\n")[0][:200]
    skills_dir = profile_root / "skills"
    if skills_dir.is_dir():
        skill_dirs = sorted(
            child for child in skills_dir.iterdir() if child.is_dir()
        )
        if len(skill_dirs) > max_skills:
            snapshot["skills_capped"] = True
            skill_dirs = skill_dirs[:max_skills]
        for skill_dir in skill_dirs:
            snapshot["skills"].append(_skill_entry(skill_dir, profile_root))
    return snapshot

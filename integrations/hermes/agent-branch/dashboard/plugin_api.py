"""Backend routes for the agent-branch desktop pane.

Mounted under ``/api/plugins/agent-branch/`` inside the gateway process.
Read-only by design: analysis artifacts recompute on request (they are never
persisted), and eval runs are only *read* here — running one costs tokens and
stays on the agent surfaces (``/branch eval``, the tool, the CLI).

Sibling modules are loaded by file path because this file is imported by the
dashboard mount, outside the plugin package's namespaced import.
"""

import importlib.util
from pathlib import Path

from fastapi import APIRouter

_PLUGIN_ROOT = Path(__file__).resolve().parent.parent


def _load(name):
    spec = importlib.util.spec_from_file_location(
        f"agent_branch_dashboard_{name}", _PLUGIN_ROOT / f"{name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_profiles = _load("profiles")
_analysis = _load("analysis")
_records = _load("records")

router = APIRouter()


@router.get("/profiles")
async def profiles():
    rows = []
    for entry in _profiles.list_profiles():
        snapshot = _profiles.profile_snapshot(entry["name"])
        if snapshot is None:
            continue
        artifact = _analysis.analyze(snapshot)
        rows.append(
            {
                "name": entry["name"],
                "skills": artifact["skill_count"],
                "score": artifact["score"],
                "counts": artifact["counts"],
            }
        )
    return {"profiles": rows}


@router.get("/analysis")
async def analysis(profile: str = "default"):
    snapshot = _profiles.profile_snapshot(profile)
    if snapshot is None:
        return {"error": f"no profile named '{profile}'"}
    return _analysis.analyze(snapshot)


@router.get("/insights")
async def insights(profile: str = "", limit: int = 10):
    return {
        "records": _records.list_records(
            profile=profile or None, limit=max(1, min(limit, 50))
        )
    }

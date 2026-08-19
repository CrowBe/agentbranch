"""Evaluation records — the persisted, append-only side of eval runs.

An evaluation result is ephemeral; saving it here turns it into an
evaluation record so the desktop pane and later sessions can re-render past
Insights. Storage goes through Hermes' per-plugin data root when available
(``plugins.plugin_storage.plugin_db``) and falls back to a local SQLite file
under ``AGENT_BRANCH_DATA_DIR`` outside the Hermes runtime (tests, the
dashboard backend loaded standalone).
"""

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

PLUGIN_ID = "agent-branch"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS eval_runs (
    id TEXT PRIMARY KEY,
    profile TEXT NOT NULL,
    skill TEXT NOT NULL,
    created_at TEXT NOT NULL,
    verdict TEXT,
    record_json TEXT NOT NULL
)
"""


def _connect():
    try:
        from plugins.plugin_storage import plugin_db

        conn = plugin_db(PLUGIN_ID)
    except ImportError:
        data_dir = Path(
            os.environ.get("AGENT_BRANCH_DATA_DIR")
            or Path.home() / ".hermes" / "plugin-data" / PLUGIN_ID
        )
        data_dir.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(data_dir / "data.db")
    conn.execute(_SCHEMA)
    return conn


def save_record(result):
    """Persist one evaluation result; returns the record id."""
    record_id = uuid.uuid4().hex
    verdict = (result.get("insight") or {}).get("verdict")
    conn = _connect()
    try:
        with conn:
            conn.execute(
                "INSERT INTO eval_runs (id, profile, skill, created_at, verdict, record_json) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    record_id,
                    result.get("profile", "default"),
                    result.get("skill", ""),
                    datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    verdict,
                    json.dumps(result),
                ),
            )
    finally:
        conn.close()
    return record_id


def list_records(profile=None, limit=20):
    """Most recent evaluation records, newest first."""
    conn = _connect()
    try:
        query = (
            "SELECT id, profile, skill, created_at, verdict, record_json "
            "FROM eval_runs"
        )
        params = []
        if profile:
            query += " WHERE profile = ?"
            params.append(profile)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(int(limit))
        rows = conn.execute(query, params).fetchall()
    finally:
        conn.close()
    records = []
    for row in rows:
        record = json.loads(row[5])
        records.append(
            {
                "id": row[0],
                "profile": row[1],
                "skill": row[2],
                "created_at": row[3],
                "verdict": row[4],
                "insight": record.get("insight"),
                "totals": record.get("totals"),
                "error": record.get("error"),
            }
        )
    return records

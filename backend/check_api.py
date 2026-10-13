"""Checks for the task API: partial updates, UTC timestamps, status timestamps, restore.

Runs the API in-process against a temporary copy of data/tasks.db, so it needs no running server
and never touches real data. Run: task check-api
"""
import shutil
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from loguru import logger

logger.remove()
logger.add(sys.stderr, format="{level: <8} | {message}")

import database

with tempfile.TemporaryDirectory() as tmp:
    database.DB_PATH = Path(tmp) / "tasks.db"
    real_db = Path(__file__).resolve().parent.parent / "data" / "tasks.db"
    if real_db.exists():
        shutil.copy(real_db, database.DB_PATH)  # old rows exercise the UTC migration

    from app import app

    with TestClient(app) as api:  # runs startup: init_db + migration
        logs = api.get("/api/audit").json()
        assert all(l["timestamp"].endswith("+00:00") for l in logs if l["timestamp"]), "non-UTC timestamp after migration"
        stamps = [l["timestamp"] for l in logs]
        assert stamps == sorted(stamps, reverse=True), "activity log not newest first"
        logger.success(f"{len(logs)} log rows, all UTC and newest first")

        assert api.get("/api/tasks/nope").status_code == 404
        api.post("/api/tasks", json={"id": "chk1", "title": "Check", "description": "original notes", "status": "Pending"}).raise_for_status()

        # Two editors, different fields: both survive
        api.patch("/api/tasks/chk1", json={"description": "agent results", "actor": "AI:checker"}).raise_for_status()
        task = api.patch("/api/tasks/chk1", json={"status": "in_progress", "actor": "USER"}).json()
        assert task["description"] == "agent results" and task["status"] == "In Progress", task
        assert task["started_at"].endswith("+00:00")
        logger.success("PATCH changes only the fields sent")

        task = api.patch("/api/tasks/chk1", json={"status": "Needs Review"}).json()
        assert task["completed_at"] and task["duration_ms"] is not None, task
        newest = api.get("/api/audit").json()[0]
        assert newest["updateSummary"] == "Task 'Check' updated to Needs Review", newest
        logger.success("status change records completed_at and duration_ms")

        snapshot = api.get("/api/tasks/chk1").json()
        api.delete("/api/tasks/chk1").raise_for_status()
        api.post("/api/tasks?restore=true", json={**snapshot, "actor": "USER"}).raise_for_status()
        restored = api.get("/api/tasks/chk1").json()
        assert restored["started_at"] == snapshot["started_at"] and restored["status"] == "Needs Review", restored
        assert api.get("/api/audit").json()[0]["action"] == "RESTORE_TASK"
        logger.success("delete + restore keeps the task's history")

print("all API checks passed")

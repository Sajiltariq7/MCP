"""Checks for the task API: partial updates, UTC timestamps, lifecycle rules, comments, evidence, restore.

Runs the API in-process against a temporary copy of data/tasks.db, so it needs no running server
and never touches real data. Run: task check-api
"""
import base64
import shutil
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from loguru import logger

logger.remove()
logger.add(sys.stderr, format="{level: <8} | {message}")

import database

PNG = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")).decode()

with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    database.DB_PATH = Path(tmp) / "tasks.db"
    database.ATTACH_DIR = Path(tmp) / "attachments"
    real_db = Path(__file__).resolve().parent.parent / "data" / "tasks.db"
    if real_db.exists():
        shutil.copy(real_db, database.DB_PATH)  # old rows exercise the migrations

    import app as app_module
    app_module.ATTACH_DIR = database.ATTACH_DIR

    with TestClient(app_module.app) as api:  # runs startup: init_db + migrations
        logs = api.get("/api/audit").json()
        assert all(l["timestamp"].endswith("+00:00") for l in logs if l["timestamp"]), "non-UTC timestamp after migration"
        stamps = [l["timestamp"] for l in logs]
        assert stamps == sorted(stamps, reverse=True), "activity log not newest first"
        logger.success(f"{len(logs)} log rows, all UTC and newest first")

        assert api.get("/api/tasks/nope").status_code == 404
        # A new task is always Pending, whatever status is sent
        api.post("/api/tasks", json={"id": "chk1", "title": "Check", "description": "original notes", "status": "Completed",
                                     "evidence_type": "screenshot", "evidence_note": "the login page"}).raise_for_status()
        task = api.get("/api/tasks/chk1").json()
        assert task["status"] == "Pending" and task["evidence_type"] == "screenshot", task
        logger.success("new tasks always start in Pending")

        # Two editors, different fields: both survive
        api.patch("/api/tasks/chk1", json={"description": "agent results", "actor": "AI:checker"}).raise_for_status()
        r = api.patch("/api/tasks/chk1", json={"status": "Needs Review"})
        assert r.status_code == 409 and "In Progress first" in r.json()["detail"], r.text
        assert api.patch("/api/tasks/chk1", json={"status": "Completed"}).status_code == 409
        task = api.patch("/api/tasks/chk1", json={"status": "in_progress", "actor": "USER"}).json()
        assert task["description"] == "agent results" and task["status"] == "In Progress", task
        assert task["started_at"].endswith("+00:00")
        assert api.patch("/api/tasks/chk1", json={"status": "Completed"}).status_code == 409
        logger.success("PATCH changes only the fields sent; Pending and In Progress can't skip ahead")

        # Evidence: no review without a screenshot
        r = api.patch("/api/tasks/chk1", json={"status": "Needs Review"})
        assert r.status_code == 409 and "screenshot" in r.json()["detail"], r.text
        assert api.post("/api/tasks/chk1/attachments", json={"filename": "notes.txt", "content_base64": base64.b64encode(b"hi").decode()}).status_code == 200
        assert api.patch("/api/tasks/chk1", json={"status": "Needs Review"}).status_code == 409, "a text file is not a screenshot"
        att = api.post("/api/tasks/chk1/attachments", json={"filename": "shot.png", "content_base64": PNG, "note": "after", "actor": "AI:checker"}).json()
        assert att["content_type"] == "image/png" and att["size"] > 0, att
        img = api.get(att["url"])
        assert img.status_code == 200 and img.content == base64.b64decode(PNG) and img.headers["content-disposition"].startswith("inline")
        txt = api.get(api.get("/api/tasks/chk1").json()["attachments"][0]["url"])
        assert txt.headers["content-disposition"].startswith("attachment") and txt.headers["content-security-policy"] == "sandbox"
        assert api.post("/api/tasks/chk1/attachments", json={"filename": "x.png", "content_base64": "not base64!"}).status_code == 400
        task = api.patch("/api/tasks/chk1", json={"status": "Needs Review"}).json()
        assert task["completed_at"] and task["duration_ms"] is not None and len(task["attachments"]) == 2, task
        logger.success("review needs the evidence (a screenshot here); images show inline, other files download sandboxed")

        # Going back from review needs a comment, which is kept on the task
        r = api.patch("/api/tasks/chk1", json={"status": "In Progress"})
        assert r.status_code == 409 and "comment" in r.json()["detail"], r.text
        task = api.patch("/api/tasks/chk1", json={"status": "In Progress", "comment": "Button still misaligned", "actor": "USER"}).json()
        last = task["comments"][-1]
        assert task["status"] == "In Progress" and last["kind"] == "sent_back" and last["text"] == "Button still misaligned", task
        assert last["from"] == "Needs Review" and last["to"] == "In Progress"
        assert "sent back: Button still misaligned" in api.get("/api/audit").json()[0]["updateSummary"]
        logger.success("sending a task back from review needs a comment, stored on the task")

        task = api.patch("/api/tasks/chk1", json={"status": "Needs Review"}).json()
        assert task["status"] == "Needs Review", task  # evidence is still there
        task = api.patch("/api/tasks/chk1", json={"status": "Completed"}).json()
        assert task["status"] == "Completed"
        # Reopening a completed task for review needs a reason too
        r = api.patch("/api/tasks/chk1", json={"status": "Needs Review"})
        assert r.status_code == 409 and "comment" in r.json()["detail"], r.text
        task = api.patch("/api/tasks/chk1", json={"status": "Needs Review", "comment": "Client found a typo"}).json()
        assert task["status"] == "Needs Review" and task["comments"][-1]["kind"] == "sent_back" and task["comments"][-1]["from"] == "Completed", task
        task = api.patch("/api/tasks/chk1", json={"status": "Completed"}).json()
        assert task["status"] == "Completed"
        assert api.patch("/api/tasks/chk1", json={"evidence_type": "attachment", "evidence_note": ""}).status_code == 422
        logger.success("approve completes; Completed -> Needs Review needs a reason; 'attachment' evidence must say what is needed")

        snapshot = api.get("/api/tasks/chk1").json()
        api.delete("/api/tasks/chk1").raise_for_status()
        api.post("/api/tasks?restore=true", json={**snapshot, "actor": "USER"}).raise_for_status()
        restored = api.get("/api/tasks/chk1").json()
        assert restored["started_at"] == snapshot["started_at"] and restored["status"] == "Completed", restored
        assert restored["comments"] == snapshot["comments"] and len(restored["attachments"]) == 2, restored
        assert api.get("/api/audit").json()[0]["action"] == "RESTORE_TASK"
        logger.success("delete + restore keeps the task's history, comments and evidence")

print("all API checks passed")

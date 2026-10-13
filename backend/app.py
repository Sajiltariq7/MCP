from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from pathlib import Path
import base64
import binascii
import json
import mimetypes
import uuid

from database import (init_db, get_db_connection, log_activity, get_setting, set_setting, new_api_key, now_utc, to_utc,
                      ATTACH_DIR)

app = FastAPI(title="MCP Engine Backend")

app.add_middleware(
    CORSMiddleware,
    # Only the taskboard UI may call this API from a browser (any other site could read the MCP key)
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    init_db()

STATUSES = {"pending": "Pending", "in progress": "In Progress", "needs review": "Needs Review", "completed": "Completed"}

# Every move a task may make, for people and agents alike. Anything else is refused with 409.
ALLOWED_MOVES = {
    "Pending": {"In Progress"},
    "In Progress": {"Needs Review", "Pending"},
    "Needs Review": {"Completed", "In Progress", "Pending"},
    "Completed": {"Needs Review", "In Progress"},
}
NEXT_STEP_HINT = {"Pending": "Move it to In Progress first.", "In Progress": "Move it to Needs Review first; approval completes it."}

EVIDENCE_TYPES = {"none", "screenshot", "attachment"}
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
# Shown in the browser; every other type downloads (an HTML or SVG file could otherwise run on this origin)
INLINE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}

def normalize_status(status):
    """Map 'in_progress', 'IN PROGRESS', 'In Progress', ... to one canonical form."""
    return STATUSES.get((status or "").strip().lower().replace("_", " "), "Pending")

def status_timestamps(current, new_status, now):
    """started_at, completed_at, duration_ms after `current` (a task row) moves to `new_status`."""
    started_at, completed_at, duration_ms = current["started_at"], current["completed_at"], current["duration_ms"]
    if new_status == "In Progress" and not started_at:
        started_at = now
    if new_status in ("Needs Review", "Completed") and normalize_status(current["status"]) != new_status:
        completed_at = now
        if started_at:
            try:
                duration_ms = int((datetime.fromisoformat(completed_at) - datetime.fromisoformat(started_at)).total_seconds() * 1000)
            except ValueError:
                duration_ms = None
    return started_at, completed_at, duration_ms

def is_backward(current, new_status):
    """Going back: from review to work, or reopening a completed task. These need a comment saying why."""
    return (current in ("Needs Review", "Completed") and new_status in ("In Progress", "Pending")) or         (current == "Completed" and new_status == "Needs Review")

def check_move(cursor, task, new_status, comment):
    """409 unless the move follows the lifecycle, carries a comment when going back, and has its evidence."""
    current = normalize_status(task["status"])
    if new_status == current:
        return
    if new_status not in ALLOWED_MOVES[current]:
        raise HTTPException(409, f"A task can't go from {current} to {new_status}. {NEXT_STEP_HINT.get(current, '')}".strip())
    if is_backward(current, new_status) and not (comment or "").strip():
        raise HTTPException(409, f"Moving a task back from {current} needs a comment saying why.")
    if new_status == "Needs Review":
        missing = missing_evidence(cursor, task)
        if missing:
            raise HTTPException(409, missing)

def missing_evidence(cursor, task):
    """What evidence is still missing before review, or None."""
    kind, note = task["evidence_type"] or "none", (task["evidence_note"] or "").strip()
    if kind == "none":
        return None
    types = [r["content_type"] or "" for r in cursor.execute("SELECT content_type FROM attachments WHERE task_id = ?", (task["id"],))]
    if kind == "screenshot" and not any(t.startswith("image/") for t in types):
        return f"This task needs a screenshot before review{': ' + note if note else ''}. Attach one first."
    if kind == "attachment" and not types:
        return f"This task needs an attachment before review{': ' + note if note else ''}. Attach it first."
    return None

def attachment_out(row):
    return {k: row[k] for k in ("id", "filename", "content_type", "size", "note", "uploaded_by", "uploaded_at")} | {"url": f"/api/attachments/{row['id']}"}

def row_to_task(row, attachments=()):
    task = dict(row)
    task["subtasks"] = json.loads(task["subtasks"]) if task["subtasks"] else []
    task["comments"] = json.loads(task["comments"]) if task.get("comments") else []
    task["evidence_type"] = task.get("evidence_type") or "none"
    task["evidence_note"] = task.get("evidence_note") or ""
    task["status"] = normalize_status(task["status"])
    task["attachments"] = [attachment_out(a) for a in attachments]
    return task

def fetch_task(cursor, task_id):
    row = cursor.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return row

def task_attachments(cursor, task_id):
    return cursor.execute("SELECT * FROM attachments WHERE task_id = ? ORDER BY uploaded_at", (task_id,)).fetchall()

def clean_evidence(kind, note):
    kind = (kind or "none").strip().lower()
    if kind not in EVIDENCE_TYPES:
        raise HTTPException(422, f"evidence_type must be one of: {', '.join(sorted(EVIDENCE_TYPES))}")
    if kind == "attachment" and not (note or "").strip():
        raise HTTPException(422, "Say what attachment is needed (evidence_note).")
    return kind, (note or "").strip()

class TaskModel(BaseModel):
    id: str
    title: str
    description: Optional[str] = ""
    status: Optional[str] = "PENDING"
    priority: Optional[str] = "medium"
    due_date: Optional[str] = None
    creator: Optional[str] = "human"
    actor: Optional[str] = "USER"
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_ms: Optional[int] = None
    subtasks: Optional[List[dict]] = []
    evidence_type: Optional[str] = "none"
    evidence_note: Optional[str] = ""
    comments: Optional[List[dict]] = []

class TaskPatch(BaseModel):
    """Only the fields that are sent change; everything else on the task is left alone."""
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None
    subtasks: Optional[List[dict]] = None
    evidence_type: Optional[str] = None
    evidence_note: Optional[str] = None
    comment: Optional[str] = None  # added to the task's comments; required when moving back from review
    actor: Optional[str] = "USER"

class AttachmentIn(BaseModel):
    filename: str
    content_base64: str
    note: Optional[str] = ""
    actor: Optional[str] = "USER"

@app.get("/api/tasks")
def get_tasks():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM tasks ORDER BY created_at").fetchall()
    files = {}
    for a in conn.execute("SELECT * FROM attachments ORDER BY uploaded_at").fetchall():
        files.setdefault(a["task_id"], []).append(a)
    conn.close()
    return [row_to_task(row, files.get(row["id"], [])) for row in rows]

@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        return row_to_task(fetch_task(cursor, task_id), task_attachments(cursor, task_id))
    finally:
        conn.close()

@app.post("/api/tasks")
def save_or_update_task(task: TaskModel, restore: bool = False):
    """Create a task (always Pending), or replace every field of an existing one. ?restore=true puts back an undone delete as it was."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        now_iso = now_utc()
        task.status = normalize_status(task.status)
        task.evidence_type, task.evidence_note = clean_evidence(task.evidence_type, task.evidence_note)
        subtasks_json = json.dumps(task.subtasks) if task.subtasks else "[]"

        existing = cursor.execute("SELECT * FROM tasks WHERE id = ?", (task.id,)).fetchone()
        if existing:
            check_move(cursor, existing, task.status, None)
            started_at, completed_at, duration_ms = status_timestamps(existing, task.status, now_iso)
            cursor.execute("""
                UPDATE tasks
                SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, creator = ?, started_at = ?,
                    completed_at = ?, duration_ms = ?, subtasks = ?, evidence_type = ?, evidence_note = ?
                WHERE id = ?
            """, (
                task.title, task.description, task.status, task.priority, task.due_date, task.creator, started_at,
                completed_at, duration_ms, subtasks_json, task.evidence_type, task.evidence_note, task.id
            ))
            action = "UPDATE_TASK"
            details = f"Task '{task.title}' updated to {task.status}"
        else:
            if restore:  # put back exactly as it was, history and timestamps included
                status, started_at, completed_at, duration_ms = task.status, to_utc(task.started_at), to_utc(task.completed_at), task.duration_ms
                action, details = "RESTORE_TASK", f"Task '{task.title}' restored"
            else:  # every new task starts in Pending
                status, started_at, completed_at, duration_ms = "Pending", None, None, None
                action, details = "CREATE_TASK", f"Task '{task.title}' created"
            cursor.execute("""
                INSERT INTO tasks (id, title, description, status, priority, due_date, creator, created_at, started_at,
                                   completed_at, duration_ms, subtasks, evidence_type, evidence_note, comments)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                task.id, task.title, task.description, status, task.priority, task.due_date, task.creator,
                to_utc(task.created_at) or now_iso, started_at, completed_at, duration_ms, subtasks_json,
                task.evidence_type, task.evidence_note, json.dumps((task.comments or []) if restore else [])
            ))
        conn.commit()
    finally:
        conn.close()

    log_activity(task.actor or "USER", action, "TASK", task.id, details)
    return {"message": "Success", "id": task.id}

@app.patch("/api/tasks/{task_id}")
def patch_task(task_id: str, patch: TaskPatch):
    """Change only the given fields, so two editors working on different fields don't overwrite each other."""
    changes = patch.model_dump(exclude_unset=True, exclude={"actor", "comment"})
    actor = patch.actor or "USER"
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        current = fetch_task(cursor, task_id)
        if "evidence_type" in changes or "evidence_note" in changes:
            changes["evidence_type"], changes["evidence_note"] = clean_evidence(
                changes.get("evidence_type", current["evidence_type"]), changes.get("evidence_note", current["evidence_note"]))
        backward = False
        if "status" in changes:
            changes["status"] = normalize_status(changes["status"])
            check_move(cursor, current, changes["status"], patch.comment)
            backward = is_backward(normalize_status(current["status"]), changes["status"])
            changes["started_at"], changes["completed_at"], changes["duration_ms"] = status_timestamps(current, changes["status"], now_utc())
        if patch.comment and patch.comment.strip():
            comments = json.loads(current["comments"] or "[]")
            comments.append({"author": actor, "text": patch.comment.strip(), "at": now_utc(),
                             "kind": "sent_back" if backward else "note",
                             **({"from": normalize_status(current["status"]), "to": changes["status"]} if backward else {})})
            changes["comments"] = json.dumps(comments)
        if "subtasks" in changes:
            changes["subtasks"] = json.dumps(changes["subtasks"] or [])
        if changes:
            cursor.execute(f"UPDATE tasks SET {', '.join(f'{col} = ?' for col in changes)} WHERE id = ?", (*changes.values(), task_id))
            conn.commit()
        task = row_to_task(fetch_task(cursor, task_id), task_attachments(cursor, task_id))
    finally:
        conn.close()

    status_changed = "status" in changes and normalize_status(current["status"]) != task["status"]
    if status_changed:
        details = f"Task '{task['title']}' updated to {task['status']}"
        if backward:
            details += f" (sent back: {patch.comment.strip()})"
    else:
        edited = [f for f in ("title", "description", "priority", "due_date", "subtasks", "evidence_type", "evidence_note", "comments") if f in changes]
        details = f"Task '{task['title']}' edited: {', '.join(edited) or 'no changes'}"
    log_activity(actor, "UPDATE_TASK", "TASK", task_id, details)
    return task

@app.post("/api/tasks/{task_id}/attachments")
def add_attachment(task_id: str, upload: AttachmentIn):
    """Attach evidence (a screenshot or any file, sent as base64). Max 10 MB."""
    try:
        data = base64.b64decode(upload.content_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "content_base64 is not valid base64")
    if not data:
        raise HTTPException(400, "The file is empty")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(413, "Attachments can be at most 10 MB")

    filename = Path(upload.filename).name.strip() or "attachment"
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    att_id = uuid.uuid4().hex
    ATTACH_DIR.mkdir(parents=True, exist_ok=True)
    path = ATTACH_DIR / f"{att_id}{Path(filename).suffix.lower()[:10]}"

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        title = fetch_task(cursor, task_id)["title"]
        path.write_bytes(data)
        cursor.execute("""
            INSERT INTO attachments (id, task_id, filename, content_type, size, path, note, uploaded_by, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (att_id, task_id, filename, content_type, len(data), path.name, upload.note or "", upload.actor or "USER", now_utc()))
        conn.commit()
        row = cursor.execute("SELECT * FROM attachments WHERE id = ?", (att_id,)).fetchone()
    finally:
        conn.close()

    log_activity(upload.actor or "USER", "ATTACH_EVIDENCE", "TASK", task_id, f"Evidence '{filename}' attached to '{title}'")
    return attachment_out(row)

@app.get("/api/attachments/{att_id}")
def get_attachment(att_id: str):
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM attachments WHERE id = ?", (att_id,)).fetchone()
    conn.close()
    if not row or not (ATTACH_DIR / row["path"]).exists():
        raise HTTPException(404, "Attachment not found")
    inline = row["content_type"] in INLINE_TYPES
    return FileResponse(ATTACH_DIR / row["path"], media_type=row["content_type"], filename=row["filename"],
                        content_disposition_type="inline" if inline else "attachment",
                        headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"})

@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, actor: str = "USER"):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        task_title = fetch_task(cursor, task_id)["title"]
        # Attachments stay, so Undo (restore) brings the task back with its evidence
        cursor.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
    finally:
        conn.close()

    log_activity(actor, "DELETE_TASK", "TASK", task_id, f"Task '{task_title}' deleted")
    return {"message": "Task deleted"}

@app.get("/api/audit")
def get_audit_logs():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM activity_logs ORDER BY timestamp DESC, id DESC")
    rows = cursor.fetchall()
    conn.close()

    logs = []
    for row in rows:
        logs.append({
            "id": row["id"],
            "timestamp": row["timestamp"],
            "action": row["action"],
            "actor": row["actor"],
            "updateSummary": row["details"],
            "details": {
                "id": row["entity_id"],
                "title": row["details"]
            }
        })
    return logs

# ----- MCP API key: agents must send it as "Authorization: Bearer <key>" -----
@app.get("/api/mcp/key")
def get_mcp_key():
    return {"key": get_setting("mcp_api_key")}

@app.post("/api/mcp/key/rotate")
def rotate_mcp_key():
    key = new_api_key()
    set_setting("mcp_api_key", key)
    log_activity("USER", "ROTATE_KEY", "MCP", "api-key", "MCP API key rotated; connected agents were disconnected")
    return {"key": key}

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8190, reload=True)

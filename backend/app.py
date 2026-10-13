from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import json

from database import init_db, get_db_connection, log_activity, get_setting, set_setting, new_api_key, now_utc, to_utc

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

def row_to_task(row):
    task = dict(row)
    task["subtasks"] = json.loads(task["subtasks"]) if task["subtasks"] else []
    task["status"] = normalize_status(task["status"])
    return task

def fetch_task(cursor, task_id):
    row = cursor.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return row

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

class TaskPatch(BaseModel):
    """Only the fields that are sent change; everything else on the task is left alone."""
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None
    subtasks: Optional[List[dict]] = None
    actor: Optional[str] = "USER"

@app.get("/api/tasks")
def get_tasks():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM tasks ORDER BY created_at").fetchall()
    conn.close()
    return [row_to_task(row) for row in rows]

@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    conn = get_db_connection()
    try:
        return row_to_task(fetch_task(conn.cursor(), task_id))
    finally:
        conn.close()

@app.post("/api/tasks")
def save_or_update_task(task: TaskModel, restore: bool = False):
    """Create a task, or replace every field of an existing one. ?restore=true logs an undone delete."""
    conn = get_db_connection()
    cursor = conn.cursor()
    now_iso = now_utc()
    task.status = normalize_status(task.status)
    subtasks_json = json.dumps(task.subtasks) if task.subtasks else "[]"

    existing = cursor.execute("SELECT * FROM tasks WHERE id = ?", (task.id,)).fetchone()
    if existing:
        started_at, completed_at, duration_ms = status_timestamps(existing, task.status, now_iso)
        cursor.execute("""
            UPDATE tasks
            SET title = ?, description = ?, status = ?, priority = ?, due_date = ?,
                creator = ?, started_at = ?, completed_at = ?, duration_ms = ?, subtasks = ?
            WHERE id = ?
        """, (
            task.title, task.description, task.status, task.priority, task.due_date,
            task.creator, started_at, completed_at, duration_ms, subtasks_json, task.id
        ))
        action = "UPDATE_TASK"
        details = f"Task '{task.title}' updated to {task.status}"
    else:
        # Creating a new task: keep the caller's timestamps (a restored task keeps its history)
        started_at = to_utc(task.started_at)
        if task.status == "In Progress" and not started_at:
            started_at = now_iso

        cursor.execute("""
            INSERT INTO tasks (id, title, description, status, priority, due_date, creator, created_at, started_at, completed_at, duration_ms, subtasks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            task.id, task.title, task.description, task.status, task.priority, task.due_date,
            task.creator, to_utc(task.created_at) or now_iso, started_at, to_utc(task.completed_at), task.duration_ms, subtasks_json
        ))
        action, details = ("RESTORE_TASK", f"Task '{task.title}' restored") if restore else ("CREATE_TASK", f"Task '{task.title}' created")

    conn.commit()
    conn.close()

    log_activity(task.actor or "USER", action, "TASK", task.id, details)
    return {"message": "Success", "id": task.id}

@app.patch("/api/tasks/{task_id}")
def patch_task(task_id: str, patch: TaskPatch):
    """Change only the given fields, so two editors working on different fields don't overwrite each other."""
    changes = patch.model_dump(exclude_unset=True, exclude={"actor"})
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        current = fetch_task(cursor, task_id)
        if "status" in changes:
            changes["status"] = normalize_status(changes["status"])
            changes["started_at"], changes["completed_at"], changes["duration_ms"] = status_timestamps(current, changes["status"], now_utc())
        if "subtasks" in changes:
            changes["subtasks"] = json.dumps(changes["subtasks"] or [])
        if changes:
            cursor.execute(f"UPDATE tasks SET {', '.join(f'{col} = ?' for col in changes)} WHERE id = ?", (*changes.values(), task_id))
            conn.commit()
        task = row_to_task(fetch_task(cursor, task_id))
    finally:
        conn.close()

    status_changed = "status" in changes and normalize_status(current["status"]) != task["status"]
    if status_changed:
        details = f"Task '{task['title']}' updated to {task['status']}"
    else:
        edited = [f for f in ("title", "description", "priority", "due_date", "subtasks") if f in changes]
        details = f"Task '{task['title']}' edited: {', '.join(edited) or 'no changes'}"
    log_activity(patch.actor or "USER", "UPDATE_TASK", "TASK", task_id, details)
    return task

@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, actor: str = "USER"):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        task_title = fetch_task(cursor, task_id)["title"]
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

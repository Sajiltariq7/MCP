from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import json

from database import init_db, get_db_connection, log_activity
from logger_config import logger

app = FastAPI(title="MCP Engine Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    logger.info("[App] Startup: initializing database")
    init_db()

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

@app.get("/api/tasks")
def get_tasks():
    logger.info("[App] Fetching all tasks")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tasks")
    rows = cursor.fetchall()
    conn.close()

    tasks = []
    for row in rows:
        task = dict(row)
        task["subtasks"] = json.loads(task["subtasks"]) if task["subtasks"] else []
        tasks.append(task)

    return tasks

@app.post("/api/tasks")
def save_or_update_task(task: TaskModel):
    logger.info(f"[App] Saving/updating task: {task.id}")
    conn = get_db_connection()
    cursor = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()

    cursor.execute("SELECT * FROM tasks WHERE id = ?", (task.id,))
    existing = cursor.fetchone()

    subtasks_json = json.dumps(task.subtasks) if task.subtasks else "[]"

    if existing:
        existing_dict = dict(existing)
        
        # Preserve original timestamps or set new ones based on status changes
        started_at = existing_dict.get("started_at")
        completed_at = existing_dict.get("completed_at")
        duration_ms = existing_dict.get("duration_ms")

        # Normalize status string comparison
        new_status = task.status
        
        # Transitioning to "In Progress" -> Record start time
        if new_status == "In Progress" and not started_at:
            started_at = now_iso

        # Transitioning to "Needs Review" or "Completed" -> Record completion and duration
        if new_status in ["Needs Review", "Completed"]:
            completed_at = now_iso
            if started_at:
                try:
                    start_dt = datetime.fromisoformat(started_at)
                    end_dt = datetime.fromisoformat(completed_at)
                    duration_ms = int((end_dt - start_dt).total_seconds() * 1000)
                except Exception:
                    duration_ms = 0

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
        # Creating a new task
        started_at = task.started_at
        completed_at = task.completed_at
        duration_ms = task.duration_ms

        if task.status == "In Progress" and not started_at:
            started_at = now_iso

        cursor.execute("""
            INSERT INTO tasks (id, title, description, status, priority, due_date, creator, created_at, started_at, completed_at, duration_ms, subtasks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            task.id, task.title, task.description, task.status, task.priority, task.due_date,
            task.creator, task.created_at or now_iso, started_at, completed_at, duration_ms, subtasks_json
        ))
        action = "CREATE_TASK"
        details = f"Task '{task.title}' created"

    conn.commit()
    conn.close()

    log_activity(task.actor or "USER", action, "TASK", task.id, details, now_iso)
    return {"message": "Success", "id": task.id}

@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, actor: str = "USER"):
    logger.info(f"[App] Deleting task: {task_id}")
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT title FROM tasks WHERE id = ?", (task_id,))
    row = cursor.fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found")

    task_title = row["title"]
    cursor.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()

    now = datetime.now().isoformat()
    log_activity(actor, "DELETE_TASK", "TASK", task_id, f"Task '{task_title}' deleted", now)
    return {"message": "Task deleted"}

@app.get("/api/audit")
def get_audit_logs():
    logger.info("[App] Fetching audit logs")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM activity_logs ORDER BY timestamp DESC")
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

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
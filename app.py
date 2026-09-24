from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import json

from database import init_db, get_db_connection, log_activity

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
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().isoformat()

    cursor.execute("SELECT id FROM tasks WHERE id = ?", (task.id,))
    existing = cursor.fetchone()

    subtasks_json = json.dumps(task.subtasks)

    if existing:
        cursor.execute("""
            UPDATE tasks
            SET title = ?, description = ?, status = ?, priority = ?, due_date = ?,
                creator = ?, started_at = ?, completed_at = ?, duration_ms = ?, subtasks = ?
            WHERE id = ?
        """, (
            task.title, task.description, task.status, task.priority, task.due_date,
            task.creator, task.started_at, task.completed_at, task.duration_ms, subtasks_json, task.id
        ))
        action = "UPDATE_TASK"
        details = f"Task '{task.title}' updated"
    else:
        cursor.execute("""
            INSERT INTO tasks (id, title, description, status, priority, due_date, creator, created_at, started_at, completed_at, duration_ms, subtasks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            task.id, task.title, task.description, task.status, task.priority, task.due_date,
            task.creator, task.created_at or now, task.started_at, task.completed_at, task.duration_ms, subtasks_json
        ))
        action = "CREATE_TASK"
        details = f"Task '{task.title}' created"

    conn.commit()
    conn.close()

    log_activity(task.actor or "USER", action, "TASK", task.id, details, now)
    return {"message": "Success", "id": task.id}

@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, actor: str = "USER"):
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
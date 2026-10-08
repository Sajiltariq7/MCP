from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import sqlite3
import json
import sys

from database import init_db, get_db_connection, log_activity, DB_NAME
import sqlite3
import logging
from logger_config import logger

# Custom InterceptHandler routing all standard logging through loguru (sys.stderr)
class InterceptHandler(logging.Handler):
    def emit(self, record):
        try:
            msg = self.format(record)
            logger.info(f"[INTERCEPTED LOG] {msg}")
        except Exception:
            pass

# Override standard library logging to route through InterceptHandler (sys.stderr)
logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)

# Suppress uvicorn access logs completely
uvicorn_access = logging.getLogger("uvicorn.access")
uvicorn_access.setLevel(logging.CRITICAL)
uvicorn_access.propagate = False
uvicorn_access.handlers = []
uvicorn_access.disabled = True

# Fully disable and suppress uvicorn loggers with propagate=False
for logger_name in ["uvicorn", "uvicorn.access", "uvicorn.error"]:
    mod_logger = logging.getLogger(logger_name)
    mod_logger.handlers = []
    mod_logger.propagate = False
    mod_logger.disabled = True

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
    week_number: Optional[int] = 1
    due_date: Optional[str] = None
    creator: Optional[str] = "human"
    actor: Optional[str] = "USER"
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_ms: Optional[int] = None
    diagram_url: Optional[str] = None
    subtasks: Optional[List[dict]] = []

@app.get("/api/tasks")
def get_tasks():
    logger.info("[App] Fetching all tasks")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks")
        rows = cursor.fetchall()
        tasks = []
        for row in rows:
            task = dict(row)
            task["subtasks"] = json.loads(task["subtasks"]) if task["subtasks"] else []
            tasks.append(task)
    return tasks

@app.post("/api/tasks")
def save_or_update_task(task: TaskModel):
    logger.info(f"[App] Saving/updating task: {task.id}")
    with get_db_connection() as conn:
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
                creator = ?, started_at = ?, completed_at = ?, duration_ms = ?, subtasks = ?, week_number = ?, diagram_url = ?, completed_date = ?
                WHERE id = ?
            """, (
                task.title, task.description, task.status, task.priority, task.due_date,
                task.creator, started_at, completed_at, duration_ms, subtasks_json, task.week_number or 1, task.diagram_url or None,
                (datetime.now(timezone.utc).strftime("%Y-%m-%d") if task.status in ["COMPLETED", "DONE"] else None),
                task.id
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
            INSERT INTO tasks (id, title, description, status, priority, due_date, creator, created_at, started_at, completed_at, duration_ms, subtasks, week_number, diagram_url, completed_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                task.id, task.title, task.description, task.status, task.priority, task.due_date,
                task.creator, task.created_at or now_iso, started_at, completed_at, duration_ms, subtasks_json, task.week_number or 1, task.diagram_url or None,
                (datetime.now(timezone.utc).strftime("%Y-%m-%d") if task.status in ["COMPLETED", "DONE"] else None)
            ))
            action = "CREATE_TASK"
            details = f"Task '{task.title}' created"

        conn.commit()

    log_activity(task.actor or "USER", action, "TASK", task.id, details, now_iso)
    return {"message": "Success", "id": task.id}

@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, actor: str = "USER"):
    logger.info(f"[App] Deleting task: {task_id}")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT title FROM tasks WHERE id = ?", (task_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")
        task_title = row["title"]
        cursor.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
    now = datetime.now().isoformat()
    log_activity(actor, "DELETE_TASK", "TASK", task_id, f"Task '{task_title}' deleted", now)
    return {"message": "Task deleted"}

class ReportRequest(BaseModel):
    week_number: int = 1

@app.post("/api/weekly/generate-report")
def generate_weekly_report(route: ReportRequest):
    try:
        logger.info(f"[App] Generating weekly report: week {route.week_number}")
        init_db()
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM tasks WHERE week_number = ?", (route.week_number,))
        tasks = [dict(row) for row in cursor.fetchall()]
        outcomes = []
        for t in tasks:
            task_dict = dict(t) if hasattr(t, 'keys') else dict(t)
            cursor.execute("SELECT COALESCE(SUM(minutes_worked), 0) FROM daily_progress WHERE task_id = ?", (task_dict.get("id"),))
            time_row = cursor.fetchone()
            total_time = time_row[0] or 0
        outcomes.append({
            "task_id": task_dict.get("id"),
            "title": task_dict.get("title"),
            "status": task_dict.get("status"),
            "total_time_logged": total_time,
            "subtasks_done": 0,
            "subtasks_count": 0
        })
        conn.commit()
        return {"message": "Weekly report generated.", "week": route.week_number, "status": "success", "report": {"week_number": route.week_number, "total_tasks": len(tasks), "completed_tasks": sum(1 for t in tasks if t.get("status") == "Completed"), "tasks": tasks, "metrics": {"total_time_logged": sum(o["total_time_logged"] for o in outcomes)}}}
    except Exception as exc:
        import traceback
        logger.error(f"[App] Generate report error: {str(exc)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Server error generating report: {str(exc)}")

@app.post("/api/weekly/finalize-report")
def finalize_weekly_report(route: WeeklyDecomposeRequest):
    logger.info(f"[App] Finalizing weekly report: week {route.week_number}")
    init_db()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE weekly_reports SET status = ?, updated_at = ? WHERE week_number = ?", ("FINALIZED", datetime.now(timezone.utc).isoformat(), route.week_number))
        conn.commit()
    return {"message": "Weekly report finalized.", "week": route.week_number, "status": "FINALIZED"}

app.mount("/static", StaticFiles(directory="."), name="static")

@app.get("/api/progress/{week_number}/{day_number}")
def get_daily_summary(week_number: int, day_number: int):
    logger.info(f"[App] Daily summary: week {week_number} day {day_number}")
    init_db()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks WHERE week_number = ? AND day_number = ?", (week_number, day_number))
        tasks = [dict(r) for r in cursor.fetchall()]
        total = len(tasks)
        completed = sum(1 for t in tasks if t.get('status') in ['COMPLETED', 'DONE'])
        percentage = int((completed / total) * 100) if total > 0 else 0
        cursor.execute("SELECT SUM(minutes_worked) FROM daily_progress WHERE date = ?", (datetime.now(timezone.utc).strftime("%Y-%m-%d"),))
        total_time = cursor.fetchone()[0] or 0
    return {"week": week_number, "day": day_number, "total": total, "completed": completed, "completion_percentage": percentage, "total_time_logged": total_time, "tasks": tasks}

@app.get("/api/progress/{task_id}")
def get_task_progress(task_id: str):
    init_db()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        task = dict(cursor.fetchone() or {})
        cursor.execute("SELECT * FROM daily_progress WHERE task_id = ? ORDER BY timestamp DESC", (task_id,))
        progress = [dict(r) for r in cursor.fetchall()]
    return {"task": task, "progress": progress, "completed_date": task.get('completed_date')}

@app.get("/api/reports/daily")
def get_daily_report():
    try:
        init_db()
        with get_db_connection() as conn:
            cursor = conn.cursor()
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            cursor.execute("SELECT COALESCE(SUM(minutes_worked), 0) FROM daily_progress WHERE date = ?", (today,))
            total_time_row = cursor.fetchone()
            total_time = total_time_row[0] or 0
            cursor.execute("SELECT * FROM daily_progress WHERE date = ? ORDER BY date DESC", (today,))
            progress_rows = cursor.fetchall()
            progress = [{"id": r["id"], "date": r["date"], "minutes_worked": r["minutes_worked"], "progress_notes": r["progress_notes"], "status": r["status"], "task_id": r["task_id"]} for r in progress_rows]
            # Fetch task titles for progress entries
            for entry in progress:
                cursor.execute("SELECT title FROM tasks WHERE id = ?", (entry.get('task_id'),))
                row = cursor.fetchone()
                entry['task_title'] = row['title'] if row else 'Unknown Task'
        return {"date": today, "total_time_logged": total_time, "entries": progress, "status": "success"}
    except Exception as exc:
        import traceback
        logger.error(f"[App] Daily report error: {str(exc)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Server error: {str(exc)}")

@app.post("/api/tasks/{task_id}/progress")
def post_daily_progress(task_id: str, payload: dict):
    try:
        init_db()
        minutes = payload.get('minutes_worked', 0)
        notes = payload.get('progress_notes', '')
        with sqlite3.connect(DB_NAME, timeout=30.0) as conn:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("INSERT INTO daily_progress (task_id, date, minutes_worked, progress_notes, status) VALUES (?, ?, ?, ?, ?)",
                         (task_id, datetime.now(timezone.utc).strftime("%Y-%m-%d"), minutes, notes, 'LOGGED'))
            conn.commit()
        return {"status": "success", "message": "Progress logged", "task_id": task_id}
    except Exception as exc:
        import traceback
        logger.error(f"[App] Progress log error: {str(exc)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Server error: {str(exc)}")

@app.get("/style.css")
async def get_css():
    return FileResponse("style.css", media_type="text/css")

@app.get("/script.js")
async def get_js():
    return FileResponse("script.js", media_type="application/javascript")

@app.get("/data.js")
async def get_data_js():
    return FileResponse("data.js", media_type="application/javascript")

@app.get("/")
async def serve_index():
    logger.info("[App] Serving index.html at root")
    return FileResponse("index.html")

@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    try:
        logger.info(f"[App] Fetching task details: {task_id}")
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM tasks WHERE id = ? OR title = ?", (task_id, task_id))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Task not found")
            task = dict(row)
            # Initialize subtask-related fields for backward compatibility
            task.setdefault('subtasks', [])
            task.setdefault('subtask_items', [])
            cursor.execute("SELECT * FROM daily_progress WHERE task_id = ? ORDER BY date DESC", (task.get('id'),))
            progress_rows = cursor.fetchall()
            task["daily_progress"] = [{"id": r["id"], "date": r["date"], "minutes_worked": r["minutes_worked"], "progress_notes": r["progress_notes"], "status": r["status"]} for r in progress_rows]
            cursor.execute("SELECT * FROM activity_logs WHERE entity_id = ? ORDER BY timestamp DESC", (task_id,))
            history_rows = cursor.fetchall()
            task["history"] = [{"id": r["id"], "timestamp": r["timestamp"], "actor": r["actor"], "action": r["action"], "details": r["details"]} for r in history_rows]
        return task
    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        logger.error(f"[App] Get task error: {str(exc)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Server error: {str(exc)}")

class WeeklyDecomposeRequest(BaseModel):
    week_number: int
    goal_title: str
    start_date: Optional[str] = None
    description: Optional[str] = ""
    subtasks_by_day: Optional[List[str]] = None

@app.post("/api/weekly/decompose")
def decompose_weekly_goal_route(req: WeeklyDecomposeRequest):
    try:
        week_number = req.week_number
        goal_title = req.goal_title
        start_date = req.start_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        goal_description = req.description or ""
        from datetime import timedelta
        logger.info(f"[App] Decomposing weekly goal: {goal_title} week {week_number}")
        init_db()
        conn = sqlite3.connect(DB_NAME, timeout=30.0)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=30000;")
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        parent_id = f"week_{week_number}_{goal_title.replace(' ', '_')[:20]}"
        cursor.execute("INSERT OR IGNORE INTO tasks (id, title, status, week_number, created_at, actor) VALUES (?, ?, ?, ?, ?, ?)",
                       (parent_id, goal_title, "PENDING", week_number, datetime.now(timezone.utc).isoformat(), "AI_AGENT"))
        base = datetime.fromisoformat(start_date.replace("Z", "+00:00") if start_date.endswith("Z") else start_date)
        subtask_titles = [
            "Initial setup & orientation",
            "Core implementation - Part 1",
            "Core implementation - Part 2",
            "Integration & testing",
            "Review & documentation"
        ]
        descriptions = [
            "Day 1 focus: Initial setup and orientation for the week.",
            "Day 2 focus: Core implementation - Part 1 execution.",
            "Day 3 focus: Core implementation - Part 2 execution.",
            "Day 4 focus: Integration, testing, and validation.",
            "Day 5 focus: Final review, documentation, and delivery."
        ]
        for i in range(5):
            due = (base + timedelta(days=i)).strftime("%Y-%m-%d")
            sub_title = subtask_titles[i]
            task_title = f"Week {week_number} - Day {i+1}: {goal_title}"
            sub_id = int(str(i+1) + str(week_number))
            # Create a task entry for each daily subtask with distinct description and day_number
            cursor.execute("INSERT OR IGNORE INTO tasks (id, title, status, priority, week_number, due_date, created_at, actor, description, day_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           (f"week_{week_number}_day_{i+1}", task_title, "TODO", "MEDIUM", week_number, due, datetime.now(timezone.utc).isoformat(), "AI_AGENT", descriptions[i], i+1))
            # Insert subtask record (skipped: only tasks table used per updated schema)
            pass
        # Insert history log
        cursor.execute("INSERT INTO activity_logs (timestamp, actor, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)",
                       (datetime.now(timezone.utc).isoformat(), "AI_AGENT", "DECOMPOSE_WEEKLY", "WEEKLY_GOAL", parent_id, f"Decomposed from weekly goal '{goal_title}'"))
        # Fetch created daily tasks for response
        cursor.execute("SELECT id, week_number, day_number, title, status FROM tasks WHERE week_number = ?", (week_number,))
        subtask_result = [{"id": r["id"], "week_number": r["week_number"], "day_number": r["day_number"], "title": r["title"], "status": r["status"]} for r in cursor.fetchall()]
        conn.commit()
        conn.close()
        return {"message": f"Weekly goal '{goal_title}' decomposed with 5 daily subtasks.", "week": week_number, "subtasks": subtask_result}
    except Exception as exc:
        import traceback
        logger.error(f"[App] Decompose endpoint error: {str(exc)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Server error during decomposition: {str(exc)}")
    finally:
        try:
            conn.close()
        except Exception:
            pass

class SubtaskToggle(BaseModel):
    completed: bool

@app.patch("/api/subtasks/{subtask_id}")
def patch_subtask(subtask_id: int, payload: SubtaskToggle):
    logger.info(f"[App] Patching subtask: {subtask_id} completed={payload.completed}")
    completed = payload.completed
    from database import DB_NAME, init_db, log_activity
    init_db()
    with sqlite3.connect(DB_NAME, timeout=30.0) as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=30000;")
        cursor = conn.cursor()
        cursor.execute("SELECT task_id FROM subtasks WHERE id = ?", (subtask_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Subtask not found")
        completed_int = 1 if completed else 0
        cursor.execute("UPDATE subtasks SET completed = ?, completed_by = ? WHERE id = ?", (completed_int, "HUMAN", subtask_id))
        conn.commit()
    log_activity("HUMAN", "PATCH_SUBTASK", "SUBTASK", str(subtask_id), f"Subtask {subtask_id} completed={completed}", datetime.now(timezone.utc).isoformat())
    return {"status": "success", "subtask_id": subtask_id, "completed": completed}

@app.get("/api/tasks/{task_id}/subtasks")
def get_subtasks(task_id: str):
    logger.info(f"[App] Fetching subtasks for task: {task_id}")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM subtasks WHERE task_id = ?", (task_id,))
        rows = cursor.fetchall()
        return [{"id": r["id"], "task_id": r["task_id"], "title": r["title"], "due_date": r["due_date"], "completed": r["completed"], "completed_by": r["completed_by"]} for r in rows]

@app.post("/api/tasks/{task_id}/subtasks/toggle")
def toggle_subtask_route(task_id: str, subtask_id: int, completed: bool, actor: str = "HUMAN"):
    logger.info(f"[App] Toggling subtask: {subtask_id} for task {task_id}")
    from database import DB_NAME, init_db, log_activity
    init_db()
    with sqlite3.connect(DB_NAME, timeout=30.0) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM subtasks WHERE id = ? AND task_id = ?", (subtask_id, task_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Subtask not found")
        completed_int = 1 if completed else 0
        cursor.execute("UPDATE subtasks SET completed = ?, completed_by = ? WHERE id = ?", (completed_int, actor, subtask_id))
        conn.commit()
    log_activity(actor, "TOGGLE_SUBTASK", "SUBTASK", str(subtask_id), f"Subtask {subtask_id} completed={completed}", datetime.now(timezone.utc).isoformat())
    return {"message": "Subtask updated", "subtask_id": subtask_id, "completed": completed, "actor": actor}

@app.get("/api/audit")
def get_audit_logs():
    logger.info("[App] Fetching audit logs")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM activity_logs ORDER BY timestamp DESC")
        rows = cursor.fetchall()
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

@app.get("/")
def read_root():
    logger.info("[App] Serving index.html at root")
    return FileResponse("index.html")

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    from fastapi.responses import Response
    return Response(status_code=204)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True, reload_includes=["app.py", "logger_config.py", "database.py"], access_log=False, log_config=None)
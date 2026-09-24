import json
import time
import uvicorn
from uvicorn.config import LOGGING_CONFIG
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Task Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TASKS_FILE = Path("tasks.json")
AUDIT_FILE = Path("activity_history.json")

def read_json_file(file_path: Path) -> List[Dict[str, Any]]:
    if not file_path.exists():
        return []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []

def write_json_file(file_path: Path, data: List[Dict[str, Any]]) -> None:
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def log_activity(action: str, task_title: Optional[str], actor: str = "USER", details: Optional[Dict[str, Any]] = None):
    history = read_json_file(AUDIT_FILE)
    log_entry = {
        "id": str(int(time.time() * 1000)),
        "action": action,
        "actor": actor,
        "details": details or {"title": task_title or "Task Action"},
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    history.insert(0, log_entry)
    write_json_file(AUDIT_FILE, history)

# --- API ENDPOINTS ---

@app.get("/api/tasks")
def get_tasks():
    return read_json_file(TASKS_FILE)

@app.post("/api/tasks")
def save_or_update_task(task: Dict[str, Any]):
    tasks = read_json_file(TASKS_FILE)
    task_id = str(task.get("id"))
    actor = task.pop("actor", "USER")  # Remove actor field before saving to tasks.json
    
    existing_index = next((i for i, t in enumerate(tasks) if str(t.get("id")) == task_id), None)
    now_iso = datetime.now(timezone.utc).isoformat()
    
    if existing_index is not None:
        old_task = tasks[existing_index]
        old_status = old_task.get("status")
        new_status = task.get("status")

        # Preserve previously stored timestamps if not provided in payload
        task["started_at"] = task.get("started_at") or old_task.get("started_at")
        task["completed_at"] = task.get("completed_at") or old_task.get("completed_at")
        task["approved_at"] = task.get("approved_at") or old_task.get("approved_at")
        task["time_elapsed"] = task.get("time_elapsed") or old_task.get("time_elapsed")

        # 1. Status changed to "In Progress" -> Record start timestamp
        if new_status == "In Progress" and old_status != "In Progress":
            task["started_at"] = now_iso

        # 2. Status changed to "Needs Review" -> Record completion time and compute time_elapsed
        elif new_status == "Needs Review" and old_status != "Needs Review":
            task["completed_at"] = now_iso
            if task.get("started_at"):
                try:
                    start_dt = datetime.fromisoformat(task["started_at"])
                    end_dt = datetime.fromisoformat(now_iso)
                    elapsed_seconds = (end_dt - start_dt).total_seconds()
                    
                    if elapsed_seconds < 1:
                        task["time_elapsed"] = f"{int(elapsed_seconds * 1000)}ms"
                    else:
                        task["time_elapsed"] = f"{elapsed_seconds:.2f}s"
                except Exception:
                    task["time_elapsed"] = "N/A"

        # 3. Status changed to "Completed" -> Record approval timestamp
        elif new_status == "Completed" and old_status != "Completed":
            task["approved_at"] = now_iso

        tasks[existing_index] = task
        log_activity("TASK_UPDATED", task.get("title"), actor, details=task)
    else:
        # Default initialization for new tasks
        if "created_at" not in task:
            task["created_at"] = now_iso
        if "status" not in task:
            task["status"] = "Pending"

        tasks.append(task)
        log_activity("TASK_CREATED", task.get("title"), actor, details={"id": task_id, "title": task.get("title")})
        
    write_json_file(TASKS_FILE, tasks)
    return {"status": "success", "task": task}

@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, actor: str = Query("USER")):
    tasks = read_json_file(TASKS_FILE)
    task_to_delete = next((t for t in tasks if str(t.get("id")) == str(task_id)), None)
    
    if not task_to_delete:
        raise HTTPException(status_code=404, detail="Task not found")
        
    filtered_tasks = [t for t in tasks if str(t.get("id")) != str(task_id)]
    write_json_file(TASKS_FILE, filtered_tasks)
    
    log_activity("TASK_DELETED", task_to_delete.get("title"), actor, details={"id": str(task_id)})
    return {"status": "success", "deleted_id": task_id}

@app.get("/api/audit")
def get_audit_logs():
    return read_json_file(AUDIT_FILE)

# Static files route handling
@app.get("/")
def serve_index():
    return FileResponse("index.html")

@app.get("/{file_name}")
def serve_static(file_name: str):
    file_path = Path(file_name)
    if file_path.exists() and file_path.suffix in [".js", ".css", ".html", ".ico", ".json"]:
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="File not found")

if __name__ == "__main__":
    # Add date/time to the log format
    LOGGING_CONFIG["formatters"]["access"]["fmt"] = (
        "%(asctime)s - %(levelprefix)s %(client_addr)s - \"%(request_line)s\" %(status_code)s"
    )
    
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
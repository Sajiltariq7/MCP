"""
MCP Engine v2.5 — FastAPI + FastMCP backend
Run:  uv run uvicorn mcp_server:app --host 0.0.0.0 --port 8000 --reload
Port: 8000
"""
import json
import os
import uuid
import asyncio
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# ---------- Paths ----------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TASKS_FILE = os.path.join(BASE_DIR, "tasks.json")
HISTORY_FILE = os.path.join(BASE_DIR, "activity_history.json")

# ---------- SSE subscriber registry ----------
_sse_clients: List[asyncio.Queue] = []
_main_loop: Optional[asyncio.AbstractEventLoop] = None


async def broadcast(event: Dict[str, Any]):
    """Push an event to every connected SSE client."""
    dead = []
    for q in _sse_clients:
        try:
            q.put_nowait(event)
        except Exception:
            dead.append(q)
    for q in dead:
        _sse_clients.remove(q)


def broadcast_threadsafe(event: Dict[str, Any]):
    """Safe to call from sync endpoints."""
    if _main_loop and _main_loop.is_running():
        asyncio.run_coroutine_threadsafe(broadcast(event), _main_loop)


# ---------- File helpers ----------
def _load(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save(path, data):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def load_tasks() -> List[Dict[str, Any]]:
    return _load(TASKS_FILE, [])


def save_tasks(tasks: List[Dict[str, Any]]):
    _save(TASKS_FILE, tasks)


def load_history() -> List[Dict[str, Any]]:
    return _load(HISTORY_FILE, [])


def log_activity(actor: str, action: str, task_id: Optional[str],
                 details: str, meta: Optional[Dict] = None):
    history = load_history()
    entry = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "actor": actor,
        "action": action,
        "task_id": task_id,
        "details": details,
        "meta": meta or {},
    }
    history.append(entry)
    _save(HISTORY_FILE, history)
    broadcast_threadsafe({"type": "activity", "entry": entry})
    return entry


# ---------- Models ----------
class TaskCreate(BaseModel):
    title: str
    description: str = ""
    status: str = "pending"
    priority: str = "medium"
    assignee: Optional[str] = None
    due_date: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    blocked_by: List[str] = Field(default_factory=list)
    actor: str = "human"


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assignee: Optional[str] = None
    due_date: Optional[str] = None
    tags: Optional[List[str]] = None
    blocked_by: Optional[List[str]] = None
    actor: str = "human"


# ---------- FastAPI app ----------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _main_loop
    _main_loop = asyncio.get_running_loop()
    if not os.path.exists(TASKS_FILE):
        save_tasks([])
    if not os.path.exists(HISTORY_FILE):
        _save(HISTORY_FILE, [])
    yield


app = FastAPI(title="MCP Engine v2.5", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- REST API ----------
@app.get("/api/health")
def health():
    return {"ok": True, "version": "2.5",
            "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/tasks")
def get_tasks():
    return {"ok": True, "tasks": load_tasks()}


@app.post("/api/tasks")
def create_task(payload: TaskCreate):
    tasks = load_tasks()
    task = {
        "id": str(uuid.uuid4())[:8],
        "title": payload.title,
        "description": payload.description,
        "status": payload.status,
        "priority": payload.priority,
        "assignee": payload.assignee,
        "due_date": payload.due_date,
        "tags": payload.tags,
        "blocked_by": payload.blocked_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "history": [],
    }
    tasks.append(task)
    save_tasks(tasks)
    log_activity(payload.actor, "create", task["id"], f"Created task: {task['title']}")
    return {"ok": True, "task": task}


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: str, payload: TaskUpdate):
    tasks = load_tasks()
    for t in tasks:
        if t["id"] == task_id:
            changes = {}
            for field, value in payload.model_dump(exclude_unset=True).items():
                if field == "actor":
                    continue
                if value is not None and t.get(field) != value:
                    changes[field] = {"from": t.get(field), "to": value}
                    t[field] = value
            t["updated_at"] = datetime.now(timezone.utc).isoformat()
            t.setdefault("history", []).append({
                "timestamp": t["updated_at"],
                "actor": payload.actor,
                "changes": changes,
            })
            save_tasks(tasks)
            log_activity(payload.actor, "update", task_id,
                         f"Updated {list(changes.keys())}", meta=changes)
            return {"ok": True, "task": t}
    raise HTTPException(404, "Task not found")


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, actor: str = "human"):
    tasks = load_tasks()
    for i, t in enumerate(tasks):
        if t["id"] == task_id:
            removed = tasks.pop(i)
            save_tasks(tasks)
            log_activity(actor, "delete", task_id, f"Deleted task: {removed['title']}")
            return {"ok": True}
    raise HTTPException(404, "Task not found")


@app.get("/api/history")
def get_history(limit: int = 100):
    history = load_history()
    return {"ok": True, "history": history[-limit:]}


# ---------- SSE stream ----------
@app.get("/api/stream")
async def stream(request: Request):
    q: asyncio.Queue = asyncio.Queue()
    _sse_clients.append(q)

    async def event_gen():
        try:
            yield f"data: {json.dumps({'type': 'hello'})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            if q in _sse_clients:
                _sse_clients.remove(q)

    return StreamingResponse(event_gen(), media_type="text/event-stream")


# ---------- Optional FastMCP tools ----------
# If you're exposing this to agents via FastMCP, mount them like so:
#
# from fastmcp import FastMCP
# mcp = FastMCP("sajil-tarq")
#
# @mcp.tool()
# def mcp_create_task(title: str, description: str = "", priority: str = "medium") -> dict:
#     return create_task(TaskCreate(title=title, description=description,
#                                   priority=priority, actor="agent"))["task"]
#
# @mcp.tool()
# def mcp_list_tasks(status: str | None = None) -> list:
#     tasks = load_tasks()
#     return [t for t in tasks if not status or t["status"] == status]
#
# @mcp.tool()
# def mcp_update_status(task_id: str, status: str) -> dict:
#     return update_task(task_id, TaskUpdate(status=status, actor="agent"))["task"]
#
# app.mount("/mcp", mcp.http_app())


def main():
    import uvicorn
    uvicorn.run("mcp_server:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    main()
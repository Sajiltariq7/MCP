import asyncio
import contextlib
from datetime import datetime, timezone
import json
import logging
import re
import secrets
import sys
import time
import uuid
from pathlib import Path

from loguru import logger
from mcp.server.fastmcp import Context, FastMCP
import requests

# ----------------------------------------------------
# SILENCE BACKGROUND HTTP & MCP SPAM
# ----------------------------------------------------
# Suppress standard Uvicorn access logs (POST /messages...) and MCP pings
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
logging.getLogger("mcp").setLevel(logging.WARNING)
logging.getLogger("mcp.server").setLevel(logging.WARNING)

# Instantiate FastMCP server
mcp = FastMCP("todo-list-server")

# FastAPI base URL
BASE_URL = "http://127.0.0.1:8190/api"

# ----------------------------------------------------
# LOGURU CONFIGURATION (CLEAN & TIDY FORMAT)
# ----------------------------------------------------
# 1. Clear default handlers
logger.remove()

# 2. Terminal Format: Clean, aligned, no emojis
# 1. Custom format with Emojis and Colors
terminal_format = (
    "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
    "<level>{level: <8}</level> | "
    "📌 <cyan>{function}:{line}</cyan> - "
    "<level>{message}</level>"
)

# 2. Add handler to stderr with colorize enabled
logger.add(
    sys.stderr,
    format=terminal_format,
    level="INFO",
    colorize=True,  # Enables colored output in terminal
)

# 4. Direct file logging (Detailed, plain text for disk)
logger.add(
    str(Path(__file__).resolve().parent.parent / "logs" / "mcp_activity.log"),
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {function}:{line} - {message}",
    rotation="5 MB",
    retention="7 days",
    level="INFO",
    enqueue=True,
)


# ----------------------------------------------------
# MCP TOOLS WITH FUNCTIONAL LOGGING
# ----------------------------------------------------
# Tools change one task at a time through GET/PATCH /api/tasks/{id}, so an agent and a person editing
# different fields of the same task never overwrite each other.
STATUSES = {"pending": "Pending", "in progress": "In Progress", "needs review": "Needs Review", "completed": "Completed"}
# The only moves an agent may make (AGENTS.md). Completed is reached through approve_task only.
NEXT_STATUS = {"Pending": "In Progress", "In Progress": "Needs Review"}


def normalize_status(status):
    """Same mapping as the backend: 'in_progress', 'IN PROGRESS', ... -> 'In Progress'."""
    return STATUSES.get((status or "").strip().lower().replace("_", " "))


def agent_actor(ctx: Context) -> str:
    """Name for the activity log, e.g. 'AI:opencode': the X-Agent-Name header, else the MCP client's name."""
    name = None
    try:
        request = ctx.request_context.request
        name = request.headers.get("x-agent-name") if request is not None else None
        name = name or ctx.session.client_params.clientInfo.name
    except (AttributeError, ValueError):
        pass
    return f"AI:{name or 'agent'}"


def api(method, path, **kwargs):
    """Call the REST API and return its JSON. Raises requests exceptions (404 included)."""
    response = requests.request(method, f"{BASE_URL}{path}", timeout=5, **kwargs)
    response.raise_for_status()
    return response.json()


def api_error(task_id, e):
    if isinstance(e, requests.exceptions.HTTPError) and e.response is not None and e.response.status_code == 404:
        return f"Task {task_id} not found."
    return f"Task API error: {e}"


@mcp.tool()
def add_task(ctx: Context, title: str, description: str = "", priority: str = "medium") -> str:
    """Add a new task. It starts in Pending."""
    actor = agent_actor(ctx)
    logger.info(f"{actor} creating task: '{title}' [Priority: {priority}]")
    task_id = str(int(time.time() * 1000))
    payload = {
        "id": task_id,
        "title": title,
        "description": description or "",
        "status": "Pending",
        "priority": priority.lower() if priority else "medium",
        "creator": actor,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "subtasks": [],
        "actor": actor,
    }
    try:
        api("POST", "/tasks", json=payload)
        logger.success(f"Task #{task_id} ('{title}') created.")
        return f"Task created: {title} (id {task_id}, status Pending)."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to create task '{title}': {e}")
        return f"Error adding task: {e}"


@mcp.tool()
def get_tasks() -> str:
    """List every task as JSON. Call this before changing any task."""
    logger.info("Fetching tasks list from backend...")
    try:
        return json.dumps(api("GET", "/tasks"))
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to fetch tasks: {e}")
        return f"Error fetching tasks: {e}"


@mcp.tool()
def update_task_status(ctx: Context, task_id: str, status: str, description: str = "") -> str:
    """Move a task one step forward: Pending -> In Progress -> Needs Review.

    Moving to Needs Review requires `description` with your results (or subtasks already on the task).
    To finish a task in Needs Review, call approve_task instead.
    """
    actor = agent_actor(ctx)
    target = normalize_status(status)
    if not target:
        return f"Unknown status '{status}'. Use one of: Pending, In Progress, Needs Review."
    try:
        task = api("GET", f"/tasks/{task_id}")
        current = task["status"]
        if target == current:
            return f"Task {task_id} is already {current}."
        if target == "Completed":
            return f"Task {task_id} can't be set to Completed directly. Move it to Needs Review, then call approve_task."
        if NEXT_STATUS.get(current) != target:
            allowed = NEXT_STATUS.get(current)
            hint = f"the next step is {allowed}" if allowed else "call approve_task to finish it" if current == "Needs Review" else "it is already finished"
            logger.warning(f"{actor} tried {current} -> {target} on Task #{task_id}: refused")
            return f"Can't move task {task_id} from {current} to {target}. Tasks go Pending -> In Progress -> Needs Review -> Completed; {hint}."
        if target == "Needs Review" and not description.strip() and not task.get("subtasks"):
            return f"Task {task_id} needs your results before review: pass them in `description` (or add subtasks with update_task_details first)."

        changes = {"status": target, "actor": actor}
        if description:
            changes["description"] = description
        api("PATCH", f"/tasks/{task_id}", json=changes)
        logger.success(f"{actor} moved Task #{task_id} {current} -> {target}.")
        return f"Task {task_id} moved from {current} to {target}."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to update Task #{task_id}: {e}")
        return api_error(task_id, e)


@mcp.tool()
def update_task_details(ctx: Context, task_id: str, description: str, subtasks: list = None) -> str:
    """Attach execution results, work notes, or a subtask checklist ([{"content": "...", "done": false}]) to a task."""
    actor = agent_actor(ctx)
    logger.info(f"{actor} updating details for Task #{task_id}")
    changes = {"description": description, "actor": actor}
    if subtasks is not None:
        changes["subtasks"] = subtasks
    try:
        api("PATCH", f"/tasks/{task_id}", json=changes)
        logger.success(f"Task #{task_id} details updated.")
        return f"Task {task_id} details updated."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to update details for Task #{task_id}: {e}")
        return api_error(task_id, e)


@mcp.tool()
def approve_task(ctx: Context, task_id: str) -> str:
    """Approve a task in Needs Review and move it to Completed."""
    actor = agent_actor(ctx)
    try:
        task = api("GET", f"/tasks/{task_id}")
        if task["status"] != "Needs Review":
            logger.warning(f"Task #{task_id} is {task['status']}, cannot approve.")
            return f"Task {task_id} can't be approved: it is {task['status']}, not Needs Review."
        api("PATCH", f"/tasks/{task_id}", json={"status": "Completed", "actor": actor})
        logger.success(f"{actor} approved Task #{task_id}.")
        return f"Task {task_id} ('{task['title']}') approved and moved to Completed."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to approve Task #{task_id}: {e}")
        return api_error(task_id, e)


@mcp.tool()
def bulk_approve_tasks(ctx: Context) -> str:
    """Approve every task in Needs Review and move them to Completed."""
    actor = agent_actor(ctx)
    try:
        waiting = [t for t in api("GET", "/tasks") if t["status"] == "Needs Review"]
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed bulk approval: {e}")
        return f"Failed to list tasks: {e}"
    if not waiting:
        return "No tasks are in Needs Review."

    approved, failed = [], []
    for task in waiting:
        try:
            api("PATCH", f"/tasks/{task['id']}", json={"status": "Completed", "actor": actor})
            approved.append(task["title"])
        except requests.exceptions.RequestException as e:
            failed.append(f"{task['title']} ({e})")
    logger.success(f"{actor} bulk approved {len(approved)} task(s), {len(failed)} failed.")
    result = f"Approved {len(approved)} task(s): {', '.join(approved) or 'none'}."
    return result + (f" Failed: {'; '.join(failed)}." if failed else "")


@mcp.tool()
def delete_task(ctx: Context, task_id: str) -> str:
    """Delete a task."""
    actor = agent_actor(ctx)
    logger.info(f"{actor} deleting Task #{task_id}")
    try:
        api("DELETE", f"/tasks/{task_id}", params={"actor": actor})
        logger.success(f"Task #{task_id} deleted.")
        return f"Task {task_id} deleted."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to delete Task #{task_id}: {e}")
        return api_error(task_id, e)


# ----------------------------------------------------
# API KEY GATE + CONNECTED AGENTS
# ----------------------------------------------------
# Every MCP request must carry "Authorization: Bearer <key>" (or "X-API-Key: <key>").
# The key lives in the taskboard backend and is created/rotated from the UI (Agents tab).
UI_ORIGINS = {"http://127.0.0.1:5500", "http://localhost:5500"}
KEY_TTL_S = 3  # with the 1 s watch below, a rotation cuts agents off within 5 seconds
_key_cache = {"key": None, "at": 0.0}
AGENTS = {}  # connection id -> {name, version, connected_at, session_id, token}


async def current_key():
    if time.monotonic() - _key_cache["at"] > KEY_TTL_S:
        try:
            r = await asyncio.to_thread(requests.get, f"{BASE_URL}/mcp/key", timeout=3)
            r.raise_for_status()
            _key_cache.update(key=r.json()["key"], at=time.monotonic())
        except requests.exceptions.RequestException as e:
            logger.error(f"Cannot fetch MCP API key from backend: {e}")
            _key_cache.update(key=None, at=0.0)  # fail closed, retry next request
    return _key_cache["key"]


async def _send_json(send, status, data, headers=()):
    body = json.dumps(data).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"), *headers]})
    await send({"type": "http.response.body", "body": body})


class AgentGate:
    """ASGI wrapper around the MCP SSE app: checks the API key and tracks who is connected."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        path = scope["path"]
        key = await current_key()

        # Public status for the taskboard UI (names only, never the key)
        if path == "/status":
            origin = headers.get("origin", "")
            cors = [(b"access-control-allow-origin", origin.encode())] if origin in UI_ORIGINS else []
            agents = [
                {"name": a["name"], "version": a["version"], "connected_at": a["connected_at"],
                 "key_valid": bool(key) and secrets.compare_digest(a["token"], key)}
                for a in AGENTS.values()
            ]
            return await _send_json(send, 200, {"server": mcp.name, "agents": agents}, cors)

        token = headers.get("authorization", "").removeprefix("Bearer ").strip() or headers.get("x-api-key", "")
        if not key:
            return await _send_json(send, 503, {"error": "Taskboard backend is offline, cannot check the API key."})
        if not token or not secrets.compare_digest(token, key):
            logger.warning(f"Rejected MCP request to {path}: missing or wrong API key")
            return await _send_json(send, 401, {"error": "Missing or invalid API key. Create one in the taskboard Agents tab."})

        if path == "/sse":
            conn_id = uuid.uuid4().hex
            AGENTS[conn_id] = conn = {
                "name": headers.get("x-agent-name") or "unknown agent", "version": "",
                "connected_at": datetime.now(timezone.utc).isoformat(), "session_id": None, "token": token,
            }
            logger.info(f"Agent connected ({len(AGENTS)} total)")

            async def send_and_spy(message):
                # The first SSE event tells the client its session id: remember it to match the handshake
                if conn["session_id"] is None and message["type"] == "http.response.body":
                    m = re.search(rb"session_id=([0-9a-f]+)", message.get("body", b""))
                    if m:
                        conn["session_id"] = m.group(1).decode()
                await send(message)

            async def until_key_rotated():
                # Returns once the key this agent connected with is no longer the current key
                while True:
                    await asyncio.sleep(1)
                    key = await current_key()
                    if key and not secrets.compare_digest(token, key):
                        return

            app_task = asyncio.ensure_future(self.app(scope, receive, send_and_spy))
            watch_task = asyncio.ensure_future(until_key_rotated())
            try:
                done, _ = await asyncio.wait({app_task, watch_task}, return_when=asyncio.FIRST_COMPLETED)
                if watch_task in done:
                    logger.warning(f"Agent '{conn['name']}' disconnected: the API key was rotated")
                    app_task.cancel()
                    await asyncio.gather(app_task, return_exceptions=True)
                    with contextlib.suppress(Exception):  # end the SSE stream so the client sees it close
                        await send({"type": "http.response.body", "body": b"", "more_body": False})
                else:
                    await app_task
            finally:
                watch_task.cancel()
                app_task.cancel()
                AGENTS.pop(conn_id, None)
                logger.info(f"Agent '{conn['name']}' disconnected ({len(AGENTS)} left)")

        if path.startswith("/messages"):
            # Peek at the JSON-RPC body: "initialize" carries clientInfo {name, version}
            chunks, more = [], True
            while more:
                message = await receive()
                chunks.append(message.get("body", b""))
                more = message.get("more_body", False)
            body = b"".join(chunks)
            self._note_client(scope, headers, body)

            replayed = False

            async def replay():
                nonlocal replayed
                if not replayed:
                    replayed = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return await receive()

            return await self.app(scope, replay, send)

        return await self.app(scope, receive, send)

    @staticmethod
    def _note_client(scope, headers, body):
        try:
            msg = json.loads(body)
        except ValueError:
            return
        if not isinstance(msg, dict) or msg.get("method") != "initialize":
            return
        info = msg.get("params", {}).get("clientInfo", {})
        session = re.search(r"session_id=([0-9a-f]+)", scope.get("query_string", b"").decode())
        for conn in AGENTS.values():
            if session and conn["session_id"] == session.group(1):
                if not headers.get("x-agent-name"):
                    conn["name"] = info.get("name") or conn["name"]
                conn["version"] = info.get("version", "")
                logger.success(f"Agent '{conn['name']}' {conn['version']} completed handshake")


if __name__ == "__main__":
    import uvicorn

    logger.info("Starting MCP Server on http://127.0.0.1:8001/sse (API key required)...")
    uvicorn.run(AgentGate(mcp.sse_app()), host="127.0.0.1", port=8001, log_level="warning")
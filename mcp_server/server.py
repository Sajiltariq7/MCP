import asyncio
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
from mcp.server.fastmcp import FastMCP
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
@mcp.tool()
def add_task(
    title: str, description: str = "", priority: str = "medium"
) -> str:
    """Add a new task via the FastAPI backend."""
    logger.info(f"Creating task: '{title}' [Priority: {priority}]")
    now = datetime.now(timezone.utc).isoformat()
    task_id = str(int(time.time() * 1000))

    payload = {
        "id": task_id,
        "title": title,
        "description": description or "",
        "status": "pending",
        "priority": priority.lower() if priority else "medium",
        "creator": "AI",
        "created_at": now,
        "started_at": None,
        "completed_at": None,
        "duration_ms": None,
        "subtasks": [],
        "actor": "AI_AGENT",
    }

    try:
        response = requests.post(
            f"{BASE_URL}/tasks", json=payload, timeout=5
        )
        response.raise_for_status()
        logger.success(f"Task #{task_id} ('{title}') created successfully.")
        return f"Task created successfully: {title}"
    except Exception as e:
        logger.error(f"Failed to create task '{title}': {str(e)}")
        return f"Error adding task: {str(e)}"


@mcp.tool()
def get_tasks() -> str:
    """Fetch all tasks from backend."""
    logger.info("Fetching tasks list from backend...")
    try:
        r = requests.get(f"{BASE_URL}/tasks", timeout=3)
        r.raise_for_status()
        logger.info("Successfully retrieved tasks list.")
        return r.text
    except Exception as e:
        logger.error(f"Failed to fetch tasks: {str(e)}")
        return f"Error fetching tasks: {str(e)}"


@mcp.tool()
def update_task_status(
    task_id: str, status: str, description: str = ""
) -> str:
    """Update task status and description."""
    logger.info(f"Updating Task #{task_id} status -> '{status}'")
    try:
        r = requests.get(f"{BASE_URL}/tasks", timeout=3)
        tasks = r.json()
        target = next(
            (t for t in tasks if str(t.get("id")) == str(task_id)), None
        )

        if not target:
            logger.warning(f"Task #{task_id} not found for status update.")
            return f"Task {task_id} not found."

        normalized_status = status.lower().replace(" ", "_")
        now = datetime.now(timezone.utc).isoformat()

        target["status"] = normalized_status
        if description:
            target["description"] = description
        target["actor"] = "AI_AGENT"

        if normalized_status == "in_progress" and not target.get("started_at"):
            target["started_at"] = now
        elif normalized_status == "completed":
            target["completed_at"] = now
            if target.get("started_at"):
                start_dt = datetime.fromisoformat(target["started_at"])
                end_dt = datetime.fromisoformat(now)
                target["duration_ms"] = int(
                    (end_dt - start_dt).total_seconds() * 1000
                )

        res = requests.post(
            f"{BASE_URL}/tasks", json=target, timeout=3
        )
        res.raise_for_status()
        logger.success(f"Task #{task_id} status updated to '{normalized_status}'.")
        return f"Success: Task {task_id} updated to '{normalized_status}'."
    except Exception as e:
        logger.error(f"Failed to update Task #{task_id}: {str(e)}")
        return f"Failed to update task: {str(e)}"


@mcp.tool()
def update_task_details(
    task_id: str, description: str, subtasks: list = None
) -> str:
    """Attach execution results, work notes, or subtask checklists to a task."""
    logger.info(f"Updating details/subtasks for Task #{task_id}")
    try:
        get_res = requests.get(f"{BASE_URL}/tasks", timeout=5)
        get_res.raise_for_status()
        tasks = get_res.json()

        target_task = next(
            (t for t in tasks if str(t.get("id")) == str(task_id)), None
        )
        if not target_task:
            logger.warning(f"Task #{task_id} not found for details update.")
            return f"Error: Task {task_id} not found."

        target_task["description"] = description
        if subtasks is not None:
            target_task["subtasks"] = subtasks
        target_task["actor"] = "AI_AGENT"

        post_res = requests.post(
            f"{BASE_URL}/tasks", json=target_task, timeout=5
        )
        post_res.raise_for_status()

        logger.success(f"Task #{task_id} details updated.")
        return f"Task {task_id} details updated with execution results."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to update details for Task #{task_id}: {str(e)}")
        return f"Failed to update task details: {str(e)}"


@mcp.tool()
def approve_task(task_id: str) -> str:
    """Approves a task in 'needs_review' and transitions it to 'completed'."""
    logger.info(f"Attempting approval for Task #{task_id}")
    try:
        get_res = requests.get(f"{BASE_URL}/tasks", timeout=5)
        get_res.raise_for_status()
        tasks = get_res.json()

        target_task = next(
            (t for t in tasks if str(t.get("id")) == str(task_id)), None
        )
        if not target_task:
            logger.warning(f"Task #{task_id} not found for approval.")
            return f"Error: Task {task_id} not found."

        if target_task.get("status") not in ["needs_review", "Needs Review"]:
            logger.warning(
                f"Task #{task_id} status is '{target_task.get('status')}', cannot approve."
            )
            return f"Task {task_id} cannot be approved because its status is '{target_task.get('status')}' (must be 'needs_review')."

        now = datetime.now(timezone.utc).isoformat()
        target_task["status"] = "completed"
        target_task["completed_at"] = now
        target_task["actor"] = "AI_AGENT"

        if target_task.get("started_at"):
            start_dt = datetime.fromisoformat(target_task["started_at"])
            end_dt = datetime.fromisoformat(now)
            target_task["duration_ms"] = int(
                (end_dt - start_dt).total_seconds() * 1000
            )

        post_res = requests.post(
            f"{BASE_URL}/tasks", json=target_task, timeout=5
        )
        post_res.raise_for_status()

        logger.success(f"Task #{task_id} approved and completed.")
        return f"Task {task_id} ('{target_task.get('title')}') has been APPROVED and moved to 'completed'."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to approve Task #{task_id}: {str(e)}")
        return f"Failed to approve task: {str(e)}"


@mcp.tool()
def bulk_approve_tasks() -> str:
    """Approves all tasks currently sitting in 'needs_review' and moves them to 'completed'."""
    logger.info("Executing bulk approval for tasks in 'needs_review'...")
    try:
        get_res = requests.get(f"{BASE_URL}/tasks", timeout=5)
        get_res.raise_for_status()
        tasks = get_res.json()

        approved_count = 0
        now = datetime.now(timezone.utc).isoformat()

        for task in tasks:
            if task.get("status") in ["needs_review", "Needs Review"]:
                task["status"] = "completed"
                task["completed_at"] = now
                task["actor"] = "AI_AGENT"

                if task.get("started_at"):
                    start_dt = datetime.fromisoformat(task["started_at"])
                    end_dt = datetime.fromisoformat(now)
                    task["duration_ms"] = int(
                        (end_dt - start_dt).total_seconds() * 1000
                    )

                requests.post(f"{BASE_URL}/tasks", json=task, timeout=5)
                approved_count += 1

        if approved_count == 0:
            logger.info("No tasks found in 'needs_review' status.")
            return "No tasks found in 'needs_review' status."

        logger.success(f"Bulk approved {approved_count} task(s).")
        return f"Successfully approved {approved_count} task(s) and moved them to 'completed'."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed bulk approval: {str(e)}")
        return f"Failed to bulk approve tasks: {str(e)}"


@mcp.tool()
def delete_task(task_id: str) -> str:
    """Delete a task via the FastAPI backend."""
    logger.info(f"Request to delete Task #{task_id}")
    try:
        response = requests.delete(
            f"{BASE_URL}/tasks/{task_id}",
            params={"actor": "AI_AGENT"},
            timeout=5,
        )
        response.raise_for_status()
        logger.success(f"Task #{task_id} deleted successfully.")
        return f"Task {task_id} deleted successfully."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to delete Task #{task_id}: {str(e)}")
        return f"Failed to delete task via API: {str(e)}"


# ----------------------------------------------------
# API KEY GATE + CONNECTED AGENTS
# ----------------------------------------------------
# Every MCP request must carry "Authorization: Bearer <key>" (or "X-API-Key: <key>").
# The key lives in the taskboard backend and is created/rotated from the UI (Agents tab).
UI_ORIGINS = {"http://127.0.0.1:5500", "http://localhost:5500"}
KEY_TTL_S = 5  # a rotated key takes effect within this many seconds
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

            try:
                return await self.app(scope, receive, send_and_spy)
            finally:
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
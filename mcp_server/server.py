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
CLIENTS = {}  # MCP session id -> {name, version, token, connected_at, last_seen}, from the initialize handshake
STREAMS = {}  # open event stream id -> {id, session_id, token, connected_at, name, kick}
ENDED = set()  # session ids ended from the board's Disconnect button; their requests get 404
NO_OAUTH = ("Missing or invalid API key. This server has no OAuth: copy the key from the taskboard Agents tab "
            "and send it as the header 'Authorization: Bearer <key>'.")


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
    """ASGI wrapper around the MCP app: checks the API key and tracks which agents are connected.

    Two transports share port 8001:
    - Streamable HTTP at /mcp (current MCP clients such as opencode). A POST/DELETE, or a GET carrying an
      mcp-session-id, sent to /sse is treated as Streamable HTTP too, so configs that point at /sse keep working.
    - Legacy SSE: a plain GET /sse opens the stream, then the client POSTs to /messages/.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)  # lifespan: starts the Streamable HTTP session manager

        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        path, method = scope["path"], scope["method"]
        key = await current_key()

        # Public status for the taskboard UI (names only, never the key)
        if path == "/status":
            origin = headers.get("origin", "")
            cors = [(b"access-control-allow-origin", origin.encode())] if origin in UI_ORIGINS else []
            return await _send_json(send, 200, {"server": mcp.name, "agents": connected_agents(key)}, cors)

        # Disconnect button on the board: POST /agents/<id>/disconnect with the API key (CORS: board only)
        disconnect = re.fullmatch(r"/agents/([\w-]+)/disconnect", path)
        origin = headers.get("origin", "")
        cors = [(b"access-control-allow-origin", origin.encode())] if origin in UI_ORIGINS else []
        if disconnect and method == "OPTIONS":
            return await _send_json(send, 200, {}, cors + [(b"access-control-allow-methods", b"POST"),
                                                         (b"access-control-allow-headers", b"authorization")])

        # No OAuth here: answer discovery/registration with 404 so clients don't start an OAuth flow
        if path.startswith("/.well-known/") or path == "/register":
            return await _send_json(send, 404, {"error": NO_OAUTH})

        # Ending a session needs no key: opencode sends this DELETE without its headers, and a session id is an
        # unguessable value the server issued. Without this, closed sessions would linger on the Agents tab.
        if method == "DELETE" and path in ("/mcp", "/sse") and headers.get("mcp-session-id") in CLIENTS:
            CLIENTS.pop(headers["mcp-session-id"], None)
            return await self.app({**scope, "path": "/mcp", "raw_path": b"/mcp"}, receive, send)

        token = headers.get("authorization", "").removeprefix("Bearer ").strip() or headers.get("x-api-key", "")
        if not key:
            return await _send_json(send, 503, {"error": "Taskboard backend is offline, cannot check the API key."})
        if not token or not secrets.compare_digest(token, key):
            logger.warning(f"Rejected MCP request to {method} {path}: missing or wrong API key")
            return await _send_json(send, 401, {"error": NO_OAUTH})

        if disconnect and method == "POST":
            name = disconnect_agent(disconnect.group(1))
            if not name:
                return await _send_json(send, 404, {"error": "No connected agent with that id."}, cors)
            return await _send_json(send, 200, {"disconnected": name}, cors)

        if path == "/sse" and (method != "GET" or "mcp-session-id" in headers):
            scope = {**scope, "path": "/mcp", "raw_path": b"/mcp"}
            path = "/mcp"

        session_id = headers.get("mcp-session-id") or _query_session(scope)
        if session_id in ENDED:
            return await _send_json(send, 404, {"error": "This session was ended from the taskboard. Reconnect to start a new one."})
        if session_id in CLIENTS:
            CLIENTS[session_id]["last_seen"] = time.monotonic()

        if method == "GET" and path in ("/sse", "/mcp"):
            return await self._stream(scope, receive, send, token, session_id)

        if method == "DELETE" and path == "/mcp":
            CLIENTS.pop(session_id, None)

        if method == "POST" and (path == "/mcp" or path.startswith("/messages")):
            body = await _read_body(receive)
            info = _initialize_info(body)
            if info is not None:
                name = headers.get("x-agent-name") or info.get("name") or "unknown agent"
                client = {"name": name, "version": info.get("version", ""), "token": token,
                          "connected_at": datetime.now(timezone.utc).isoformat(), "last_seen": time.monotonic()}
                if path == "/mcp":
                    send = _capture_session(send, client)  # the session id arrives in the response header
                else:
                    CLIENTS[session_id] = client
                    logger.success(f"Agent '{name}' {client['version']} completed handshake (SSE)")
            return await self.app(scope, _replay(body, receive), send)

        return await self.app(scope, receive, send)

    async def _stream(self, scope, receive, send, token, session_id):
        """An open event stream = a connected agent. Closed by the server if the key is rotated away."""
        conn_id = uuid.uuid4().hex
        STREAMS[conn_id] = conn = {"id": conn_id, "session_id": session_id, "token": token, "name": None,
                                   "connected_at": datetime.now(timezone.utc).isoformat(), "kick": asyncio.Event()}
        _agent_name(conn)  # Streamable HTTP: the handshake already named this session

        async def send_and_spy(message):
            # Legacy SSE: the first event tells the client its session id; remember it to match the handshake
            if conn["session_id"] is None and message["type"] == "http.response.body":
                m = re.search(rb"session_id=([0-9a-f]+)", message.get("body", b""))
                if m:
                    conn["session_id"] = m.group(1).decode()
            await send(message)

        async def until_closed_by_board():
            # Returns the reason once the board disconnects this agent or rotates the key it connected with
            while True:
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(conn["kick"].wait(), timeout=1)
                    return "the Disconnect button on the taskboard"
                key = await current_key()
                if key and not secrets.compare_digest(token, key):
                    return "the API key was rotated"

        app_task = asyncio.ensure_future(self.app(scope, receive, send_and_spy))
        watch_task = asyncio.ensure_future(until_closed_by_board())
        try:
            done, _ = await asyncio.wait({app_task, watch_task}, return_when=asyncio.FIRST_COMPLETED)
            if watch_task in done:
                logger.warning(f"Agent '{_agent_name(conn)}' disconnected: {watch_task.result()}")
                conn["name"] = _agent_name(conn)
                CLIENTS.pop(conn["session_id"], None)
                app_task.cancel()
                await asyncio.gather(app_task, return_exceptions=True)
                with contextlib.suppress(Exception):  # end the stream so the client sees it close
                    await send({"type": "http.response.body", "body": b"", "more_body": False})
            else:
                await app_task
        finally:
            watch_task.cancel()
            app_task.cancel()
            STREAMS.pop(conn_id, None)
            name = _agent_name(conn)
            if scope["path"] == "/sse":  # legacy SSE: the session ends with its stream
                CLIENTS.pop(conn["session_id"], None)
            logger.info(f"Agent '{name}' stream closed ({len(STREAMS)} open)")


def _query_session(scope):
    m = re.search(r"session_id=([0-9a-f]+)", scope.get("query_string", b"").decode())
    return m.group(1) if m else None


def _agent_name(conn):
    """The handshake name; kept on the stream too, because a client may end its session before the stream closes."""
    name = CLIENTS.get(conn["session_id"], {}).get("name")
    if name:
        conn["name"] = name
    return conn["name"] or "unknown agent"


def connected_agents(key):
    """Agents for /status, one entry per agent (same name and version). One client can hold several MCP
    sessions (opencode opens a few), so each entry lists its session `ids` and a `sessions` count."""
    groups = {}
    for s in _sessions(key):
        g = groups.setdefault((s["name"], s["version"], s["key_valid"]), {**s, "ids": [], "sessions": 0})
        g["ids"].append(s["id"])
        g["sessions"] += 1
        g["connected_at"] = min(g["connected_at"], s["connected_at"])
    return [{k: v for k, v in g.items() if k != "id"} for g in groups.values()]


def _sessions(key):
    """Every open stream, plus Streamable HTTP sessions active in the last 2 minutes."""
    valid = lambda token: bool(key) and secrets.compare_digest(token, key)
    agents, seen = [], set()
    for conn in STREAMS.values():
        client = CLIENTS.get(conn["session_id"], {})
        seen.add(conn["session_id"])
        agents.append({"id": conn["session_id"] or conn["id"], "name": _agent_name(conn), "version": client.get("version", ""),
                       "connected_at": conn["connected_at"], "key_valid": valid(conn["token"])})
    for session_id, client in CLIENTS.items():
        if session_id not in seen and valid(client["token"]) and time.monotonic() - client["last_seen"] < 120:
            agents.append({"id": session_id, "name": client["name"], "version": client["version"],
                           "connected_at": client["connected_at"], "key_valid": True})
    return agents


def disconnect_agent(agent_id):
    """End an agent's session and close its stream. Returns its name, or None if no such agent.
    The agent can connect again with the key; rotating the key keeps it out."""
    conns = [c for c in STREAMS.values() if agent_id in (c["id"], c["session_id"])]
    session_id = conns[0]["session_id"] if conns else agent_id
    if not conns and session_id not in CLIENTS:
        return None
    name = _agent_name(conns[0]) if conns else CLIENTS[session_id]["name"]
    if session_id:
        ENDED.add(session_id)
        CLIENTS.pop(session_id, None)
    for conn in conns:
        conn["kick"].set()
    logger.warning(f"Agent '{name}' disconnected from the taskboard")
    return name


async def _read_body(receive):
    chunks, more = [], True
    while more:
        message = await receive()
        chunks.append(message.get("body", b""))
        more = message.get("more_body", False)
    return b"".join(chunks)


def _replay(body, receive):
    """Give the app the body we already read, then hand over to the real receive (for disconnects)."""
    sent = False

    async def replay():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()
    return replay


def _initialize_info(body):
    """clientInfo {name, version} if this JSON-RPC body is an initialize request, else None."""
    try:
        msg = json.loads(body)
    except ValueError:
        return None
    if isinstance(msg, dict) and msg.get("method") == "initialize":
        return msg.get("params", {}).get("clientInfo", {}) or {}
    return None


def _capture_session(send, client):
    async def send_and_capture(message):
        if message["type"] == "http.response.start":
            session_id = dict(message.get("headers", [])).get(b"mcp-session-id")
            if session_id:
                CLIENTS[session_id.decode()] = client
                logger.success(f"Agent '{client['name']}' {client['version']} completed handshake (Streamable HTTP)")
        await send(message)
    return send_and_capture


if __name__ == "__main__":
    import uvicorn
    from starlette.applications import Starlette

    # One app, both transports: Streamable HTTP (/mcp) and legacy SSE (/sse + /messages/)
    http_app, sse_app = mcp.streamable_http_app(), mcp.sse_app()
    app = Starlette(routes=[*http_app.routes, *sse_app.routes], lifespan=lambda _: mcp.session_manager.run())

    logger.info("Starting MCP Server on http://127.0.0.1:8001/mcp (Streamable HTTP) and /sse (SSE); API key required")
    uvicorn.run(AgentGate(app), host="127.0.0.1", port=8001, log_level="warning")

import asyncio
import base64
import contextlib
import inspect
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
from mcp.server.fastmcp import Context, FastMCP, Image
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
    """Turn an API failure into a message the agent can act on (the API explains refused moves)."""
    response = getattr(e, "response", None)
    if response is not None and response.status_code == 404:
        return f"Task {task_id} not found."
    if response is not None and 400 <= response.status_code < 500:
        try:
            return f"Refused: {response.json()['detail']}"
        except (ValueError, KeyError, TypeError):
            pass
    return f"Task API error: {e}"


EVIDENCE = {"screenshot", "attachment", "none"}
MAX_EVIDENCE_BYTES = 10 * 1024 * 1024


@mcp.tool()
def add_task(ctx: Context, title: str, description: str = "", priority: str = "medium",
             evidence: str = "screenshot", evidence_details: str = "") -> str:
    """Add a new task. It always starts in Pending.

    evidence: proof needed before the task can go to Needs Review:
      "screenshot" (default) - at least one image of the result,
      "attachment" - any file; say which in evidence_details (required),
      "none" - no proof needed.
    evidence_details: what the evidence should show, e.g. "the login page after the fix".
    To give whoever does the task material to work from (a mockup, a screenshot of the bug), call
    attach_reference with the new task's id. Evidence itself is attached later, while In Progress.
    """
    actor = agent_actor(ctx)
    evidence = (evidence or "screenshot").strip().lower()
    if evidence not in EVIDENCE:
        return f"Unknown evidence '{evidence}'. Use screenshot, attachment or none."
    if evidence == "attachment" and not evidence_details.strip():
        return "Say what attachment is needed in evidence_details."
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
        "evidence_type": evidence,
        "evidence_note": evidence_details.strip(),
        "actor": actor,
    }
    try:
        api("POST", "/tasks", json=payload)
        logger.success(f"Task #{task_id} ('{title}') created.")
        return f"Task created: {title} (id {task_id}, status Pending, evidence: {evidence})."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to create task '{title}': {e}")
        return api_error(task_id, e)


@mcp.tool()
def get_tasks() -> str:
    """List every task as JSON. Call this before changing any task.

    Each task has:
      comments - notes from people; kind "sent_back" says why a reviewer sent the task back. Read these first
                 when a task you worked on is In Progress or Pending again.
      evidence_type / evidence_note - proof needed before Needs Review (screenshot, attachment or none).
      delete_request - set when an agent asked to delete this In Progress task and a person hasn't decided yet.
      attachments - files on the task, each with an id and a kind:
                    "reference" - material to work from (mockups, bug screenshots). Open them with read_attachment
                                  before you start the task.
                    "evidence"  - proof of finished work, attached with attach_evidence while In Progress.
    """
    logger.info("Fetching tasks list from backend...")
    try:
        return json.dumps(api("GET", "/tasks"))
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to fetch tasks: {e}")
        return f"Error fetching tasks: {e}"


@mcp.tool()
def update_task_status(ctx: Context, task_id: str, status: str, description: str = "") -> str:
    """Move a task one step forward: Pending -> In Progress -> Needs Review.

    Moving to Needs Review requires `description` with your results (or subtasks already on the task),
    and the evidence the task asks for (see evidence_type; attach it with attach_evidence while In Progress).
    Starting a task (Pending -> In Progress)? Read its reference attachments first with read_attachment.
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


def _attach(ctx: Context, task_id: str, kind: str, file_path: str, content_base64: str, filename: str, note: str) -> str:
    """Upload a file to the task as `kind` ("reference" or "evidence")."""
    actor = agent_actor(ctx)
    if file_path:
        path = Path(file_path).expanduser()
        if not path.is_file():
            return f"No file at {file_path}."
        if path.stat().st_size > MAX_EVIDENCE_BYTES:
            return "The file is larger than 10 MB."
        content_base64 = base64.b64encode(path.read_bytes()).decode()
        filename = filename or path.name
    if not content_base64 or not filename:
        return "Give file_path, or content_base64 together with filename."
    try:
        att = api("POST", f"/tasks/{task_id}/attachments",
                  json={"filename": filename, "content_base64": content_base64, "kind": kind, "note": note, "actor": actor})
        logger.success(f"{actor} attached {kind} '{att['filename']}' to Task #{task_id}.")
        return f"Attached {kind} {att['filename']} ({att['content_type']}, {att['size']} bytes, id {att['id']}) to task {task_id}."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to attach {kind} to Task #{task_id}: {e}")
        return api_error(task_id, e)


@mcp.tool()
def attach_evidence(ctx: Context, task_id: str, file_path: str = "", content_base64: str = "",
                    filename: str = "", note: str = "") -> str:
    """Attach EVIDENCE: proof of the work you did, e.g. a screenshot of the finished result (max 10 MB).

    Only while the task is In Progress (refused in Pending, Needs Review and Completed).
    Give file_path (a file on this machine, e.g. a screenshot you saved), or content_base64 plus filename.
    Tasks whose evidence_type is "screenshot" need an image (png, jpg, gif, webp) before Needs Review;
    "attachment" accepts any file. note: what the file shows.
    Not for material to work from: use attach_reference for that.
    """
    return _attach(ctx, task_id, "evidence", file_path, content_base64, filename, note)


@mcp.tool()
def attach_reference(ctx: Context, task_id: str, file_path: str = "", content_base64: str = "",
                     filename: str = "", note: str = "") -> str:
    """Attach a REFERENCE file: material whoever does the task should look at, e.g. a mockup, a screenshot of
    the bug, a design or a sample file (max 10 MB). Allowed at any time, usually right after add_task.

    Give file_path (a file on this machine), or content_base64 plus filename.
    note: what it is and how to use it, e.g. "make the page look like this".
    References are not evidence: they never count toward moving a task to Needs Review.
    """
    return _attach(ctx, task_id, "reference", file_path, content_base64, filename, note)


@mcp.tool()
def read_attachment(attachment_id: str):
    """Open a task's attachment (reference or evidence) by its id, from the task's `attachments` in get_tasks.

    Images come back as an image you can look at; text files (txt, md, csv, json, ...) as text.
    Before starting a task, read its reference files: they show what to build or fix.
    """
    try:
        response = requests.get(f"{BASE_URL}/attachments/{attachment_id}", timeout=10)
        if response.status_code == 404:
            return f"No attachment with id {attachment_id}."
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        return f"Task API error: {e}"
    content_type = response.headers.get("content-type", "").split(";")[0].strip()
    if content_type in ("image/png", "image/jpeg", "image/gif", "image/webp"):
        return Image(data=response.content, format=content_type.split("/")[1])
    if content_type.startswith("text/") or content_type in ("application/json", "application/xml", "application/csv"):
        text = response.content.decode("utf-8", errors="replace")
        return text if len(text) <= 50_000 else text[:50_000] + "\n... (cut at 50,000 characters)"
    return (f"Attachment {attachment_id} is {content_type or 'a binary file'} ({len(response.content)} bytes) and can't be "
            f"shown here. It is downloadable at {BASE_URL}/attachments/{attachment_id}.")


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
def delete_task(ctx: Context, task_id: str, reason: str = "") -> str:
    """Delete a task. Agents must always give a reason, and may only:

      Pending      - delete it. It goes to the board's Deleted tab with your reason.
      In Progress  - REQUEST deletion. The task stays until a person approves or rejects the request on the
                     board; their answer appears in the task's comments (kind "delete_rejected" if kept).
      Needs Review / Completed - not allowed. Ask a person instead.
    """
    actor = agent_actor(ctx)
    reason = (reason or "").strip()
    if not reason:
        return "Refused: agents can't delete a task without a reason. Call delete_task again with `reason`."
    try:
        task = api("GET", f"/tasks/{task_id}")
        status = task["status"]
        if status == "Pending":
            api("DELETE", f"/tasks/{task_id}", params={"actor": actor, "reason": reason})
            logger.success(f"{actor} deleted Pending Task #{task_id}: {reason}")
            return f"Task {task_id} deleted (it was Pending). It is on the board's Deleted tab with your reason."
        if status == "In Progress":
            if task.get("delete_request"):
                return f"Task {task_id} already has a deletion request waiting for a person: {task['delete_request']['reason']}"
            api("POST", f"/tasks/{task_id}/delete-request", json={"reason": reason, "actor": actor})
            logger.info(f"{actor} requested deletion of In Progress Task #{task_id}: {reason}")
            return (f"Task {task_id} is In Progress, so it was not deleted. A deletion request was sent; a person "
                    f"approves or rejects it on the board. Check the task's comments for the answer.")
        logger.warning(f"{actor} tried to delete Task #{task_id} in {status}: refused")
        return f"Refused: agents can't delete tasks in {status}. Ask a person to delete it on the board."
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
            return await _send_json(send, 200, {"server": mcp.name, "agents": connected_agents(key), "tools": await tool_catalog()}, cors)

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


async def tool_catalog():
    """Every MCP tool with its description and parameters, so the board can list them for people."""
    catalog = []
    for tool in await mcp.list_tools():
        schema = tool.inputSchema or {}
        required = set(schema.get("required", []))
        catalog.append({
            "name": tool.name,
            "description": inspect.cleandoc(tool.description or ""),
            "params": [{"name": name, "required": name in required, "default": spec.get("default")}
                       for name, spec in schema.get("properties", {}).items()],
        })
    return catalog


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

# MCP tools

**Status:** Built. An MCP server named `todo-list-server` gives AI agents seven task tools, each a call to the task API.
**Verified:** 2026-10-13 at c080fd5 (plus the uncommitted sync and lifecycle changes)
**Source:** `mcp_server/server.py`

The server speaks Streamable HTTP at `http://127.0.0.1:8001/mcp` and, for older clients, SSE at `http://127.0.0.1:8001/sse` ([ADR 0010](adrs/0010-serve-streamable-http-alongside-sse.md)) and needs the [task API](task-api.md) running at `http://127.0.0.1:8190/api`. It never opens the database ([ADR 0003](adrs/0003-agents-use-mcp-server-over-rest-api.md)).

## Tools

| Tool | Arguments | Does |
| --- | --- | --- |
| `add_task` | `title`, `description`, `priority` | Creates a Pending task with an id from the current time in ms, creator `AI:<agent name>` |
| `get_tasks` | none | Returns the API's task list as raw JSON text |
| `update_task_status` | `task_id`, `status`, `description` | Moves the task one step: Pending to In Progress, or In Progress to Needs Review (needs results in `description` or existing subtasks). Refuses anything else and names the next step |
| `update_task_details` | `task_id`, `description`, `subtasks` | Replaces the description and, if given, the subtask list |
| `approve_task` | `task_id` | Moves one task from Needs Review to Completed; refuses any other status |
| `bulk_approve_tasks` | none | Moves every Needs Review task to Completed and lists any that failed |
| `delete_task` | `task_id` | Deletes the task |

Every write sends `actor: AI:<agent name>`, so the activity log shows which agent did it. The name is the `X-Agent-Name` header if sent, else `clientInfo.name` from the MCP handshake. Tools read one task with `GET /api/tasks/{id}` and send only the changed fields with `PATCH`, so they never overwrite a person's edits to other fields. Tools return an error string instead of raising.

The rules agents follow when they use these tools (call `get_tasks` first, go through In Progress, describe the work, approve to finish) are in [core.md](invariants/core.md). The full path of a call is in [the agent update flow](flows/agent-task-update.md).

## API key and connected agents

Both transports are wrapped by `AgentGate` in `mcp_server/server.py`. A `POST` (or a `GET` with an `mcp-session-id`) to `/sse` is routed to Streamable HTTP, so configs pointing at `/sse` keep working. "Connected" means an open event stream, or a Streamable HTTP session active in the last 2 minutes.

| Request | Result |
| --- | --- |
| Any MCP request with `Authorization: Bearer <key>` or `X-API-Key: <key>` matching the backend key | Passed through |
| Missing or wrong key | `401` |
| Backend unreachable, so the key can't be checked | `503` (fails closed) |
| `GET /status` | Public JSON for the board: server name plus each connected agent's `id`, `name`, `version`, `connected_at`, `key_valid`. Never the key. CORS allows only the board's origin |
| `POST /agents/{id}/disconnect` with the key | The board's **Disconnect** button: closes that agent's stream and ends its session (later requests with that session get `404`). The agent can connect again with the key; rotating the key keeps it out. CORS allows only the board's origin |

- The key comes from `GET /api/mcp/key` and is cached for 3 seconds. Each open connection rechecks it every second, so after a rotation the server closes connections that use the old key within 5 seconds; new requests with the old key get `401`.
- An agent's name comes from `clientInfo` in the MCP `initialize` request, or from an `X-Agent-Name` header if sent.
- `task check-mcp` runs `mcp_server/check_gate.py`, an end-to-end check with a real MCP client: the key gate on both transports, agent names in the log, the task order rules, grouping sessions per agent, and Disconnect. `--rotate` also tests closing connections on rotation (it rotates the real key).

## Logging

loguru writes to stderr (coloured, INFO and up) and to a log file under the repo's logs folder (`mcp_activity.log`, rotated at 5 MB, kept 7 days). The logs folder is gitignored. Uvicorn and MCP library logs are cut to WARNING.

## Clients

Agents register `todo-list-server` in their own config with the key from the board's Agents tab: `opencode mcp add todo-list-server --url http://127.0.0.1:8001/mcp --header "Authorization=Bearer <key>" --global`, or `claude mcp add --transport http todo-list-server http://127.0.0.1:8001/mcp --header "Authorization: Bearer <key>"`. The repo's `opencode.json` has no `todo-list-server` entry on purpose: a project entry overrides the user's global one, and it could not hold the key without committing it.

OAuth discovery and registration paths (`/.well-known/*`, `/register`) return `404`, so clients that get a `401` don't start an OAuth flow; the `401` body says to send the key. It also registers a `calculator-server`, which is a separate project not in this repo.

## Open questions

- The `calculator-server` entry in `opencode.json` points to a path on one developer's machine.

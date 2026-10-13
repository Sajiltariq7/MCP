# MCP tools

**Status:** Built. An MCP server named `todo-list-server` gives AI agents seven task tools, each a call to the task API.
**Verified:** 2026-10-13 at 7e3d6ae
**Source:** `mcp_server/server.py`, `opencode.json`

The server runs over SSE at `http://127.0.0.1:8001/sse` ([ADR 0008](adrs/0008-return-mcp-server-to-sse.md)) and needs the [task API](task-api.md) running at `http://127.0.0.1:8190/api`. It never opens the database ([ADR 0003](adrs/0003-agents-use-mcp-server-over-rest-api.md)).

## Tools

| Tool | Arguments | Does |
| --- | --- | --- |
| `add_task` | `title`, `description`, `priority` | Creates a `pending` task with an id from the current time in ms, creator `AI` |
| `get_tasks` | none | Returns the API's task list as raw JSON text |
| `update_task_status` | `task_id`, `status`, `description` | Sets any status (lowercased, spaces to `_`), optionally replaces the description |
| `update_task_details` | `task_id`, `description`, `subtasks` | Replaces the description and, if given, the subtask list |
| `approve_task` | `task_id` | Moves one task from Needs Review to `completed`; refuses any other status |
| `bulk_approve_tasks` | none | Moves every Needs Review task to `completed` |
| `delete_task` | `task_id` | Deletes the task |

Every write sends `actor: AI_AGENT`, so the activity log shows the agent. Updates fetch the full list, change one task, and POST the whole task back. Tools return an error string instead of raising.

The rules agents follow when they use these tools (call `get_tasks` first, go through In Progress, describe the work, approve to finish) are in [core.md](invariants/core.md). The full path of a call is in [the agent update flow](flows/agent-task-update.md).

## API key and connected agents

The SSE app is wrapped by `AgentGate` in `mcp_server/server.py`.

| Request | Result |
| --- | --- |
| Any MCP request with `Authorization: Bearer <key>` or `X-API-Key: <key>` matching the backend key | Passed through |
| Missing or wrong key | `401` |
| Backend unreachable, so the key can't be checked | `503` (fails closed) |
| `GET /status` | Public JSON for the board: server name plus each connected agent's `name`, `version`, `connected_at`, `key_valid`. Never the key. CORS allows only the board's origin |

- The key comes from `GET /api/mcp/key` and is cached for 5 seconds, so a rotation takes effect within 5 seconds. Connections opened with the old key show `key_valid: false` and their calls get `401`.
- An agent's name comes from `clientInfo` in the MCP `initialize` request, or from an `X-Agent-Name` header if sent.
- `task check-mcp` runs `mcp_server/check_gate.py`, an end-to-end check of all of the above. It rotates the key at the end.

## Logging

loguru writes to stderr (coloured, INFO and up) and to a log file under the repo's logs folder (`mcp_activity.log`, rotated at 5 MB, kept 7 days). The logs folder is gitignored. Uvicorn and MCP library logs are cut to WARNING.

## Clients

`opencode.json` registers `todo-list-server` as a remote SSE server and sends `Authorization: Bearer {env:TASKBOARD_MCP_KEY}`, so the key never sits in a committed file. Other setups paste the config copied from the board's Agents tab. It also registers a `calculator-server`, which is a separate project not in this repo.

## Not built yet

- `update_task_status` does not refuse a jump from Pending to Needs Review or Completed.

## Open questions

- `bulk_approve_tasks` does not check each POST, so it can count a task as approved when the API rejected it.
- The `calculator-server` entry in `opencode.json` points to a path on one developer's machine.

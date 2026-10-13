# Backend invariants

For the task API, the database, the MCP server, and reports. Read [core.md](core.md) first.

| Rule | Status | Enforced in |
| --- | --- | --- |
| Python logs go to `sys.stderr` through loguru, never stdout ([ADR 0009](../adrs/0009-proposal-first-workflow-and-stderr-logging.md)) | Convention | Review |
| The task API is the only writer of the database; the MCP server calls the API over HTTP ([ADR 0003](../adrs/0003-agents-use-mcp-server-over-rest-api.md)) | Convention | Review |
| Every create, update, and delete through the API adds one `activity_logs` row naming the actor | Current | `backend/app.py` |
| MCP tools that write send `actor: AI:<agent name>` | Current | `mcp_server/server.py`, `task check-mcp` |
| MCP tools change tasks with `PATCH` (only the changed fields), never by posting the whole task | Current | `mcp_server/server.py` |
| Every stored timestamp is UTC ISO 8601; `init_db` converts older local ones | Current | `backend/database.py`, `task check-api` |
| The API sets `started_at`, `completed_at`, and `duration_ms` on status changes and keeps stored values on update | Current | `backend/app.py` |
| `init_db` only creates tables; it never inserts seed tasks | Convention | Review |
| The database lives in `data/tasks.db` under the repo root and is not committed | Current | `backend/database.py` |
| MCP tools return an error string instead of raising | Convention | Review |

## Before you finish

1. Run `task check-api`; with `task dev` running, run `task check-mcp` and call the tool or route you changed.
2. Update [task-api.md](../task-api.md) or [mcp-tools.md](../mcp-tools.md), and the flow if a step changed.

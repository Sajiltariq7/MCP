# Task API and storage

**Status:** Built. A FastAPI service owns the SQLite database and is the only writer of tasks and the activity log.
**Verified:** 2026-10-13 at c080fd5 (plus the uncommitted sync and lifecycle changes)
**Source:** `backend/app.py`, `backend/database.py`, `backend/report.py`

Everything that changes a task, from the board or from an agent, goes through this API ([ADR 0003](adrs/0003-agents-use-mcp-server-over-rest-api.md)). It listens on `127.0.0.1:8190`. Browsers may call it only from the board (`http://127.0.0.1:5500` or `http://localhost:5500`), so other websites can't read the MCP key or change tasks.

## Routes

| Method and path | Does | Writes |
| --- | --- | --- |
| `GET /api/tasks` | Returns every task (oldest first), status normalized, subtasks parsed from JSON | Nothing |
| `GET /api/tasks/{id}` | Returns one task, 404 if missing | Nothing |
| `POST /api/tasks` | Creates the task if the `id` is new, otherwise replaces every field (upsert). `?restore=true` marks an undone delete | `tasks` row, one `activity_logs` row (`CREATE_TASK`, `RESTORE_TASK` or `UPDATE_TASK`) |
| `PATCH /api/tasks/{id}` | Changes only the fields sent (`title`, `description`, `status`, `priority`, `due_date`, `subtasks`) and returns the task; 404 if missing | Those columns, one `UPDATE_TASK` log row |
| `DELETE /api/tasks/{id}?actor=` | Deletes the task, 404 if missing | Deletes the row, one `DELETE_TASK` log row |
| `GET /api/audit` | Returns the activity log, newest first | Nothing |
| `GET /api/mcp/key` | Returns the MCP API key | Nothing |
| `POST /api/mcp/key/rotate` | Makes a new key (`tb_` + 32 random URL-safe characters); the old one stops working | `settings` row, one `ROTATE_KEY` log row |

Prefer `PATCH` for changes: two editors working on different fields of the same task then both keep their edits. The board and the MCP tools both use it.

## Statuses and timestamps

The API stores one of four canonical statuses. It accepts any spelling (`in_progress`, `IN PROGRESS`, `Needs Review`) and maps unknown values to `Pending`.

| On POST, when the status becomes | The API sets |
| --- | --- |
| `In Progress` and `started_at` is empty | `started_at` = now (UTC) |
| `Needs Review` or `Completed`, and the status changed | `completed_at` = now, `duration_ms` = now − `started_at` |

On update, the API keeps its own `started_at`, `completed_at`, and `duration_ms` and ignores the values the caller sends. On create (and restore), it takes the caller's values, converted to UTC. The API itself does not check the order of statuses; the MCP tools do ([the lifecycle flow](flows/task-lifecycle.md)).

## Data

Database file: `data/tasks.db` under the repo root, created on first start by `init_db`, whatever the working directory. It holds no seed data.

Every stored timestamp is UTC ISO 8601 (`...+00:00`), so the activity log sorts correctly as text. On every start `init_db` converts any older timestamp without an offset (taken as this machine's local time) to UTC.

| Table | Columns |
| --- | --- |
| `tasks` | `id` (text key), `title`, `description`, `status`, `priority`, `due_date`, `creator`, `created_at`, `started_at`, `completed_at`, `duration_ms`, `subtasks` (JSON text) |
| `activity_logs` | `id`, `timestamp`, `actor`, `action`, `entity_type`, `entity_id`, `details` |
| `settings` | `key`, `value`. Holds `mcp_api_key`, created on first start |

`actor` is whatever the caller sends: the board sends `USER`, the MCP server sends `AI:<agent name>` (older rows say `AI_AGENT`). Nothing checks it.

## Weekly report

`backend/report.py` prints the activity log of the last 7 days as a table plus counts by action and by actor. Run it with `task report`.

## Not built yet

- Authentication on this API. Any local process can read the MCP key, change or delete tasks, and choose its own `actor`; only browsers on other origins are blocked. The key protects the [MCP server](mcp-tools.md), not this API.
- Lifecycle checks in the API itself (they live in the MCP tools).

`task check-api` runs `backend/check_api.py`: the API in-process on a temporary copy of the database (migration, PATCH, timestamps, restore).

## Open questions

- None right now.

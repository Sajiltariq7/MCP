# Task API and storage

**Status:** Built. A FastAPI service owns the SQLite database and is the only writer of tasks and the activity log.
**Verified:** 2026-10-13 at 6bdfa0e (uncommitted working tree)
**Source:** `backend/app.py`, `backend/database.py`, `backend/report.py`

Everything that changes a task, from the board or from an agent, goes through this API ([ADR 0003](adrs/0003-agents-use-mcp-server-over-rest-api.md)). It listens on `127.0.0.1:8190` with CORS open to any origin.

## Routes

| Method and path | Does | Writes |
| --- | --- | --- |
| `GET /api/tasks` | Returns every task, status normalized, subtasks parsed from JSON | Nothing |
| `POST /api/tasks` | Creates the task if the `id` is new, otherwise replaces its fields (upsert) | `tasks` row, one `activity_logs` row (`CREATE_TASK` or `UPDATE_TASK`) |
| `DELETE /api/tasks/{id}?actor=` | Deletes the task, 404 if missing | Deletes the row, one `DELETE_TASK` log row |
| `GET /api/audit` | Returns the activity log, newest first | Nothing |

There is no single-task GET. Callers fetch the whole list and pick the task out.

## Statuses and timestamps

The API stores one of four canonical statuses. It accepts any spelling (`in_progress`, `IN PROGRESS`, `Needs Review`) and maps unknown values to `Pending`.

| On POST, when the status becomes | The API sets |
| --- | --- |
| `In Progress` and `started_at` is empty | `started_at` = now (UTC) |
| `Needs Review` or `Completed`, and the status changed | `completed_at` = now, `duration_ms` = now − `started_at` |

On update, the API keeps its own `started_at`, `completed_at`, and `duration_ms` and ignores the values the caller sends. On create, it takes the caller's values. The order of statuses is not checked; see [the lifecycle flow](flows/task-lifecycle.md).

## Data

Database file: `data/tasks.db` under the repo root, created on first start by `init_db`, whatever the working directory. It holds no seed data.

| Table | Columns |
| --- | --- |
| `tasks` | `id` (text key), `title`, `description`, `status`, `priority`, `due_date`, `creator`, `created_at`, `started_at`, `completed_at`, `duration_ms`, `subtasks` (JSON text) |
| `activity_logs` | `id`, `timestamp`, `actor`, `action`, `entity_type`, `entity_id`, `details` |

`actor` is whatever the caller sends: the board sends `USER`, the MCP server sends `AI_AGENT`. Nothing checks it.

## Weekly report

`backend/report.py` prints the activity log of the last 7 days as a table plus counts by action and by actor. Run it with `task report`.

## Not built yet

- Authentication. Any local process can read, change, or delete tasks and choose its own `actor`.
- Lifecycle checks on the server.
- Tests.

## Open questions

- `DELETE` logs a local-time timestamp; everything else logs UTC. The report compares them as strings.

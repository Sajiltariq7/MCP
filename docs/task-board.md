# Task board

**Status:** Built. A static web page where people view, create, move, and delete tasks and read the activity log.
**Verified:** 2026-10-13 at 6bdfa0e (uncommitted working tree; the UI was being restyled during this check)
**Source:** `frontend/index.html`, `frontend/script.js`, `frontend/style.css`

The board is plain HTML, CSS, and JavaScript with no build step. `task frontend` serves the folder on `127.0.0.1:5500`. It talks to the [task API](task-api.md) at the address in the `API` constant at the top of `frontend/script.js`.

## Views

| View | Shows |
| --- | --- |
| Board | Four columns, one per status, with live timers on In Progress cards and durations on finished ones |
| Manager | All tasks as a table |
| Activity | The activity log from `GET /api/audit` |

A modal creates or edits a task (title, description, priority, status, due date). Cards open a detail view and a per-task history.

## Online and standalone

| Situation | Behaviour |
| --- | --- |
| API reachable | Loads tasks and the log from the API, marks itself connected, and POSTs every change with `actor: USER` |
| API unreachable | Uses the copy in browser `localStorage` (`mcp_engine_tasks`, `mcp_engine_logs`) and keeps working offline |

The board writes every change to `localStorage` first, then to the API. It loads data on page open and when the refresh button is pressed; it does not poll, so agent changes appear after a refresh.

## Not built yet

- Offline changes are not synced back. The next successful load replaces the `localStorage` copy with the API's, so they are lost.
- Any status can be picked in the edit modal, so the lifecycle order is not enforced here.

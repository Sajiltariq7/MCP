# Task board

**Status:** Built. A static web page where people view, create, move, and delete tasks and read the activity log.
**Verified:** 2026-10-13 at c080fd5 (plus the uncommitted sync and lifecycle changes)
**Source:** `frontend/index.html`, `frontend/script.js`, `frontend/style.css`

The board is plain HTML, CSS, and JavaScript with no build step. `task frontend` serves the folder on `127.0.0.1:5500`. It talks to the [task API](task-api.md) at the address in the `API` constant at the top of `frontend/script.js`.

## Views

| View | Shows |
| --- | --- |
| Board | Four columns, one per status. Drag a card to another column to change its status. Cards show live timers, durations, creator (human or AI agent), and Edit and Delete buttons |
| Manager | All tasks as a table |
| Activity | The activity log from `GET /api/audit`, sorted by real time, filtered by All, Agent (actor contains `AI`) or Human |
| Report | JSON for a day or a Monday-to-Sunday week, built in the browser from tasks and the log, with `instructions_for_llm` and a `field_guide` so an agent can write the report. Copy or download it |
| Agents | MCP server status and connected agents from the MCP server's `/status`, plus the API key (show, copy, rotate) and ready-made client configs |

A modal creates or edits a task (title, description, priority, status, due date). Clicking a card opens its details: status, subtasks, and that task's history. Delete happens at once and shows an **Undo** toast for 8 seconds; Undo restores the task with its timestamps (`POST /api/tasks?restore=true`). Cards past their due date show an **Overdue** chip.

On touch screens, hold a card for 0.3 seconds, then drag it to a column; the page scrolls by itself near the top and bottom edges. A quick swipe still scrolls.

Agent entries show the agent's name (from `AI:<name>` actors). With the Activity filter on Agent, a picker narrows the log to one agent.

The look follows the Inkpop design language (ink outlines, flat pastels, hard shadows); `frontend/style.css` starts with its stylesheet unchanged, followed by the board's own rules.

## Online and standalone

| Situation | Behaviour |
| --- | --- |
| API reachable | Loads tasks and the log from the API, marks itself connected, and sends every change with `actor: USER`: `PATCH` with only the changed fields, `POST` for new or restored tasks |
| API unreachable | Uses the copy in browser `localStorage` (`mcp_engine_tasks`, `mcp_engine_logs`), keeps working, and queues each change in an outbox (`mcp_engine_outbox`). The header says "Offline · N changes waiting" |
| API back | The next sync replays the outbox in order, then loads the API's data |

The board writes every change to `localStorage` first, then to the API (or the outbox). It reloads tasks every 5 seconds and re-renders only when something changed; it skips a refresh while a dialog is open, a card is being dragged, or the browser tab is hidden. It also polls the MCP server's `/status` every 5 seconds for the Agents tab.

## Not built yet

- People can move a task to any status (by design); only agents are held to the order.

# Task board

**Status:** Built. A static web page where people view, create, move, and delete tasks and read the activity log.
**Verified:** 2026-10-13 at 7e3d6ae
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

A modal creates or edits a task (title, description, priority, status, due date). Clicking a card opens its details: status, subtasks, and that task's history. Delete asks for confirmation.

The look follows the Inkpop design language (ink outlines, flat pastels, hard shadows); `frontend/style.css` starts with its stylesheet unchanged, followed by the board's own rules.

## Online and standalone

| Situation | Behaviour |
| --- | --- |
| API reachable | Loads tasks and the log from the API, marks itself connected, and POSTs every change with `actor: USER` |
| API unreachable | Uses the copy in browser `localStorage` (`mcp_engine_tasks`, `mcp_engine_logs`) and keeps working offline |

The board writes every change to `localStorage` first, then to the API. It loads tasks on page open and when the refresh button is pressed; it does not poll tasks, so agent changes appear after a refresh. It polls the MCP server's `/status` every 5 seconds for the Agents tab.

## Not built yet

- Offline changes are not synced back. The next successful load replaces the `localStorage` copy with the API's, so they are lost.
- Any status can be picked in the edit modal, so the lifecycle order is not enforced here.

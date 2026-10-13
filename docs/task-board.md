# Task board

**Status:** Built. A static web page where people view, create, move, and delete tasks and read the activity log.
**Verified:** 2026-10-13 at c080fd5 (plus the uncommitted sync and lifecycle changes)
**Source:** `frontend/index.html`, `frontend/script.js`, `frontend/style.css`

The board is plain HTML, CSS, and JavaScript with no build step. `task frontend` serves the folder on `127.0.0.1:5500`. It talks to the [task API](task-api.md) at the address in the `API` constant at the top of `frontend/script.js`.

## Views

| View | Shows |
| --- | --- |
| Board | Four columns, one per status, each sorted oldest first (`created_at`) and paged 20 cards at a time. One page number for the whole board (as many pages as the fullest column needs), Prev/Next beside the heading, and a `start–end of total` range under each column header; search resets to page 1. Drag a card to another column to change its status. Cards show live timers, durations, creator (human or AI agent), and Edit and Delete buttons |
| Manager | All tasks as a table, filterable by creator (Human or an agent by name); while searching, best matches first |
| Activity | The activity log from `GET /api/audit`, sorted by real time, filtered by All, Agent (actor contains `AI`) or Human |
| Report | JSON for a day or a Monday-to-Sunday week, built in the browser from tasks and the log, with `instructions_for_llm` and a `field_guide` so an agent can write the report. Copy or download it |
| Deleted | Every deleted task with everything it had (status at deletion, who, when and why, description, dates, files, comments, subtasks), newest first. **Restore** puts it back; **Delete forever** (asks first) removes it and its files |
| Agents | MCP server status and connected agents from the MCP server's `/status`, plus the API key (show, copy, rotate) and ready-made client configs |

A modal creates or edits a task: title, description, priority, due date, and **evidence needed before review** (Screenshot, the default; Another attachment, with a required note saying which; or None). It has no status field: new tasks start in Pending, and status changes go through drag or the detail view. Clicking a card opens its details: status, subtasks, and that task's history. Status moves follow the API's rules (see [task API](task-api.md)): a refused move shows a toast naming the next step, the detail view's status picker greys out moves that aren't allowed, and a move to Needs review without the required evidence offers **Open task**. Moving back from Needs review or Completed opens a dialog asking why; the reason is shown on the card ("Sent back: ...") and in the detail view's Comments, and agents read it. The detail view's **Evidence** section shows what is needed, thumbnails of attached files, and **Attach file** (any file, 10 MB each). Cards show a chip: "Screenshot needed" until it is attached, then "N attached". Tasks have **reference files** (material to work from: added on the New task form or from the detail view, in any status) and **evidence** (proof of the work: attached only while In progress; the detail view explains this in other statuses). Search (header) is fuzzy: every word must match the title, description or creator as text, as letters in order (`dshbrd`), or with one typo (`dashbaord`). Deleting a task in Needs review or Completed asks why; other deletes happen at once. When an agent asks to delete an In progress task, its card and detail view show the request with **Approve delete** (deletes it, recording the agent's reason) and **Keep it** (asks why; the agent reads the answer in the comments). Every delete shows an **Undo** toast for 8 seconds; Undo restores the task with its timestamps (`POST /api/tasks?restore=true`). Cards past their due date show an **Overdue** chip.

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

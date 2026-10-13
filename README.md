# MCP Task Manager

A local task board that people and AI agents share. People drag cards around in the browser; AI agents (opencode, Claude Code, anything that speaks [MCP](https://modelcontextprotocol.io)) work the same tasks through MCP tools. Every change from either side lands in one activity log, so you can always see who did what.

It runs only on your machine (`127.0.0.1`). Nothing is deployed.

<p align="center"><img src="docs/images/board.png" alt="The task board: four columns (Pending, In progress, Needs review, Completed) with pastel task cards, and Tick the clipboard mascot saying 4 tasks are waiting for review" width="900"></p>

## Contents

- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Connect an AI agent](#connect-an-ai-agent)
- [The task lifecycle](#the-task-lifecycle)
- [Using the board](#using-the-board)
- [MCP tools](#mcp-tools)
- [REST API](#rest-api)
- [Project layout](#project-layout)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Docs](#docs)

## How it works

<p align="center"><img src="docs/diagrams/architecture.svg" alt="Architecture: the task board and the MCP server both call the REST API, which stores everything in SQLite. AI agents connect to the MCP server with an API key." width="900"></p>

| Part | Address | Code | Job |
| --- | --- | --- | --- |
| Task board | `http://127.0.0.1:5500` | `frontend/` | The web UI. Plain HTML, CSS and JavaScript, no build step. |
| REST API | `http://127.0.0.1:8190/api` | `backend/` | FastAPI. The only thing that reads or writes the database. |
| MCP server | `http://127.0.0.1:8001/mcp` | `mcp_server/` | Gives AI agents task tools. Checks the API key on every request. Also serves `/sse` for older clients. |
| Database | `data/tasks.db` | `backend/database.py` | SQLite: tasks, the activity log, and the MCP API key. Created on first start. |

The MCP server never touches the database itself: its tools call the REST API, so people and agents follow exactly the same rules.

## Quick start

You need [uv](https://docs.astral.sh/uv/) (Python manager) and [Task](https://taskfile.dev/) (command runner).

```bash
uv sync      # install Python and dependencies
task dev     # start the REST API, MCP server and board together
```

Open **http://127.0.0.1:5500**. The header shows **Live · synced** when the board can reach the API.

No Task? Run each part in its own terminal from the repo root:

```bash
uv run uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8190 --reload
uv run python mcp_server/server.py
uv run python -m http.server 5500 --bind 127.0.0.1 -d frontend
```

## Commands

Run `task` on its own to list these.

| Command | What it does |
| --- | --- |
| `task install` | `uv sync`: install dependencies |
| `task dev` | Start the REST API, MCP server and board together (Ctrl+C stops all three) |
| `task backend` | REST API on :8190, reloads when backend code changes |
| `task mcp` | MCP server on :8001. Needs the backend running |
| `task frontend` | Serve the board on :5500 |
| `task report` | Print the last 7 days of activity in the terminal |
| `task check-api` | Check the REST API in-process on a copy of the database. No server needed |
| `task check-mcp` | End-to-end check of the MCP server: key gate, both transports, task order, agent names, Disconnect. Keeps your key; add `--rotate` (`uv run python mcp_server/check_gate.py --rotate`) to also test rotation |

## Connect an AI agent

<p align="center"><img src="docs/diagrams/agent-connect.svg" alt="Connecting an agent in four steps: make a key on the Agents tab, paste the config into the agent, the agent connects with an Authorization Bearer header, then it shows up by name. A wrong or missing key gets 401." width="900"></p>

Agents need an API key. There is one key, it lives in the database, and you manage it on the board's **Agents** tab: **Show**, **Copy key**, **Rotate key**.

1. Start everything with `task dev` and open the **Agents** tab.
2. Press **Copy command** for opencode or Claude Code on that tab (or **Copy config** for opencode's JSON). The copied text already contains the key.
3. Start your agent. Within 5 seconds it appears under **Connected agents** with its name and version.

**opencode.** Run this once (`--global` saves it to your own opencode config, not this repo's committed `opencode.json`):

```bash
opencode mcp add todo-list-server --url http://127.0.0.1:8001/mcp --header "Authorization=Bearer <your key>" --global
```

Or paste the copied JSON config into your opencode config. This repo's `opencode.json` deliberately has **no** `todo-list-server` entry: a project entry would override your global one (and couldn't hold the key without committing it).

**Claude Code:**

```bash
claude mcp add --transport http todo-list-server http://127.0.0.1:8001/mcp --header "Authorization: Bearer <your key>"
```

**Connected before?** Run the add command again after every key rotation:

- **opencode:** re-running `opencode mcp add` replaces the old entry in your global config. A project's `opencode.json` with its own `todo-list-server` block overrides the global one, so delete that block (opencode has no remove command). `opencode debug config` shows which files define it.
- **Claude Code:** `claude mcp remove todo-list-server`, then add it again.

**Any other MCP client:** use Streamable HTTP at `http://127.0.0.1:8001/mcp` (or legacy SSE at `http://127.0.0.1:8001/sse`) and send `Authorization: Bearer <key>` (or `X-API-Key: <key>`) on every request.

Good to know:

- The agent's name comes from the MCP handshake (for example `opencode`). Send an `X-Agent-Name` header to show a name of your choice instead.
- A missing or wrong key gets `401`. If the REST API is down, the MCP server answers `503`, because it can't check the key.
- **Rotating** the key disconnects every connected agent within 5 seconds. They can reconnect once you give them the new key.
- Everything an agent does is logged under its name (`AI:opencode`, for example), so the Activity tab can show one agent at a time.

## The task lifecycle

<p align="center"><img src="docs/diagrams/task-lifecycle.svg" alt="Task lifecycle: Pending, then In progress (records started_at), then Needs review (records duration), then Completed (approved). On the board a card can be dragged to any column." width="900"></p>

| Status | Meaning | What gets recorded |
| --- | --- | --- |
| **Pending** | Waiting for someone to pick it up | `created_at` |
| **In progress** | Being worked on; the card shows a live timer | `started_at` |
| **Needs review** | Work is done and waiting for a person to check it | `completed_at`, `duration_ms` |
| **Completed** | Approved | `completed_at`, `duration_ms` |

The API enforces the order for everyone, people and agents:

- **Pending** can only go to **In progress**. No jumping straight to review or done.
- **Needs review** needs the task's **evidence**: a screenshot (the default for new tasks) or the attachment the task asks for. Evidence is attached **while the task is In progress**, from its detail view or with the `attach_evidence` MCP tool.
- **Reference files** are different: material to work from (a mockup, a screenshot of the bug), added any time, including on the New task form. Agents add them with `attach_reference` and look at them with `read_attachment`.
- **Deleting** a task in Needs review or Completed asks why. Deleted tasks go to the **Deleted** tab.
- **Agents** must always give a reason to delete, can delete only Pending tasks, and for In progress tasks can only *ask*: the card shows the request with **Approve delete** / **Keep it**.
- **Sending a task back** from Needs review, or reopening a completed one (back to review or to work), asks **why**. The reason shows on the card as "Sent back: ..." and in the task's comments, and agents read it with `get_tasks`.
- Agents are stricter still: they only move forward one step, and only `approve_task` / `bulk_approve_tasks` complete a task.

## Using the board

The header has five tabs, a search box (filters the Board and Manager), and **New task**.

| Tab | What it's for |
| --- | --- |
| **Board** | Kanban columns. Drag a card to change its status (on a phone: hold it, then drag). Each card has **Edit** and **Delete** buttons; click the card for details, subtasks and that task's full history. Each column lists oldest first, 20 cards per page: **Prev** / **Next** beside the heading, and each column shows its range (e.g. `21–40 of 45`). Refreshes itself every 5 seconds. |
| **Manager** | All tasks in one table with status, creator and duration. Filter by creator; the search box forgives typos and abbreviations. |
| **Activity** | Every action, newest first. Filter by **All**, **Agent** or **Human**, and on Agent pick one agent by name. |
| **Deleted** | Every deleted task with all its information and why it was deleted. **Restore** it, or **Delete forever**. |
| **Report** | Builds a JSON summary of a day or a week for an AI to write up (below). |
| **Agents** | Is the MCP server running, which agents are connected (with a **Disconnect** button each), the API key, and every tool agents can call with its parameters (read live from the MCP server). |

Cards made by an agent carry a pink chip with the agent's name; cards made by people say **Human**. Cards past their due date show **Overdue**. Deleting a task shows an **Undo** button for 8 seconds.

If the API is offline, the board keeps working in your browser and queues your changes; the header says **Offline · N changes waiting**. They are sent, in order, as soon as the API is back.

### Reports

The board doesn't write reports. It hands you clean JSON that any LLM, even a small one, can turn into a report.

1. Open **Report** and pick **Day** or **Week** (Monday to Sunday), then a date.
2. Press **Copy JSON** or **Download .json**.
3. Give it to your agent with: *"Write the report from this JSON. Follow instructions_for_llm exactly."*

<p align="center"><img src="docs/images/report.png" alt="The Report tab in Week mode, with summary tiles and the generated JSON" width="900"></p>

The JSON is built to be followed literally:

| Key | Contains |
| --- | --- |
| `instructions_for_llm` | Numbered steps: heading, summary, sections, and "never invent facts" |
| `period` | Day or week, a readable label, exact start and end with timezone |
| `summary` | Counts: tasks with activity, created, started, moved to review, completed, deleted, time spent, human vs agent actions |
| `needs_attention` | Titles waiting for review, overdue, still in progress |
| `tasks` | One entry per task touched in the period: status, `events_in_period`, time spent, subtasks, and its activity |
| `deleted_tasks` | Tasks deleted in the period |
| `per_day` | Week reports only: completions and actions for each day |
| `field_guide` | A plain-English meaning for the trickier keys |

## MCP tools

What a connected agent can call ([details](docs/mcp-tools.md)):

| Tool | What it does |
| --- | --- |
| `get_tasks` | List every task. Agents call this before changing anything. |
| `add_task(title, description, priority, evidence, evidence_details)` | Create a Pending task; `evidence` is `screenshot` (default), `attachment` (say which) or `none` |
| `attach_evidence(task_id, file_path or content_base64 + filename, note)` | Attach proof of the finished work, while In progress (10 MB max) |
| `attach_reference(task_id, file_path or content_base64 + filename, note)` | Attach material to work from, e.g. a mockup (any status) |
| `read_attachment(attachment_id)` | Open an attachment: images come back as images the model can see |
| `update_task_status(task_id, status, description)` | Move a task one step forward (refuses skipped steps; review needs results) |
| `update_task_details(task_id, description, subtasks)` | Attach results, notes or a subtask checklist |
| `approve_task(task_id)` | Move one task from Needs review to Completed |
| `bulk_approve_tasks()` | Approve every task in Needs review; lists any that failed |
| `delete_task(task_id, reason)` | Reason required. Pending: deleted. In progress: sends a deletion request a person approves or rejects. Needs review / Completed: refused |

## REST API

Base URL `http://127.0.0.1:8190/api` ([details](docs/task-api.md)). Browsers may only call it from the board's own address, so other websites can't read your key or change your tasks.

| Method and path | What it does |
| --- | --- |
| `GET /tasks` | All tasks |
| `GET /tasks/{id}` | One task |
| `POST /tasks` | Create a task, or replace all its fields. `?restore=true` for an undone delete |
| `PATCH /tasks/{id}` | Change only the fields you send; `comment` is required to send a task back |
| `POST /tasks/{id}/attachments` | Attach evidence (`filename`, `content_base64`) |
| `GET /attachments/{id}` | Download an attached file |
| `DELETE /tasks/{id}?reason=` | Delete a task (kept for the Deleted tab) |
| `GET /tasks/deleted` | Deleted tasks |
| `POST /tasks/{id}/restore` | Restore a deleted task |
| `DELETE /tasks/deleted/{id}` | Remove a deleted task for good |
| `GET /audit` | The activity log |
| `GET /mcp/key` | The current MCP API key |
| `POST /mcp/key/rotate` | Make a new key; the old one stops working |

## Project layout

```text
backend/
  app.py            REST API (FastAPI)
  database.py       SQLite schema, settings and activity log helpers
  report.py         terminal activity report (task report)
  check_api.py      API checks on a copy of the database (task check-api)
mcp_server/
  server.py         MCP tools + the API key gate and agent tracking
  check_gate.py     end-to-end MCP checks (task check-mcp)
frontend/
  index.html        the board (all five tabs)
  script.js         board logic: rendering, drag and drop, reports, agents
  style.css         Inkpop design system + board styles
docs/               rules, flows, decisions (start at docs/index.md)
  diagrams/         the diagrams in this README
data/               the database and evidence files (gitignored, created on first start)
logs/               MCP server logs (gitignored)
Taskfile.yaml       the task commands
opencode.json       project opencode config (no taskboard entry: add it with --global)
```

## Environment variables

None. Ports are fixed in the code, and the API key is created, stored and rotated by the board (Agents tab), so there is no `.env` file. Agents keep the key in their own (global) config.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Header says **Offline · saving locally** | The REST API isn't running. Start it with `task backend` or `task dev`. |
| Agents tab says **MCP server offline** | Run `task mcp`. It needs the REST API running first. |
| Agent gets `401` or is disconnected | The key is missing or old (it was rotated). Copy the command again from the Agents tab and rerun it. |
| opencode says "Method Not Allowed (HTTP 405)" | The MCP server is an older version that only spoke SSE. Restart it (`task mcp`) and use `/mcp` in the add command. |
| opencode says "Dynamic Client Registration rejected (HTTP 401)" | opencode sent no key, then tried OAuth (this server has none). Usually a project `opencode.json` defines `todo-list-server` without the key and overrides your global entry: delete that block. Check with `opencode debug config`. |
| Agent says "Can't move task ... from Pending to Completed" | Working as intended: agents go one step at a time and finish with `approve_task`. |
| Agent gets `503` | The MCP server can't reach the REST API to check the key. Start the backend. |
| `task dev` fails with "address already in use" (Windows) | An earlier run left Python processes behind. Find them with `netstat -ano \| findstr ":8190 :8001 :5500"` and stop them with `taskkill /PID <pid> /T /F`. |
| Backend changes don't show up | The auto-reload sometimes misses edits on Windows. Stop and rerun `task backend`. |

## Docs

- [docs/index.md](docs/index.md): what everything is and where to find it
- [docs/flows/](docs/flows/index.md): what happens step by step (task lifecycle, agent updates)
- [docs/adrs/](docs/adrs/index.md): why things are the way they are
- [AGENTS.md](AGENTS.md): rules for AI agents working on this repo. Check docs with `uv run scripts/check_docs.py`.

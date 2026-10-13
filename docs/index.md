# MCP Task Manager docs

The map of everything written down about the MCP Task Manager.

**In one line:** a task board shared by people (web UI) and AI agents (MCP tools), backed by one FastAPI service on SQLite. Overview: [../README.md](../README.md). Rules for these docs: [docs-standard.md](docs-standard.md).

## Reading order

```text
AGENTS.md -> invariants/core.md + one rule doc -> this page -> topic page -> source
```

## Domains

| Domain | Start here | What it covers |
| --- | --- | --- |
| **Task API** | [task-api.md](task-api.md) | REST routes, statuses and timestamps, the SQLite tables, the weekly report |
| **Agent tools** | [mcp-tools.md](mcp-tools.md) | The seven MCP tools, logging, client config |
| **Task board** | [task-board.md](task-board.md) | The web UI, its views, and standalone mode |

| Cross-cutting | Where | Read it for |
| --- | --- | --- |
| Rules | [invariants/index.md](invariants/index.md) | What must always hold |
| Decisions | [adrs/index.md](adrs/index.md) | Why it is the way it is |
| Flows | [flows/index.md](flows/index.md) | What happens when |

## I want to know...

| Question | Go to |
| --- | --- |
| How do I start everything? | [../README.md](../README.md) |
| Which ports and URLs are used, and where are they set? | [invariants/tooling.md](invariants/tooling.md) |
| What does each MCP tool do? | [mcp-tools.md](mcp-tools.md) |
| What happens when an agent changes a task? | [flows/agent-task-update.md](flows/agent-task-update.md) |
| Who sets `started_at` and `duration_ms`? | [flows/task-lifecycle.md](flows/task-lifecycle.md) |
| What are the rules for an agent operating tasks? | [invariants/core.md](invariants/core.md) |
| Where is the database, and what is in it? | [task-api.md](task-api.md) |
| Why does the board work without the backend? | [task-board.md](task-board.md) |
| Why /mcp and /sse, not stdio? | [adrs/0010-serve-streamable-http-alongside-sse.md](adrs/0010-serve-streamable-http-alongside-sse.md) |
| Why must logs never go to stdout? | [adrs/0009-proposal-first-workflow-and-stderr-logging.md](adrs/0009-proposal-first-workflow-and-stderr-logging.md) |

## Glossary

| Name | What it is | Where in code |
| --- | --- | --- |
| todo-list-server | The MCP server's name, as agents register it (`opencode mcp add`, `claude mcp add`) | `mcp_server/server.py` |
| MCP engine | Older name for the board and API (API title, `localStorage` keys) | `backend/app.py`, `frontend/script.js` |
| Taskboard | The board's current title | `frontend/index.html` |
| actor | Who made a change, as sent by the caller: `USER` (board) or `AI:<agent name>` (MCP; older rows `AI_AGENT`) | `backend/app.py` |
| creator | Who created a task: `human` or `AI` | `backend/database.py` |
| Needs Review | Work done and documented, waiting for approval | `backend/app.py` |
| Standalone mode | The board running from `localStorage` while the API is down; changes wait in the outbox | `frontend/script.js` |
| Tick | The board's mascot, which comments on progress | `frontend/script.js` |
| activity log | The `activity_logs` table; the board's Activity view | `backend/database.py` |

## How to search

| To find | Run |
| --- | --- |
| A term in the docs | `rg -n "term" docs README.md AGENTS.md` |
| A term in the code | `rg -n "term" backend mcp_server frontend` |
| An MCP tool | `rg -n "@mcp.tool" -A2 mcp_server` |
| The decision behind something | `rg -il "topic" docs/adrs`, or `git log -S"text" --oneline` |
| Rules not enforced by code | `rg -n "Convention\|Planned" docs/invariants` |
| What is not built | `rg -n -i "not built\|open question" docs` |

## What lives where

| Kind | Where | Rule |
| --- | --- | --- |
| Router and hard rules | `AGENTS.md` | Under 100 lines |
| Topic pages | `docs/<topic>.md` | Status, Verified, Source lines |
| Rules | `docs/invariants/` | Current, Convention, or Planned |
| Decisions | `docs/adrs/` | Superseded, never edited |
| Flows | `docs/flows/` | One cross-file process each |
| Docs checker | `scripts/check_docs.py` | Run before finishing |

## Keeping the docs true

1. Change docs in the same change as the behaviour.
2. Label pages Built, Partial, or Planned; label rules Current, Convention, or Planned.
3. A new decision gets an ADR. A reversed one gets a new ADR that supersedes it.
4. Link every new page from its index.
5. Update a page's Verified line when you confirm it against the source.
6. Run `uv run scripts/check_docs.py` and fix every error.

## Known gaps

- The pages were verified against an uncommitted working tree (the folder restructure, port 8190, `Taskfile.yaml`). Re-verify after it is committed, and write the layout ADR.
- The board was being restyled during verification; recheck [task-board.md](task-board.md) when that work lands.
- The stderr logging rule holds only in the MCP server; the backend has no loguru setup.
- The `calculator-server` entry in `opencode.json` uses one machine's absolute paths.
- Checks exist (`task check-api`, `task check-mcp`) but there is no CI.

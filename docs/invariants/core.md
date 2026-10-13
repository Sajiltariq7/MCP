# Core invariants

For every task, including an AI agent operating tasks through the `todo-list-server` MCP tools. Read this first.

| Rule | Status | Enforced in |
| --- | --- | --- |
| Call `get_tasks` before making updates or triage decisions | Convention | Review |
| Tasks move in order: Pending, In Progress, Needs Review, Completed ([ADR 0004](../adrs/0004-four-step-task-lifecycle-with-approval.md)); going back from Needs Review or Completed needs a comment saying why | Current | `backend/app.py` (`check_move`), `task check-api` |
| Agents only move forward, one step at a time | Current | `mcp_server/server.py` (`NEXT_STATUS`), `task check-mcp` |
| A task reaches Needs Review only with the evidence it asks for (screenshot or attachment) | Current | `backend/app.py` (`missing_evidence`), `task check-api`, `task check-mcp` |
| Never move a task from Pending straight to Needs Review or Completed; set In Progress first so `started_at` is recorded | Convention | Review |
| When moving a task to Needs Review, put the details, notes, or results in `description` or `subtasks` | Convention | Review |
| An agent reaches Completed only through `approve_task` or `bulk_approve_tasks` | Current | `mcp_server/server.py`, `task check-mcp` |
| `approve_task` completes only tasks in Needs Review | Current | `mcp_server/server.py` |
| Agents read and change tasks only through the MCP tools or the task API, never the database file ([ADR 0003](../adrs/0003-agents-use-mcp-server-over-rest-api.md)) | Convention | Review |
| The stored status is one of Pending, In Progress, Needs Review, Completed | Current | `backend/app.py` |
| Never hardcode, print, paste, or commit secrets; `.env` stays untracked | Current | `.gitignore` |

## Before you finish

1. If you changed task data, call `get_tasks` and confirm the result.
2. Read the rule doc for your kind of task.

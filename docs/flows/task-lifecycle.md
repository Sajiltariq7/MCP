# Flow: a task's lifecycle

Durations on the board are only right when a task passes through every status in order. ([ADR 0004](../adrs/0004-four-step-task-lifecycle-with-approval.md))

```mermaid
stateDiagram-v2
    [*] --> Pending: add_task or New task
    Pending --> InProgress: sets started_at
    InProgress --> NeedsReview: sets completed_at, duration_ms
    NeedsReview --> Completed: approve_task or bulk_approve_tasks
    Completed --> [*]
```

`InProgress` is `In Progress` and `NeedsReview` is `Needs Review` in the stored data.

## Steps in order

1. **Pending.** A task is created by `add_task` (creator `AI`) or the board (creator `human`). The API writes the `tasks` row and a `CREATE_TASK` log row.
2. **In Progress.** On the first move here the API sets `started_at`. The board starts a live timer.
3. **Needs Review.** The API sets `completed_at` and `duration_ms` from `started_at`. Agents attach results to the description or subtasks before this move ([core.md](../invariants/core.md)).
4. **Completed.** `approve_task` or `bulk_approve_tasks` moves the task here. Because the status changed, the API sets `completed_at` and `duration_ms` again, so the final duration runs until approval.

Each move adds one `UPDATE_TASK` row to `activity_logs`.

## How it fails

| What | Result |
| --- | --- |
| Pending straight to Needs Review or Completed | Allowed by the API, `update_task_status`, and the board. `started_at` is empty, so `duration_ms` stays empty and no duration shows |
| Completed without `approve_task` | Allowed through `update_task_status` or the board; the approval step is skipped |
| A status spelled oddly (`in-progress`) | The API stores `Pending` |
| Moving back to In Progress | `started_at` is kept, so the timer continues from the first start |

## Source

`backend/app.py`, `mcp_server/server.py`, `frontend/script.js`.

## More

[Task API](../task-api.md), [MCP tools](../mcp-tools.md), [agent update flow](agent-task-update.md).

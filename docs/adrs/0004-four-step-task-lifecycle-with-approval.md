# ADR 0004: Four-step task lifecycle with an approval step

- **Status:** Accepted
- **Date:** 2026-09-24
- **Decided by:** Sajil

## Context

Agents do work on tasks, and a person should check it before it counts as done. The first `AGENTS.md` described three steps (pending, in_progress, completed), while the first MCP server already had `approve_task` for tasks in review.

## Decision

Tasks go Pending, In Progress, Needs Review, Completed. Entering In Progress starts the clock; Needs Review stops it and records `duration_ms`; `approve_task` or `bulk_approve_tasks` moves a task to Completed. `AGENTS.md` adopted the four steps and the no-skipping rule in `5fe42a4`.

## Consequences

- The board can show live timers and durations.
- The order is held by agents and people, not by the API: any status can be set at any time.
- Rules: [core.md](../invariants/core.md). Flow: [task-lifecycle](../flows/task-lifecycle.md).

## Evidence

`cb18172` (`approve_task` in the MCP server); `5fe42a4` updated history details and resolved dependencies (`AGENTS.md` lifecycle); today `backend/app.py` (`STATUSES`).

## Reason

`AGENTS.md` at `5fe42a4`: set In Progress first "to trigger time tracking".

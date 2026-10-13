# ADR 0005: Move storage to SQLite

- **Status:** Accepted
- **Date:** 2026-09-24
- **Decided by:** Sajil

## Context

Supersedes [ADR 0002](0002-store-tasks-in-json-files.md). Tasks and the audit log lived in two JSON files.

## Decision

A SQLite database with two tables, `tasks` and `activity_logs`, created by `init_db` in a new database module using the standard library `sqlite3`. The JSON files were deleted and a weekly report script was added on top of the log table.

## Consequences

- Row-level updates and a queryable activity log (the weekly report).
- No extra dependency.
- Subtasks are stored as a JSON string in one column.
- The database file was committed in `9c5c2af`; the uncommitted working tree moves it to an ignored data folder.
- Rule: [backend.md](../invariants/backend.md).

## Evidence

`5c6fe72` Changed the database to SQLite; `9c5c2af` updated database; today `backend/database.py`, `backend/report.py`.

## Reason

Reason not recorded.

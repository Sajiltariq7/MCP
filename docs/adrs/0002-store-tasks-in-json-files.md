# ADR 0002: Store tasks in JSON files

- **Status:** Superseded by [0005](0005-move-storage-to-sqlite.md)
- **Date:** 2026-09-24
- **Decided by:** Sajil

## Context

The first version needed somewhere to keep tasks and an audit trail.

## Decision

The API read and wrote two JSON files in the repo root: tasks.json for tasks and activity_history.json for the audit log. Both were committed.

## Consequences

- No database to set up.
- Every write rewrote a whole file, and the data lived in git.

## Evidence

`cb18172` Initial commit with MCP server and dashboard (the app defined `TASKS_FILE` and `AUDIT_FILE`). Removed in `5c6fe72`.

## Reason

Reason not recorded.

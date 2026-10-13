# ADR 0003: Agents reach tasks only through an MCP server that calls the REST API

- **Status:** Accepted
- **Date:** 2026-09-24
- **Decided by:** Sajil

## Context

Both people (the board) and AI agents needed to change the same tasks.

## Decision

The MCP server holds no data. Each tool makes an HTTP call to the FastAPI backend (`BASE_URL`), which is the only code that touches storage. The board uses the same API. Agents were told in `AGENTS.md` (`5fe42a4`) to use only the MCP tools and never open the database; that text was removed in `2b33bd0`, but the code still works this way.

## Consequences

- One place applies status normalization, timestamps, and the activity log for both kinds of caller.
- The MCP server needs the backend running, and the two must agree on the port.
- Updates fetch the full task list to change one task, because the API has no single-task GET.
- Rules: [core.md](../invariants/core.md), [backend.md](../invariants/backend.md).

## Evidence

`cb18172` (the MCP server posts to `http://127.0.0.1:8000/api`); `15c5d5a` Point To-Do MCP to backend on port 8010; today `mcp_server/server.py` and `backend/app.py`.

## Reason

Reason not recorded. The first MCP payload marks `actor` as "Passed to app.py for authorization/audit tracking", which points at a single audit trail.

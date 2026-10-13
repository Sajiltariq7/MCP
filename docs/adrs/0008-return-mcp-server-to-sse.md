# ADR 0008: Return the MCP server to SSE on port 8001

- **Status:** Accepted
- **Date:** 2026-09-30
- **Decided by:** Sajil

## Context

Supersedes [ADR 0007](0007-run-mcp-server-over-stdio.md). The task server was launched by opencode over stdio with machine-specific paths.

## Decision

The server runs again as its own process on `127.0.0.1:8001` with `transport="sse"`, and `opencode.json` registers `todo-list-server` as a remote server at `http://127.0.0.1:8001/sse`. The calculator server stays a local process.

## Consequences

- The task server config no longer depends on one machine's paths.
- The server must be started by hand (`task mcp` or `task dev`) before an agent connects.
- Page: [mcp-tools.md](../mcp-tools.md).

## Evidence

`2b33bd0` updated terminal running directory (`mcp.run(transport="sse")`, `opencode.json` type remote); today `mcp_server/server.py`, `opencode.json`.

## Reason

Reason not recorded. The commit message mentions the terminal running directory.

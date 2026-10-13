# ADR 0006: Serve the MCP server over SSE on port 8001

- **Status:** Superseded by [0007](0007-run-mcp-server-over-stdio.md)
- **Date:** 2026-09-24
- **Decided by:** Sajil

## Context

Agent clients needed a way to reach the task tools.

## Decision

The MCP server ran as its own process with `transport="sse"` on `127.0.0.1:8001`, and `opencode.json` registered it as a remote server at the SSE URL.

## Consequences

- The server is started separately and any local client can connect.

## Evidence

`cb18172` Initial commit with MCP server and dashboard (`mcp.run(transport="sse")`, `opencode.json` type remote).

## Reason

Reason not recorded.

# ADR 0007: Run the MCP server over stdio, launched by opencode

- **Status:** Superseded by [0008](0008-return-mcp-server-to-sse.md)
- **Date:** 2026-09-28
- **Decided by:** Sajil

## Context

Supersedes [ADR 0006](0006-serve-mcp-server-over-sse.md). A second MCP server (a calculator) was being connected to opencode alongside the task server.

## Decision

`opencode.json` launched the task server as a local process with an absolute Python path, and the server switched to `transport="stdio"`.

## Consequences

- opencode starts and stops the server itself.
- The config held absolute paths from one developer's machine.
- On stdio, anything printed to stdout corrupts the protocol, which is where the stderr logging rule comes from ([ADR 0009](0009-proposal-first-workflow-and-stderr-logging.md)).

## Evidence

`a172171` connected two mcp servers (`opencode.json` type local); `816d217` updated dependencies and opencode.json (`mcp.run(transport="stdio")`).

## Reason

Reason not recorded.

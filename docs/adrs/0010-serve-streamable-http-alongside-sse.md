# ADR 0010: Serve Streamable HTTP at /mcp alongside SSE

- **Status:** Accepted
- **Date:** 2026-10-13
- **Decided by:** Abdul Haque

## Context

Supersedes [ADR 0008](0008-return-mcp-server-to-sse.md). opencode v2 connects to remote MCP servers with Streamable HTTP: it sends `POST` to the configured URL. The server only spoke SSE, where `/sse` accepts `GET`, so opencode got `Method Not Allowed (HTTP 405)` and did not fall back to SSE.

## Decision

One process on `127.0.0.1:8001` serves both MCP transports:

- **Streamable HTTP at `/mcp`**: the URL the board's Agents tab now gives to opencode (`opencode mcp add ... --url http://127.0.0.1:8001/mcp`) and Claude Code (`--transport http`).
- **SSE at `/sse` + `/messages/`** for older clients.
- A non-`GET` request (or a `GET` with an `mcp-session-id`) sent to `/sse` is routed to Streamable HTTP, so configs that already point at `/sse` keep working.

The API key gate, agent names, and closing connections on key rotation work the same on both.

## Consequences

- Current and older MCP clients both connect; no client setting picks the transport.
- "Connected" means an open event stream, plus Streamable HTTP sessions active in the last 2 minutes (a Streamable HTTP client need not keep a stream open).
- `mcp_server/server.py` builds one Starlette app from `mcp.streamable_http_app()` and `mcp.sse_app()` and runs the session manager in its lifespan.
- Page: [mcp-tools.md](../mcp-tools.md). Checked by `task check-mcp` (both transports, and Streamable HTTP pointed at `/sse`).

## Evidence

The opencode error "Error POSTing to endpoint: Method Not Allowed (HTTP 405)" on 2026-10-13, and the MCP server log showing a single `POST /sse` from opencode at 12:24:57.

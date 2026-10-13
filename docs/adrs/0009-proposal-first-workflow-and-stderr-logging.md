# ADR 0009: Proposal-first agent workflow and loguru logging to stderr

- **Status:** Accepted
- **Date:** 2026-09-30
- **Decided by:** Sajil

## Context

`AGENTS.md` had described an autonomous task manager with detailed workflows. Logging used a mix of a standard-library logging helper and loguru.

## Decision

`AGENTS.md` was cut to four governance rules marked highest priority: propose first, wait for explicit approval, no autonomous execution, and all Python logs to `sys.stderr` through loguru, never stdout. The MCP server's loguru setup writes to stderr and a rotating log file. The log folder was then gitignored and the committed log untracked (`9d4319c`).

## Consequences

- An agent cannot edit files or run commands without the owner's go-ahead in chat.
- stdout stays clean for the MCP transport.
- The backend has no loguru setup yet, so the logging rule holds only in the MCP server.
- Rules: [AGENTS.md](../../AGENTS.md) hard rules, [processes.md](../invariants/processes.md), [backend.md](../invariants/backend.md).

## Evidence

`2b33bd0` updated terminal running directory (`AGENTS.md`, loguru in `pyproject.toml`); `9d4319c` Ignore logs directory and untrack activity log; today `mcp_server/server.py`.

## Reason

`AGENTS.md` at `2b33bd0`: never write logs to stdout "to avoid disrupting MCP transport protocol messages". The reason for proposal-first is not recorded.

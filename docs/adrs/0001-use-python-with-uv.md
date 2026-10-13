# ADR 0001: Use Python, managed with uv

- **Status:** Accepted
- **Date:** 2026-09-24
- **Decided by:** Sajil

## Context

The repository started in its first commit with a FastAPI backend and an MCP server, both in Python.

## Decision

Python for every server-side part, with uv as the package manager: `pyproject.toml` (project `mcp-demo`, not packaged: `[tool.uv] package = false`) and `uv.lock`. Python 3.14 or newer.

## Consequences

- One runtime and one lockfile for the API, the MCP server, and the report script.
- Every command runs through `uv run`, as `Taskfile.yaml` does.
- Contributors need uv and Python 3.14; uv can fetch the interpreter.
- Rule: [tooling.md](../invariants/tooling.md).

## Evidence

`cb18172` Initial commit with MCP server and dashboard (adds `pyproject.toml`, `uv.lock`); `2b33bd0` sets `package = false` and adds loguru and requests.

## Reason

Reason not recorded.

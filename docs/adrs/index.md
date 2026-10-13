# Decisions

One decision per file. Never edited to change it, only superseded.

| ADR | Decision | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-use-python-with-uv.md) | Use Python, managed with uv | Accepted | 2026-09-24 |
| [0002](0002-store-tasks-in-json-files.md) | Store tasks in JSON files | Superseded by 0005 | 2026-09-24 |
| [0003](0003-agents-use-mcp-server-over-rest-api.md) | Agents reach tasks only through an MCP server that calls the REST API | Accepted | 2026-09-24 |
| [0004](0004-four-step-task-lifecycle-with-approval.md) | Four-step task lifecycle with an approval step | Accepted | 2026-09-24 |
| [0005](0005-move-storage-to-sqlite.md) | Move storage to SQLite | Accepted | 2026-09-24 |
| [0006](0006-serve-mcp-server-over-sse.md) | Serve the MCP server over SSE on port 8001 | Superseded by 0007 | 2026-09-24 |
| [0007](0007-run-mcp-server-over-stdio.md) | Run the MCP server over stdio, launched by opencode | Superseded by 0008 | 2026-09-28 |
| [0008](0008-return-mcp-server-to-sse.md) | Return the MCP server to SSE on port 8001 | Superseded by 0010 | 2026-09-30 |
| [0009](0009-proposal-first-workflow-and-stderr-logging.md) | Proposal-first agent workflow and loguru logging to stderr | Accepted | 2026-09-30 |
| [0010](0010-serve-streamable-http-alongside-sse.md) | Serve Streamable HTTP at /mcp alongside SSE | Accepted | 2026-10-13 |

## Read these first

[0003](0003-agents-use-mcp-server-over-rest-api.md), [0004](0004-four-step-task-lifecycle-with-approval.md), [0005](0005-move-storage-to-sqlite.md), [0009](0009-proposal-first-workflow-and-stderr-logging.md).

## Superseded

- [0002](0002-store-tasks-in-json-files.md) by [0005](0005-move-storage-to-sqlite.md).
- [0006](0006-serve-mcp-server-over-sse.md) by [0007](0007-run-mcp-server-over-stdio.md).
- [0007](0007-run-mcp-server-over-stdio.md) by [0008](0008-return-mcp-server-to-sse.md).
- [0008](0008-return-mcp-server-to-sse.md) by [0010](0010-serve-streamable-http-alongside-sse.md).

## Not decided yet

- The folder layout (backend, frontend, mcp_server folders), the database in an ignored data folder, the backend on port 8190, and `Taskfile.yaml` exist only as uncommitted changes. Write the ADR when they are committed.
- No test runner or tests.
- No authentication; `actor` is self-declared.
- Whether the API should enforce the lifecycle order.

## Writing one

Copy the newest ADR, take the next number, fill every field with evidence, update this table, and link it from the pages it affects.

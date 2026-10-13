# Tooling invariants

For dependencies, run commands, ports, and local setup. Read [core.md](core.md) first.

| Rule | Status | Enforced in |
| --- | --- | --- |
| Manage dependencies with uv; `pyproject.toml` and `uv.lock` change together ([ADR 0001](../adrs/0001-use-python-with-uv.md)) | Convention | Review |
| Python 3.14 or newer | Current | `pyproject.toml` |
| Run Python through `uv run` | Convention | Review |
| Ports: API 8190, MCP server 8001 (`/mcp` Streamable HTTP, `/sse` SSE), board 5500, all on 127.0.0.1 | Current | `Taskfile.yaml` |
| Changing a port updates `Taskfile.yaml`, `backend/app.py`, `mcp_server/server.py`, `frontend/script.js`, and `README.md` together | Convention | Review |
| The docs command is `uv run scripts/check_docs.py` | Current | `scripts/check_docs.py` |
| Runtime folders (data, logs) and `.env` stay untracked | Current | `.gitignore` |

## Before you finish

1. Run `uv sync` after a dependency change, then `task dev`.
2. Run `uv run scripts/check_docs.py`.

# MCP Task Manager

A task board that people and AI agents share. People use the web board; agents use MCP tools. Both go through one REST API, which stores tasks and an activity log in SQLite.

| Part | Address | Code |
| --- | --- | --- |
| REST API (FastAPI + SQLite) | `http://127.0.0.1:8190/api` | `backend/` |
| MCP server (SSE) for agents | `http://127.0.0.1:8001/sse` | `mcp_server/` |
| Task board | `http://127.0.0.1:5500` | `frontend/` |

## Run it

Needs [uv](https://docs.astral.sh/uv/) and, for the shortcuts, [Task](https://taskfile.dev/).

```bash
uv sync          # install dependencies
task dev         # backend + MCP server + board together
```

Without Task, run each in its own terminal from the repo root:

```bash
uv run uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8190 --reload
uv run python mcp_server/server.py
uv run python -m http.server 5500 --bind 127.0.0.1 -d frontend
```

`task report` (or `uv run python backend/report.py`) prints the last 7 days of activity.

Connect an agent by pointing its MCP client at the SSE address; `opencode.json` does this for opencode.

## Environment variables

None. Ports and URLs are constants in the source; see [docs/invariants/tooling.md](docs/invariants/tooling.md).

## Docs

Start at [docs/index.md](docs/index.md). Agents start at [AGENTS.md](AGENTS.md).

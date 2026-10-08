# MCP Task Manager & OpenCode Integration — Project Overview

## Purpose
This workspace integrates a FastAPI backend (`app.py`), an SQLite database (`tasks.db`), and a headless MCP server (`mcp_server.py`) with a browser-based task management UI (`index.html` / `script.js`). It supports autonomous weekly goal decomposition, daily progress tracking, audit logging, and styled weekly PDF report generation.

## Key Components
- `mcp_server.py` — FastMCP server exposing `add_task`, `update_task_status`, `get_tasks`, `decompose_weekly_goal`, `generate_weekly_pdf_report`, `add_weekly_goal`, `add_daily_progress`, `approve_task`, `bulk_approve_tasks`, `delete_task`, `toggle_subtask`.
- `tasks.db` — SQLite database aligned with the 3-tier ERD (`tasks`, `weekly_goals`, `daily_progress`).
- `agents.md` — Governance and autonomous workflow rules.
- `design.md` — Schema specification and board mapping rules.
- `docs/decisions.md` — Architecture Decision Records (ADRs).
- `docs/mcp_tools.md` — Tool parameter definitions.
- `docs/workflows.md` — Weekly decomposition and progress tracking procedures.
- `docs/troubleshooting.md` — Known errors and fixes.

# MCP Tools Specification

## `add_task`
- `title`: str (required)
- `description`: str (default: "")
- `priority`: str (default: "medium")
- Creates a new `tasks` row with `subtasks` array initialized to `[]`.

## `update_task_status`
- `task_id`: str (required)
- `status`: str (required)
- `description`: str (optional)
- Updates `status`, `started_at`, `completed_at`, and calculates `duration_ms`.

## `get_tasks`
- No arguments.
- Returns full `tasks` array from the FastAPI backend.

## `add_weekly_goal`
- `week_number`: int
- `goal_title`: str
- `description`: str (optional)
- `start_date`: str (optional)
- Creates `weekly_goals` record; starts status `IN_PROGRESS`.

## `add_daily_progress`
- `task_id`: str
- `minutes_worked`: int (default: 0)
- `progress_notes`: str (default: "")
- `status`: str (default: "COMPLETED")
- Inserts into `daily_progress` and updates `tasks.status`.

## `generate_weekly_pdf_report`
- `week_number`: int
- Reads `tasks.db`, calculates metrics, and writes `Week_{N}_Report.pdf`.

## Local Skills & Scripts

### `generate_report.py`
Generates a standalone PDF summary report directly from `tasks.db`.
- **Usage**: `python generate_report.py --week 1`
- **Output**: `Weekly_Progress_Report_Week1.pdf`
- **Data Sources**: Queries `tasks.db` for task status, completion rates, and daily breakdowns.

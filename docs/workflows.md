# Workflows

## Weekly Goal Decomposition Workflow
1. User provides a high-level weekly goal (`goal_title`, `week_number`, `start_date`, `description`).
2. Invoke `decompose_weekly_goal` (MCP tool / REST endpoint).
3. Backend creates 5 distinct daily tasks (`day_number` 1-5) with formatted titles (`Week {N} - Day {i}: {title}`).
4. Each daily task is saved directly into `tasks` table (`week_number`, `day_number`, `status`: `TODO`, `priority`: `MEDIUM`).
5. Tasks appear immediately in the Daily View board columns.

## PDF Progress Report Generation Skill
When the user asks for the end-of-week report, invoke `python generate_report.py --week <week_number>` to extract database metrics (`tasks`, `daily_progress`), format the document with header/progress/table/activities/summary sections, and output `Week_<N>_Report.pdf` in the workspace root.

## Task Progress Tracking Workflow
1. As work progresses, call `update_task_status` to transition linearly: `PENDING` -> `IN_PROGRESS` -> `COMPLETED`.
2. Call `add_daily_progress` to log `minutes_worked`, `progress_notes`, and `status` for the current date.
3. The `daily_progress` table synchronizes with `tasks` table updates.
4. Final approval uses `approve_task` or `bulk_approve_tasks`.

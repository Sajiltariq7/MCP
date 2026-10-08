# Architecture Decision Records (ADRs)

## ADR-001: Explicit `week_num` and `day_num` for Board Rendering
- Every task created for a weekly goal MUST include `week_number` (target week) and `day_number` (1-5).
- Daily View columns (`col-day-1` through `col-day-5`) filter strictly by `day_number` and by title containing `Day N` as a fallback.
- Parent weekly goal summaries (`is_weekly_goal`) are excluded from Daily View columns.

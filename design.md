# System Design

## Database Schema (`tasks.db` — 3-tier structure)

### `tasks`
- `id` (TEXT PRIMARY KEY)
- `title` (TEXT NOT NULL)
- `description` (TEXT)
- `status` (TEXT DEFAULT 'PENDING')
- `priority` (TEXT DEFAULT 'medium')
- `due_date` (TEXT)
- `creator` (TEXT DEFAULT 'human')
- `created_at` (TEXT)
- `started_at` (TEXT)
- `completed_at` (TEXT)
- `duration_ms` (INTEGER)
- `week_number` (INTEGER DEFAULT 1)
- `day_number` (INTEGER DEFAULT 1)
- `diagram_url` (TEXT)
- `completed_date` (TEXT)

### `weekly_goals`
- `id` (TEXT PRIMARY KEY)
- `week_number` (INTEGER)
- `goal_title` (TEXT)
- `description` (TEXT)
- `start_date` (TEXT)
- `status` (TEXT DEFAULT 'IN_PROGRESS')
- `created_at` (TEXT)
- `updated_at` (TEXT)

### `daily_progress`
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `task_id` (TEXT)
- `date` (TEXT)
- `minutes_worked` (INTEGER DEFAULT 0)
- `progress_notes` (TEXT)
- `status` (TEXT)

## UI Board Mapping
- `day_number` values `1` through `5` map strictly to Day 1 through Day 5 columns in the Daily View (`#daily-view-grid`).
- `week_number` groups tasks in the Status / Weekly Overview.

## Title Rendering Standard
- Daily tasks use `Week {N} - Day {X}: {Task Name}` format for storage.
- Daily View card headers strip the `Week N - Day X:` prefix for clean display; full formatted title is preserved in database.
- Titles must be unique per daily entry to avoid duplication in board rendering.

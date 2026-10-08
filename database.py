import sqlite3

DB_NAME = "tasks.db"

def get_db_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=30000;")
    return conn

def init_db():
    conn = get_db_connection()
    conn.execute("PRAGMA journal_mode=WAL;")
    cursor = conn.cursor()

    # Schema cleanup: drop deprecated tables
    cursor.execute("DROP TABLE IF EXISTS weekly_reports;")
    cursor.execute("DROP TABLE IF EXISTS subtasks;")

    # Core tasks table (3-tier structure)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'PENDING',
            priority TEXT DEFAULT 'medium',
            due_date TEXT,
            creator TEXT DEFAULT 'human',
            created_at TEXT,
            started_at TEXT,
            completed_at TEXT,
            duration_ms INTEGER,
            week_number INTEGER DEFAULT 1,
            day_number INTEGER DEFAULT 1,
            diagram_url TEXT
        )
    """)

    # Gracefully add missing columns
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN actor TEXT DEFAULT 'USER'")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN week_number INTEGER DEFAULT 1")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN day_number INTEGER DEFAULT 1")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN completed_date TEXT")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN diagram_url TEXT")
    except Exception:
        pass

    # Weekly goals (ERD-aligned)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS weekly_goals (
            id TEXT PRIMARY KEY,
            week_number INTEGER,
            goal_title TEXT,
            description TEXT,
            start_date TEXT,
            status TEXT DEFAULT 'IN_PROGRESS',
            created_at TEXT,
            updated_at TEXT
        )
    """)

    # Daily progress tracking
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT,
            date TEXT,
            minutes_worked INTEGER DEFAULT 0,
            progress_notes TEXT,
            status TEXT
        )
    """)

    # Activity logs
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            actor TEXT,
            action TEXT,
            entity_type TEXT,
            entity_id TEXT,
            details TEXT
        )
    """)

    conn.commit()
    conn.close()

def log_activity(actor, action, entity_type, entity_id, details, timestamp):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO activity_logs (timestamp, actor, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (timestamp, actor, action, entity_type, entity_id, details))
    conn.commit()
    conn.close()

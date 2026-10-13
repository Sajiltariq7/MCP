import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

# Lives in <repo>/data/tasks.db regardless of the working directory
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "tasks.db"
# Evidence files (screenshots, attachments) live next to the database, also gitignored
ATTACH_DIR = DB_PATH.parent / "attachments"

def now_utc():
    """Every timestamp the backend stores is UTC ISO 8601, e.g. 2026-10-13T06:30:00.123456+00:00."""
    return datetime.now(timezone.utc).isoformat()

def to_utc(value):
    """Convert an ISO timestamp to UTC. A value without an offset is taken as this machine's local time."""
    if not value:
        return value
    try:
        return datetime.fromisoformat(value).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return value

def get_db_connection():
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Create tasks table
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
            subtasks TEXT
        )
    """)

    # Create activity_logs table
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

    # Columns added later: what evidence a task needs, and comments (e.g. why it was sent back)
    existing = {row["name"] for row in cursor.execute("PRAGMA table_info(tasks)")}
    for col, decl in {"evidence_type": "TEXT DEFAULT 'none'", "evidence_note": "TEXT DEFAULT ''", "comments": "TEXT DEFAULT '[]'"}.items():
        if col not in existing:
            cursor.execute(f"ALTER TABLE tasks ADD COLUMN {col} {decl}")

    # Evidence files attached to tasks; the bytes live in ATTACH_DIR
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            filename TEXT,
            content_type TEXT,
            size INTEGER,
            path TEXT,
            note TEXT,
            uploaded_by TEXT,
            uploaded_at TEXT
        )
    """)

    # Key/value settings (holds the MCP API key)
    cursor.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('mcp_api_key', ?)", (new_api_key(),))

    # One-off fix for older rows that mixed local and UTC timestamps (safe to run on every start)
    for table, cols in {"tasks": ("created_at", "started_at", "completed_at"), "activity_logs": ("timestamp",)}.items():
        for row in cursor.execute(f"SELECT rowid AS rid, {', '.join(cols)} FROM {table}").fetchall():
            fixed = [to_utc(row[c]) for c in cols]
            if fixed != [row[c] for c in cols]:
                cursor.execute(f"UPDATE {table} SET {', '.join(c + ' = ?' for c in cols)} WHERE rowid = ?", (*fixed, row["rid"]))

    conn.commit()
    conn.close()
    # DO NOT put any cursor.executemany(...) or INSERT INTO tasks here!

def new_api_key():
    return "tb_" + secrets.token_urlsafe(24)

def get_setting(key):
    conn = get_db_connection()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else None

def set_setting(key, value):
    conn = get_db_connection()
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    conn.close()

def log_activity(actor, action, entity_type, entity_id, details):
    timestamp = now_utc()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO activity_logs (timestamp, actor, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (timestamp, actor, action, entity_type, entity_id, details))
    conn.commit()
    conn.close()
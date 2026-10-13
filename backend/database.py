import secrets
import sqlite3
from pathlib import Path

# Lives in <repo>/data/tasks.db regardless of the working directory
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "tasks.db"

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

    # Key/value settings (holds the MCP API key)
    cursor.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('mcp_api_key', ?)", (new_api_key(),))

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

def log_activity(actor, action, entity_type, entity_id, details, timestamp):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO activity_logs (timestamp, actor, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (timestamp, actor, action, entity_type, entity_id, details))
    conn.commit()
    conn.close()
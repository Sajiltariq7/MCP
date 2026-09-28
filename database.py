import sqlite3

DB_NAME = "tasks.db"  # Check that this matches your desired database file name

def get_db_connection():
    conn = sqlite3.connect(DB_NAME)
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

    conn.commit()
    conn.close()
    # DO NOT put any cursor.executemany(...) or INSERT INTO tasks here!

def log_activity(actor, action, entity_type, entity_id, details, timestamp):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO activity_logs (timestamp, actor, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (timestamp, actor, action, entity_type, entity_id, details))
    conn.commit()
    conn.close()
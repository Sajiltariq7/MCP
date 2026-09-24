import sqlite3

DB_NAME = "app_activity.db"

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
            subtasks TEXT DEFAULT '[]'
        )
    """)

    # Create activity_logs table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor TEXT,
            action TEXT,
            entity_type TEXT,
            entity_id TEXT,
            details TEXT,
            timestamp TEXT
        )
    """)

    conn.commit()
    conn.close()

def log_activity(actor, action, entity_type, entity_id, details, timestamp):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO activity_logs (actor, action, entity_type, entity_id, details, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (actor, action, entity_type, entity_id, details, timestamp))
    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database tables created successfully.")
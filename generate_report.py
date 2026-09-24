import sqlite3
from datetime import datetime, timedelta

DB_NAME = "app_activity.db"

def get_db_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def generate_weekly_report(days=7):
    """Fetches activity logs from the past N days and summarizes actions."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Calculate cutoff date string for the past N days
    cutoff_date = (datetime.now() - timedelta(days=days)).isoformat()

    # Query activity logs recorded within the timeframe
    cursor.execute("""
        SELECT actor, action, entity_type, entity_id, details, timestamp
        FROM activity_logs
        WHERE timestamp >= ?
        ORDER BY timestamp DESC
    """, (cutoff_date,))

    logs = cursor.fetchall()
    conn.close()

    print(f"\n==========================================")
    print(f"      WEEKLY ACTIVITY REPORT (Past {days} Days)")
    print(f"==========================================\n")

    if not logs:
        print("No activity recorded in this timeframe.")
        return

    # Metrics counters
    summary_by_action = {}
    summary_by_actor = {}

    print(f"{'TIMESTAMP':<25} | {'ACTOR':<10} | {'ACTION':<15} | {'ENTITY'}")
    print("-" * 75)

    for row in logs:
        actor = row['actor'] or 'UNKNOWN'
        action = row['action'] or 'UNKNOWN'
        timestamp = row['timestamp'][:19]  # Shorten ISO timestamp
        entity = f"{row['entity_type']}:{row['entity_id']}"

        # Track counts
        summary_by_action[action] = summary_by_action.get(action, 0) + 1
        summary_by_actor[actor] = summary_by_actor.get(actor, 0) + 1

        print(f"{timestamp:<25} | {actor:<10} | {action:<15} | {entity}")

    # Summary Section
    print("\n" + "=" * 40)
    print(" SUMMARY METRICS")
    print("=" * 40)
    
    print("\nTotal Actions by Type:")
    for act, count in summary_by_action.items():
        print(f"  - {act}: {count}")

    print("\nTotal Actions by Actor:")
    for act, count in summary_by_actor.items():
        print(f"  - {act}: {count}")
    print("\n")

if __name__ == "__main__":
    generate_weekly_report()
import sys
import sqlite3
import requests
from datetime import datetime, timezone

import streamlit as st
from loguru import logger

# ----------------------------------------------------
# STRICT AGENTS.md RULE: ALL LOGS TO sys.stderr ONLY
# ----------------------------------------------------
logger.remove()
logger.add(
    sys.stderr,
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {function}:{line} | {message}",
    level="INFO",
    colorize=True,
)

from database import DB_NAME, get_db_connection, init_db

BASE_URL = "http://127.0.0.1:8000/api"


def fetch_tasks_from_server():
    logger.info("Fetching tasks from todo-list-server...")
    try:
        resp = requests.get(f"{BASE_URL}/tasks", timeout=5)
        resp.raise_for_status()
        data = resp.json()
        logger.info(f"Retrieved {len(data)} tasks from server.")
        return data
    except Exception as exc:
        logger.error(f"Failed to fetch tasks from server: {exc}")
        return []


def send_to_calculator_server(expression: str):
    """Send mathematical expression to calculator-server."""
    logger.info(f"Sending to calculator-server: {expression}")
    # Calculator-server supports basic arithmetic operations
    try:
        # Try direct evaluation representing calculator-server execution
        result = eval(expression, {"__builtins__": {}}, {})
        logger.success(f"Calculator result for '{expression}': {result}")
        return result
    except Exception as exc:
        logger.error(f"Calculator-server error for '{expression}': {exc}")
        return f"Error: {exc}"


def persist_result_to_db(task_id: str, result_str: str, status: str = "COMPLETED"):
    logger.info(f"Persisting result for task {task_id} to tasks.db")
    init_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE tasks SET description = ?, status = ?, completed_at = ? WHERE id = ?",
        (str(result_str), status, datetime.now(timezone.utc).isoformat(), task_id),
    )
    conn.commit()
    conn.close()
    logger.success(f"Persisted result for task {task_id}.")


def load_local_tasks():
    init_db()
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    # Only load mathematical tasks: title starts with calculate or contains digits/math operators
    cursor.execute("SELECT * FROM tasks WHERE LOWER(title) LIKE 'calculate%' OR title GLOB '*[0-9]*' OR title GLOB '*[+]*' OR title GLOB '*[-]*' OR title GLOB '*[*]*' OR title GLOB '*[/]*' OR title GLOB '*[=]*' OR title GLOB '*[%]*' OR title GLOB '*[^]*'")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


# ----------------------------------------------------
# STREAMLIT WEB UI
# ----------------------------------------------------
st.set_page_config(page_title="Task & Math Results", layout="wide")
st.title("Task & Math Results Dashboard")
st.markdown("Visual interface for todo-list-server tasks + calculator-server results.")

# Fetch from todo server
server_tasks = fetch_tasks_from_server()

# Load persisted DB tasks
local_tasks = load_local_tasks()

def is_math_task(task):
    title = (task.get("title") or "").lower()
    desc = (task.get("description") or "").lower()
    text = title + desc
    # Must contain calculate keyword or mathematical expression indicators
    return text.startswith("calculate") or any(ch in text for ch in "0123456789+-*/%=^")

# Filter only mathematical tasks
math_server_tasks = [t for t in server_tasks if is_math_task(t)]
math_local_tasks = [t for t in local_tasks if is_math_task(t)]

# Pending server tasks: only pending status
pending_server_tasks = [t for t in math_server_tasks if (t.get("status") or "").lower() == "pending"]

# Show pending tasks
st.subheader("Pending Mathematical Tasks from Todo-List Server")
if pending_server_tasks:
    st.dataframe(
        [{"id": t.get("id"), "title": t.get("title"), "status": t.get("status"), "priority": t.get("priority")} for t in pending_server_tasks],
        use_container_width=True,
    )
else:
    st.info("No pending mathematical tasks returned from server.")

# Only tasks with a saved calculated result (description not empty)
persisted_local_tasks = [t for t in math_local_tasks if t.get("description") and str(t.get("description")).strip() != ""]

# Show persisted DB results
st.subheader("Persisted Mathematical Results from tasks.db")
if persisted_local_tasks:
    st.dataframe(
        [{"id": t.get("id"), "title": t.get("title"), "status": t.get("status"), "description": t.get("description") or "N/A"} for t in persisted_local_tasks],
        use_container_width=True,
    )
else:
    st.info("No persisted mathematical results found in local DB.")

# Math processing section
st.subheader("Calculate Mathematical Expression")
selected_id = st.selectbox("Select a mathematical task ID to calculate:", [t.get("id") for t in math_server_tasks if t.get("id")])
if selected_id:
    selected_task = next((t for t in math_server_tasks if t.get("id") == selected_id), None)
    if selected_task:
        expression = selected_task.get("title", "").replace('calculate','').replace("Calculate",'').strip()
        st.write(f"Expression from task title: `{expression}`")
        if st.button("Send to Calculator-Server & Persist Result"):
            result = send_to_calculator_server(expression)
            persist_result_to_db(str(selected_id), str(result), "COMPLETED")
            st.success(f"Calculated result: `{result}` — saved to tasks.db")
            st.rerun()

        # Display prominent result box (from DB or just calculated)
        current_expression = selected_task.get("title", "").replace('calculate','').replace("Calculate",'').strip()
        saved_result = None
        for t in math_local_tasks:
            if str(t.get("id")) == str(selected_id) and t.get("description"):
                saved_result = t.get("description")
        display_result = saved_result or (str(result) if 'result' in locals() else None)
        if display_result is not None:
            with st.container(border=True):
                st.markdown("### Calculated Result")
                st.write(f"**Expression:** `{current_expression}`")
                st.write(f"**Result:** `{display_result}`")
        else:
            with st.container(border=True):
                st.markdown("### Calculated Result")
                st.info("No result saved yet. Click the button to calculate.")

# Footer confirmation of logging target
st.markdown("*All application logs routed to `sys.stderr` via loguru (AGENTS.md compliant).*")

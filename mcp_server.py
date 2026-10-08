from datetime import datetime, timezone
import json
import logging
import sys
import time

from logger_config import logger
try:
    from mcp.server.fastmcp import FastMCP
except ModuleNotFoundError:
    from mcp.server.mcpserver import MCPServer as FastMCP
import requests

# ----------------------------------------------------
# SILENCE BACKGROUND HTTP & MCP SPAM
# ----------------------------------------------------
# Intercept standard logging through loguru (sys.stderr only)
class InterceptHandler(logging.Handler):
    def emit(self, record):
        try:
            msg = self.format(record)
            logger.info(f"[INTERCEPTED LOG] {msg}")
        except Exception:
            pass

# Suppress standard Uvicorn access logs (POST /messages...) and MCP pings
uvicorn_access = logging.getLogger("uvicorn.access")
uvicorn_access = logging.getLogger("uvicorn.access")
uvicorn_access.setLevel(logging.WARNING)
uvicorn_access.propagate = False
uvicorn_access.handlers = []
uvicorn_access.disabled = True

logging.getLogger("uvicorn.error").setLevel(logging.ERROR)
logging.getLogger("uvicorn.error").propagate = False
logging.getLogger("mcp").setLevel(logging.CRITICAL)
logging.getLogger("mcp").propagate = False
logging.getLogger("mcp.server").setLevel(logging.CRITICAL)
logging.getLogger("mcp.server").propagate = False
# Bind standard logging to InterceptHandler
logging.getLogger("uvicorn").handlers = [InterceptHandler()]
logging.getLogger("mcp").handlers = [InterceptHandler()]

# Instantiate FastMCP server with compatible initialization
try:
    mcp = FastMCP("todo-list-server")
except Exception:
    pass

# FastAPI base URL
BASE_URL = "http://127.0.0.1:8000/api"

# ----------------------------------------------------
# MCP TOOLS WITH FUNCTIONAL LOGGING
# ----------------------------------------------------
@mcp.tool()
def add_task(
    title: str, description: str = "", priority: str = "medium"
) -> str:
    """Add a new task via the FastAPI backend."""
    logger.info(f"[MCP TOOL CALL] add_task -> args: {{'title': '{title}', 'description': '{description}', 'priority': '{priority}'}}")
    logger.info(f"Creating task: '{title}' [Priority: {priority}]")
    now = datetime.now(timezone.utc).isoformat()
    task_id = str(int(time.time() * 1000))

    payload = {
        "id": task_id,
        "title": title,
        "description": description or "",
        "status": "pending",
        "priority": priority.lower() if priority else "medium",
        "creator": "AI",
        "created_at": now,
        "started_at": None,
        "completed_at": None,
        "duration_ms": None,
        "subtasks": [],
        "actor": "AI_AGENT",
    }

    try:
        response = requests.post(
            f"{BASE_URL}/tasks", json=payload, timeout=5
        )
        response.raise_for_status()
        logger.success(f"Task #{task_id} ('{title}') created successfully.")
        return f"Task created successfully: {title}"
    except Exception as e:
        logger.error(f"Failed to create task '{title}': {str(e)}")
        return f"Error adding task: {str(e)}"


@mcp.tool()
def get_tasks() -> str:
    """Fetch all tasks from backend."""
    logger.info("[MCP TOOL CALL] get_tasks -> args: {}")
    logger.info("Fetching tasks list from backend...")
    try:
        r = requests.get(f"{BASE_URL}/tasks", timeout=3)
        r.raise_for_status()
        logger.info("Successfully retrieved tasks list.")
        return r.text
    except Exception as e:
        logger.error(f"Failed to fetch tasks: {str(e)}")
        return f"Error fetching tasks: {str(e)}"


@mcp.tool()
def update_task_status(
    task_id: str, status: str, description: str = ""
) -> str:
    """Update task status and description."""
    logger.info(f"[MCP TOOL CALL] update_task_status -> args: {{'task_id': '{task_id}', 'status': '{status}', 'description': '{description}'}}")
    logger.info(f"Updating Task #{task_id} status -> '{status}'")
    try:
        r = requests.get(f"{BASE_URL}/tasks", timeout=3)
        tasks = r.json()
        target = next(
            (t for t in tasks if str(t.get("id")) == str(task_id)), None
        )

        if not target:
            logger.warning(f"Task #{task_id} not found for status update.")
            return f"Task {task_id} not found."

        normalized_status = status.lower().replace(" ", "_")
        now = datetime.now(timezone.utc).isoformat()

        target["status"] = normalized_status
        if description:
            target["description"] = description
        target["actor"] = "AI_AGENT"

        if normalized_status == "completed":
            logger.warning(f"[GATE] Task #{task_id} blocked automated COMPLETED; overriding to IN_PROGRESS for human approval.")
            normalized_status = "in_progress"
        target["status"] = normalized_status
        if normalized_status == "in_progress" and not target.get("started_at"):
            target["started_at"] = now
        elif normalized_status == "completed":
            target["completed_at"] = now
            if target.get("started_at"):
                start_dt = datetime.fromisoformat(target["started_at"])
                end_dt = datetime.fromisoformat(now)
                target["duration_ms"] = int(
                    (end_dt - start_dt).total_seconds() * 1000
                )

        res = requests.post(
            f"{BASE_URL}/tasks", json=target, timeout=3
        )
        logger.info(f"[DEBUG] Backend POST /api/tasks response status: {res.status_code}, id={target.get('id')}, started_at={target.get('started_at')}, status={normalized_status}")
        res.raise_for_status()
        logger.success(f"Task #{task_id} status updated to '{normalized_status}'.")
        return f"Success: Task {task_id} updated to '{normalized_status}'."
    except Exception as e:
        logger.error(f"Failed to update Task #{task_id}: {str(e)}")
        return f"Failed to update task: {str(e)}"


@mcp.tool()
def update_task_details(
    task_id: str, description: str, subtasks: list = None
) -> str:
    """Attach execution results, work notes, or subtask checklists to a task."""
    logger.info(f"[MCP TOOL CALL] update_task_details -> args: {{'task_id': '{task_id}', 'description': '{description}'}}")
    logger.info(f"Updating details/subtasks for Task #{task_id}")
    try:
        get_res = requests.get(f"{BASE_URL}/tasks", timeout=5)
        get_res.raise_for_status()
        tasks = get_res.json()

        target_task = next(
            (t for t in tasks if str(t.get("id")) == str(task_id)), None
        )
        if not target_task:
            logger.warning(f"Task #{task_id} not found for details update.")
            return f"Error: Task {task_id} not found."

        target_task["description"] = description
        if subtasks is not None:
            target_task["subtasks"] = subtasks
        target_task["actor"] = "AI_AGENT"

        post_res = requests.post(
            f"{BASE_URL}/tasks", json=target_task, timeout=5
        )
        post_res.raise_for_status()

        logger.success(f"Task #{task_id} details updated.")
        return f"Task {task_id} details updated with execution results."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to update details for Task #{task_id}: {str(e)}")
        return f"Failed to update task details: {str(e)}"


@mcp.tool()
def approve_task(task_id: str) -> str:
    """Approves a task in 'needs_review' and transitions it to 'completed'."""
    logger.info(f"[MCP TOOL CALL] approve_task -> args: {{'task_id': '{task_id}'}}")
    logger.info(f"Attempting approval for Task #{task_id}")
    try:
        get_res = requests.get(f"{BASE_URL}/tasks", timeout=5)
        get_res.raise_for_status()
        tasks = get_res.json()

        target_task = next(
            (t for t in tasks if str(t.get("id")) == str(task_id)), None
        )
        if not target_task:
            logger.warning(f"Task #{task_id} not found for approval.")
            return f"Error: Task {task_id} not found."

        if target_task.get("status") not in ["needs_review", "Needs Review"]:
            logger.warning(
                f"Task #{task_id} status is '{target_task.get('status')}', cannot approve."
            )
            return f"Task {task_id} cannot be approved because its status is '{target_task.get('status')}' (must be 'needs_review')."

        now = datetime.now(timezone.utc).isoformat()
        target_task["status"] = "completed"
        target_task["completed_at"] = now
        target_task["actor"] = "AI_AGENT"

        if target_task.get("started_at"):
            start_dt = datetime.fromisoformat(target_task["started_at"])
            end_dt = datetime.fromisoformat(now)
            target_task["duration_ms"] = int(
                (end_dt - start_dt).total_seconds() * 1000
            )

        post_res = requests.post(
            f"{BASE_URL}/tasks", json=target_task, timeout=5
        )
        post_res.raise_for_status()

        logger.success(f"Task #{task_id} approved and completed.")
        return f"Task {task_id} ('{target_task.get('title')}') has been APPROVED and moved to 'completed'."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to approve Task #{task_id}: {str(e)}")
        return f"Failed to approve task: {str(e)}"


@mcp.tool()
def bulk_approve_tasks() -> str:
    """Approves all tasks currently sitting in 'needs_review' and moves them to 'completed'."""
    logger.info("[MCP TOOL CALL] bulk_approve_tasks -> args: {}")
    logger.info("Executing bulk approval for tasks in 'needs_review'...")
    try:
        get_res = requests.get(f"{BASE_URL}/tasks", timeout=5)
        get_res.raise_for_status()
        tasks = get_res.json()

        approved_count = 0
        now = datetime.now(timezone.utc).isoformat()

        for task in tasks:
            if task.get("status") in ["needs_review", "Needs Review"]:
                task["status"] = "completed"
                task["completed_at"] = now
                task["actor"] = "AI_AGENT"

                if task.get("started_at"):
                    start_dt = datetime.fromisoformat(task["started_at"])
                    end_dt = datetime.fromisoformat(now)
                    task["duration_ms"] = int(
                        (end_dt - start_dt).total_seconds() * 1000
                    )

                requests.post(f"{BASE_URL}/tasks", json=task, timeout=5)
                approved_count += 1

        if approved_count == 0:
            logger.info("No tasks found in 'needs_review' status.")
            return "No tasks found in 'needs_review' status."

        logger.success(f"Bulk approved {approved_count} task(s).")
        return f"Successfully approved {approved_count} task(s) and moved them to 'completed'."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed bulk approval: {str(e)}")
        return f"Failed to bulk approve tasks: {str(e)}"


@mcp.tool()
def delete_task(task_id: str) -> str:
    """Delete a task via the FastAPI backend."""
    logger.info(f"[MCP TOOL CALL] delete_task -> args: {{'task_id': '{task_id}'}}")
    logger.info(f"Request to delete Task #{task_id}")
    try:
        response = requests.delete(
            f"{BASE_URL}/tasks/{task_id}",
            params={"actor": "AI_AGENT"},
            timeout=5,
        )
        response.raise_for_status()
        logger.success(f"Task #{task_id} deleted successfully.")
        return f"Task {task_id} deleted successfully."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to delete Task #{task_id}: {str(e)}")
        return f"Failed to delete task via API: {str(e)}"


@mcp.tool()
def decompose_weekly_goal(
    week_number: int, goal_title: str, start_date: str, description: str = "", subtasks_by_day: list = None
) -> str:
    """Decompose a weekly goal into 5 working-day subtasks."""
    logger.info(f"[MCP TOOL CALL] decompose_weekly_goal -> args: {{'week_number': {week_number}, 'goal_title': '{goal_title}', 'start_date': '{start_date}'}}")
    # Call backend REST endpoint for decomposition
    payload = {
        "week_number": week_number,
        "goal_title": goal_title,
        "start_date": start_date,
        "description": description,
        "subtasks_by_day": subtasks_by_day or []
    }
    resp = requests.post(f"{BASE_URL}/weekly/decompose", json=payload, timeout=5)
    resp.raise_for_status()
    logger.success(f"Weekly goal '{goal_title}' decomposed into 5 subtasks for week {week_number}.")
    return f"Weekly goal '{goal_title}' (week {week_number}) decomposed with 5 daily subtasks."


@mcp.tool()
def toggle_subtask(
    task_id: str, subtask_id: int, completed: bool, actor: str = "HUMAN"
) -> str:
    """Toggle a subtask completion status and log audit."""
    logger.info(f"[MCP TOOL CALL] toggle_subtask -> args: {{'task_id': '{task_id}', 'subtask_id': {subtask_id}, 'completed': {completed}, 'actor': '{actor}'}}")
    # Route through backend REST API
    resp = requests.patch(
        f"{BASE_URL}/subtasks/{subtask_id}",
        json={"completed": completed},
        timeout=5
    )
    resp.raise_for_status()
    logger.success(f"Subtask {subtask_id} toggled to completed={completed} by {actor}.")
    return f"Subtask {subtask_id} updated: completed={completed}, actor={actor}."


# Filter class to drop all incoming uvicorn access records
class DropFilter(logging.Filter):
    def filter(self, record):
        return False

# Nuclear suppression before server startup
for logger_name in ["uvicorn", "uvicorn.access", "uvicorn.error"]:
    log = logging.getLogger(logger_name)
    log.disabled = True
    log.handlers = []
    log.propagate = False
    if logger_name == "uvicorn.access":
        log.addFilter(DropFilter())
        log.setLevel(logging.WARNING)

@mcp.tool()
def add_weekly_goal(
    week_number: int, goal_title: str, description: str = "", start_date: str = ""
) -> str:
    """Create a weekly goal record aligned with the ERD."""
    logger.info(f"[MCP TOOL CALL] add_weekly_goal -> args: {{'week_number': {week_number}}}")
    try:
        import sqlite3
        from database import DB_NAME, init_db, log_activity
        init_db()
        with sqlite3.connect(DB_NAME, timeout=30.0) as conn:
            conn.execute("INSERT OR IGNORE INTO weekly_goals (id, week_number, goal_title, description, start_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                         (f"goal_{week_number}_{goal_title.replace(' ','_')[:20]}", week_number, goal_title, description, start_date or datetime.now(timezone.utc).strftime("%Y-%m-%d"), "IN_PROGRESS", datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat()))
            conn.commit()
        logger.success(f"Weekly goal added for week {week_number}.")
        return f"Weekly goal '{goal_title}' recorded."
    except Exception as e:
        logger.error(f"Failed to add weekly goal: {str(e)}")
        return f"Error: {str(e)}"

@mcp.tool()
def add_daily_progress(
    task_id: str, minutes_worked: int = 0, progress_notes: str = "", status: str = "COMPLETED"
) -> str:
    """Log daily progress aligned with the ERD."""
    logger.info(f"[MCP TOOL CALL] add_daily_progress -> args: {{'task_id': '{task_id}', 'minutes_worked': {minutes_worked}, 'status': '{status}'}}")
    try:
        import sqlite3
        from database import DB_NAME, init_db, log_activity
        init_db()
        with sqlite3.connect(DB_NAME, timeout=30.0) as conn:
            conn.execute("INSERT INTO daily_progress (task_id, date, minutes_worked, progress_notes, status) VALUES (?, date('now'), ?, ?, ?)",
                         (task_id, minutes_worked, progress_notes, status))
            conn.execute("UPDATE tasks SET status = ? WHERE id = ?", (status, task_id))
            conn.commit()
        logger.success(f"Daily progress logged for task {task_id}.")
        return f"Progress logged for task {task_id}."
    except Exception as e:
        logger.error(f"Failed to log daily progress: {str(e)}")
        return f"Error: {str(e)}"

@mcp.tool()
def generate_weekly_pdf_report(week_number: int) -> str:
    """Generate a styled PDF report for a given week."""
    import json
    import os
    from fpdf import FPDF
    from datetime import datetime

    logger.info(f"[MCP TOOL CALL] generate_weekly_pdf_report -> args: {{'week_number': {week_number}}}")
    # Load tasks
    with open('tasks.json', 'r', encoding='utf-8') as f:
        tasks = json.load(f)
    if isinstance(tasks, dict):
        tasks = tasks.get('tasks', tasks.get('data', []))
    week_tasks = [t for t in tasks if isinstance(t, dict) and t.get('week_number') == week_number]
    total = len(week_tasks)
    completed = sum(1 for t in week_tasks if t.get('status') == 'COMPLETED')
    in_progress = sum(1 for t in week_tasks if t.get('status') == 'IN_PROGRESS')
    percentage = int((completed / total) * 100) if total > 0 else 0

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", '', 14)
    pdf.cell(0, 10, f"Weekly Execution Report - Week {week_number}", ln=True, align='C')
    pdf.ln(5)
    pdf.set_font("Arial", 'B', 10)
    pdf.cell(0, 8, f"Total Tasks: {total}  |  Completed: {completed}  |  In Progress: {in_progress}  |  Pass Rate: {percentage}%", ln=True)
    pdf.ln(4)
    pdf.set_font("Arial", '', 9)
    for t in week_tasks:
        title = t.get('title', 'Unnamed')
        status = t.get('status', 'N/A')
        created = t.get('created_at', 'N/A')
        subtask_count = len(t.get('subtasks', []))
        pdf.cell(0, 6, f"Task: {title}  |  Status: {status}  |  Subtasks: {subtask_count}  |  Created: {created}", ln=True)
    output_path = f"Week_{week_number}_Report.pdf"
    pdf.output(output_path)
    logger.success(f"PDF report generated: {output_path}")
    return f"PDF generated: {os.path.abspath(output_path)}"

if __name__ == "__main__":
    logger.info("Starting MCP Server on http://127.0.0.1:8001/sse...")
    mcp.settings.host = "127.0.0.1"
    mcp.settings.port = 8001
    mcp.run(transport="sse")
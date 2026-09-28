from datetime import datetime, timezone
import json
import sys
import time

from loguru import logger
from mcp.server.fastmcp import FastMCP
import requests

# Instantiate FastMCP server
mcp = FastMCP("todo-list-server")

# FastAPI base URL
BASE_URL = "http://127.0.0.1:8000/api"

# ----------------------------------------------------
# LOGURU CONFIGURATION
# ----------------------------------------------------
# 1. Clear default handlers
logger.remove()

# 2. Direct console logging strictly to stderr
logger.add(
    sys.stderr,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="DEBUG",
)

# 3. Direct file logging to disk (safe and isolated from stdio streams)
logger.add(
    "logs/mcp_activity.log",
    rotation="5 MB",
    retention="7 days",
    level="INFO",
    enqueue=True,
)



# ----------------------------------------------------
# MCP TOOLS WITH FUNCTIONAL LOGGING
# ----------------------------------------------------
@mcp.tool()
def add_task(
    title: str, description: str = "", priority: str = "medium"
) -> str:
    """Add a new task via the FastAPI backend."""
    logger.info(f"Received request to create task: '{title}' (Priority: {priority})")
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
        logger.success(f"Task #{task_id} ('{title}') successfully created in backend.")
        return f"Task created successfully: {title}"
    except Exception as e:
        logger.error(f"Failed to create task '{title}': {str(e)}")
        return f"Error adding task: {str(e)}"


@mcp.tool()
def get_tasks() -> str:
    """Fetch all tasks from backend."""
    logger.info("Fetching all tasks from backend...")
    try:
        r = requests.get(f"{BASE_URL}/tasks", timeout=3)
        r.raise_for_status()
        logger.info(f"Successfully retrieved tasks list.")
        return r.text
    except Exception as e:
        logger.error(f"Failed to fetch tasks: {str(e)}")
        return f"Error fetching tasks: {str(e)}"


@mcp.tool()
def update_task_status(
    task_id: str, status: str, description: str = ""
) -> str:
    """Update task status and description."""
    logger.info(f"Request to update status for Task #{task_id} -> '{status}'")
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
        res.raise_for_status()
        logger.success(f"Task #{task_id} updated to status '{normalized_status}'.")
        return f"Success: Task {task_id} updated to '{normalized_status}'."
    except Exception as e:
        logger.error(f"Failed to update Task #{task_id}: {str(e)}")
        return f"Failed to update task: {str(e)}"


@mcp.tool()
def update_task_details(
    task_id: str, description: str, subtasks: list = None
) -> str:
    """Attach execution results, work notes, or subtask checklists to a task."""
    logger.info(f"Updating details/subtasks for Task #{task_id}")
    try:
        get_res = requests.get(f"{BASE_URL}/tasks", timeout=5)
        get_res.raise_for_status()
        tasks = get_res.json()

        target_task = next(
            (t for t in tasks if str(t.get("id")) == str(task_id)), None
        )
        if not target_task:
            logger.warning(f"Task #{task_id} not found for updating details.")
            return f"Error: Task {task_id} not found."

        target_task["description"] = description
        if subtasks is not None:
            target_task["subtasks"] = subtasks
        target_task["actor"] = "AI_AGENT"

        post_res = requests.post(
            f"{BASE_URL}/tasks", json=target_task, timeout=5
        )
        post_res.raise_for_status()

        logger.success(f"Task #{task_id} details and subtasks updated.")
        return f"Task {task_id} details updated with execution results."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to update details for Task #{task_id}: {str(e)}")
        return f"Failed to update task details: {str(e)}"


@mcp.tool()
def approve_task(task_id: str) -> str:
    """Approves a task in 'needs_review' and transitions it to 'completed'."""
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
            logger.warning(f"Task #{task_id} status is '{target_task.get('status')}', cannot approve.")
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

        logger.success(f"Task #{task_id} successfully approved.")
        return f"Task {task_id} ('{target_task.get('title')}') has been APPROVED and moved to 'completed'."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to approve Task #{task_id}: {str(e)}")
        return f"Failed to approve task: {str(e)}"


@mcp.tool()
def bulk_approve_tasks() -> str:
    """Approves all tasks currently sitting in 'needs_review' and moves them to 'completed'."""
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
            logger.info("No tasks were found in 'needs_review' status.")
            return "No tasks found in 'needs_review' status."

        logger.success(f"Bulk approved {approved_count} task(s).")
        return f"Successfully approved {approved_count} task(s) and moved them to 'completed'."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed bulk approval: {str(e)}")
        return f"Failed to bulk approve tasks: {str(e)}"


@mcp.tool()
def delete_task(task_id: str) -> str:
    """Delete a task via the FastAPI backend."""
    logger.info(f"Request to delete Task #{task_id}")
    try:
        response = requests.delete(
            f"{BASE_URL}/tasks/{task_id}",
            params={"actor": "AI_AGENT"},
            timeout=5,
        )
        response.raise_for_status()
        logger.success(f"Task #{task_id} deleted.")
        return f"Task {task_id} deleted successfully."
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to delete Task #{task_id}: {str(e)}")
        return f"Failed to delete task via API: {str(e)}"


if __name__ == "__main__":
    mcp.settings.port = 8001
    mcp.run(transport="stdio")
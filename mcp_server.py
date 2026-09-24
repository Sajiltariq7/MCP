import json
import time
from datetime import datetime, timezone
import requests
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("Secure Task Manager")

# FastAPI base URL
BASE_URL = "http://127.0.0.1:8000/api"

@mcp.tool()
def add_task(title: str, description: str = "", priority: str = "normal") -> str:
    """Add a new task via the FastAPI backend."""
    payload = {
        "id": str(int(time.time() * 1000)),
        "title": title,
        "description": description,
        "status": "Pending",
        "priority": priority,
        "creator": "AI",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "subtasks": [],
        "actor": "AI_AGENT"  # Passed to app.py for authorization/audit tracking
    }
    
    try:
        response = requests.post(f"{BASE_URL}/tasks", json=payload, timeout=5)
        response.raise_for_status()
        return f"Task created successfully: {title}"
    except requests.exceptions.RequestException as e:
        return f"Failed to create task via API: {str(e)}"

@mcp.tool()
def get_tasks() -> str:
    """Fetch all tasks via the FastAPI backend."""
    try:
        response = requests.get(f"{BASE_URL}/tasks", timeout=5)
        response.raise_for_status()
        tasks = response.json()
        return json.dumps(tasks, indent=2)
    except requests.exceptions.RequestException as e:
        return f"Failed to fetch tasks via API: {str(e)}"

@mcp.tool()
def update_task_status(task_id: str, status: str) -> str:
    """
    Update a task's status (e.g., 'In Progress', 'Needs Review', 'Completed', 'Pending').
    Triggers timestamping and time elapsed calculations on the backend.
    """
    try:
        # Fetch current task object first
        get_res = requests.get(f"{BASE_URL}/tasks", timeout=5)
        get_res.raise_for_status()
        tasks = get_res.json()
        
        target_task = next((t for t in tasks if str(t.get("id")) == str(task_id)), None)
        if not target_task:
            return f"Error: Task {task_id} not found."

        # Update status and actor
        target_task["status"] = status
        target_task["actor"] = "AI_AGENT"

        # POST updated payload back to app.py
        post_res = requests.post(f"{BASE_URL}/tasks", json=target_task, timeout=5)
        post_res.raise_for_status()
        
        return f"Task {task_id} status updated to '{status}' successfully."
    except requests.exceptions.RequestException as e:
        return f"Failed to update task status: {str(e)}"

@mcp.tool()
def approve_task(task_id: str) -> str:
    """
    Approves a task in 'Needs Review' and transitions it to 'Completed'.
    """
    try:
        get_res = requests.get(f"{BASE_URL}/tasks", timeout=5)
        get_res.raise_for_status()
        tasks = get_res.json()

        target_task = next((t for t in tasks if str(t.get("id")) == str(task_id)), None)
        if not target_task:
            return f"Error: Task {task_id} not found."

        if target_task.get("status") != "Needs Review":
            return f"Task {task_id} cannot be approved because its status is '{target_task.get('status')}' (must be 'Needs Review')."

        target_task["status"] = "Completed"
        target_task["actor"] = "AI_AGENT"

        post_res = requests.post(f"{BASE_URL}/tasks", json=target_task, timeout=5)
        post_res.raise_for_status()

        return f"Task {task_id} ('{target_task.get('title')}') has been APPROVED and moved to 'Completed'."
    except requests.exceptions.RequestException as e:
        return f"Failed to approve task: {str(e)}"

@mcp.tool()
def bulk_approve_tasks() -> str:
    """
    Approves all tasks currently sitting in the 'Needs Review' column and moves them to 'Completed'.
    """
    try:
        get_res = requests.get(f"{BASE_URL}/tasks", timeout=5)
        get_res.raise_for_status()
        tasks = get_res.json()

        approved_count = 0
        for task in tasks:
            if task.get("status") == "Needs Review":
                task["status"] = "Completed"
                task["actor"] = "AI_AGENT"
                requests.post(f"{BASE_URL}/tasks", json=task, timeout=5)
                approved_count += 1

        if approved_count == 0:
            return "No tasks found in 'Needs Review' status."
        return f"Successfully approved {approved_count} task(s) and moved them to 'Completed'."
    except requests.exceptions.RequestException as e:
        return f"Failed to bulk approve tasks: {str(e)}"

@mcp.tool()
def delete_task(task_id: str) -> str:
    """Delete a task via the FastAPI backend."""
    try:
        response = requests.delete(f"{BASE_URL}/tasks/{task_id}", params={"actor": "AI_AGENT"}, timeout=5)
        response.raise_for_status()
        return f"Task {task_id} deleted successfully."
    except requests.exceptions.RequestException as e:
        return f"Failed to delete task via API: {str(e)}"

if __name__ == "__main__":
    mcp.settings.port = 8001
    mcp.run(transport="sse")
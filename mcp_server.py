from fastmcp import FastMCP
import json
import os
from datetime import datetime

mcp = FastMCP("Automated TODO Engine")

TASKS_FILE = "tasks.json"
HISTORY_FILE = "activity_history.json"

def load_data(filepath):
    if not os.path.exists(filepath):
        return []
    with open(filepath, "r") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return []

def save_data(filepath, data):
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)

def log_activity(tool_name, task_id, details, status="success"):
    history = load_data(HISTORY_FILE)
    entry = {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "tool_called": tool_name,
        "task_id": task_id,
        "details": details,
        "status": status
    }
    history.insert(0, entry)
    save_data(HISTORY_FILE, history)

@mcp.tool
def get_tasks():
    """Retrieve all tasks from tasks.json."""
    return load_data(TASKS_FILE)

@mcp.tool
def add_task(title: str, description: str = "", automated: bool = False):
    """Add a new task to the system."""
    tasks = load_data(TASKS_FILE)
    new_task = {
        "id": f"task-{len(tasks) + 101}",
        "title": title,
        "description": description,
        "status": "pending",
        "assigned_agent": "agent-orchestrator" if automated else "human",
        "automated": automated,
        "subtasks": [],
        "logs": [f"[{datetime.now().strftime('%H:%M:%S')}] Task created."],
        "github_branch": "main",
        "created_at": datetime.now().isoformat()
    }
    tasks.append(new_task)
    save_data(TASKS_FILE, tasks)
    log_activity("add_task", new_task["id"], f"Created task: {title}")
    return new_task

@mcp.tool
def auto_decompose_task(task_id: str):
    """Break down a high-level task into actionable subtasks."""
    tasks = load_data(TASKS_FILE)
    for task in tasks:
        if task["id"] == task_id:
            generated_subtasks = [
                {"title": f"Analyze requirements for {task['title']}", "completed": False},
                {"title": "Execute automated updates", "completed": False},
                {"title": "Run automated tests & verify output", "completed": False}
            ]
            task["subtasks"].extend(generated_subtasks)
            task["logs"].append(f"[{datetime.now().strftime('%H:%M:%S')}] Auto-decomposed into subtasks.")
            save_data(TASKS_FILE, tasks)
            log_activity("auto_decompose_task", task_id, "Generated subtasks automatically.")
            return task
    return {"error": "Task not found"}

@mcp.tool
def execute_agent_task(task_id: str):
    """Execute automated logic for a task and shift status to needs_review."""
    tasks = load_data(TASKS_FILE)
    for task in tasks:
        if task["id"] == task_id:
            task["status"] = "needs_review"
            for sub in task["subtasks"]:
                sub["completed"] = True
            task["logs"].append(f"[{datetime.now().strftime('%H:%M:%S')}] Agent execution completed. Pending review.")
            save_data(TASKS_FILE, tasks)
            log_activity("execute_agent_task", task_id, "Execution complete. Waiting for approval.")
            return task
    return {"error": "Task not found"}

@mcp.tool
def update_task_status(task_id: str, new_status: str):
    """Update task status (pending, in_progress, needs_review, completed)."""
    tasks = load_data(TASKS_FILE)
    for task in tasks:
        if task["id"] == task_id:
            task["status"] = new_status
            task["logs"].append(f"[{datetime.now().strftime('%H:%M:%S')}] Status changed to {new_status}.")
            save_data(TASKS_FILE, tasks)
            log_activity("update_task_status", task_id, f"Shifted status to {new_status}")
            return task
    return {"error": "Task not found"}

@mcp.tool
def get_activity_history():
    """Get full audit history from activity_history.json."""
    return load_data(HISTORY_FILE)

if __name__ == "__main__":
    mcp.run()
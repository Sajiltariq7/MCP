"""
MCP Server supporting both OpenCode (stdio mode) and Web REST API (Uvicorn)
with persistent file storage via tasks.json.
"""

import sys
import os
import json
import uvicorn
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tasks.json")

def load_tasks():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_tasks(tasks):
    with open(DATA_FILE, "w") as f:
        json.dump(tasks, f, indent=2)

def get_all_tasks():
    return load_tasks()

def add_new_task(title, priority="normal", category="General", due_date=""):
    tasks = load_tasks()
    task_id = max([t["id"] for t in tasks], default=0) + 1
    new_task = {
        "id": task_id,
        "title": title,
        "priority": priority,
        "category": category,
        "dueDate": due_date,
        "completed": False
    }
    tasks.append(new_task)
    save_tasks(tasks)
    return new_task

def delete_existing_task(task_id):
    tasks = load_tasks()
    initial_count = len(tasks)
    tasks = [t for t in tasks if t["id"] != task_id]
    if len(tasks) < initial_count:
        save_tasks(tasks)
        return True
    return False

TOOLS_SCHEMA = [
    {
        "name": "add_task",
        "description": "Add a new task to the to-do list.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "priority": {"type": "string", "enum": ["low", "normal", "high"], "default": "normal"}
            },
            "required": ["title"]
        }
    },
    {
        "name": "list_tasks",
        "description": "List all current tasks.",
        "inputSchema": {"type": "object", "properties": {}}
    },
    {
        "name": "delete_task",
        "description": "Delete a task from the to-do list by its ID.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer", "description": "The ID of the task to delete"}
            },
            "required": ["task_id"]
        }
    }
]

def process_rpc_request(body):
    req_id = body.get("id")
    method = body.get("method")
    params = body.get("params", {})

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "custom-todo-server", "version": "1.0.0"}
            }
        }
    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": TOOLS_SCHEMA}
        }
    elif method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments", {})

        if tool_name == "add_task":
            t = add_new_task(arguments.get("title", ""), arguments.get("priority", "normal"))
            res = f"Added task #{t['id']}: '{t['title']}'"
        elif tool_name == "list_tasks":
            all_t = get_all_tasks()
            res = "\n".join([f"[{t['id']}] {t['title']}" for t in all_t]) if all_t else "No tasks."
        elif tool_name == "delete_task":
            task_id = arguments.get("task_id")
            success = delete_existing_task(task_id)
            if success:
                res = f"Successfully deleted task #{task_id}"
            else:
                res = f"Task #{task_id} not found."
        else:
            res = f"Unknown tool: {tool_name}"

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"content": [{"type": "text", "text": res}]}
        }

    return {"jsonrpc": "2.0", "id": req_id, "result": "ok"}

# --- REST Endpoints ---
async def rest_get_tasks(request):
    return JSONResponse({"success": True, "tasks": get_all_tasks()})

async def rest_create_task(request):
    data = await request.json()
    task = add_new_task(data.get("title", ""), data.get("priority", "normal"), data.get("category", "General"), data.get("dueDate", ""))
    return JSONResponse({"success": True, "task": task})

async def rest_delete_task(request):
    task_id = int(request.path_params.get("task_id"))
    success = delete_existing_task(task_id)
    return JSONResponse({"success": success})

routes = [
    Route("/api/tasks", endpoint=rest_get_tasks, methods=["GET"]),
    Route("/api/tasks", endpoint=rest_create_task, methods=["POST"]),
    Route("/api/tasks/{task_id:int}", endpoint=rest_delete_task, methods=["DELETE"]),
]

app = Starlette(routes=routes, middleware=[Middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])])

def run_stdio():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            res = process_rpc_request(req)
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()
        except Exception:
            pass

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--http":
        uvicorn.run(app, host="127.0.0.1", port=8000)
    else:
        run_stdio()
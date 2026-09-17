# Demo Codebase — To-Do List App

A tiny, self-contained Python project used as the **shared test bed** for
evaluating every agentic coding tool in this assignment. Using the same
codebase for every tool keeps the comparison fair.

## Structure
```
todo_app/
  todo.py    # core logic (contains one intentional bug)
  cli.py     # simple entry point
tests/
  test_todo.py    # test suite (one test currently fails)
AGENTS.md    # project instructions for coding agents to follow
```

## Setup
```bash
cd todo-demo-codebase
pip install -r requirements.txt
```

## Run the app
```bash
python -m todo_app.cli
```

## Run tests
```bash
pytest -v
```
You should see **one failing test**: `test_high_priority_pending`. This is
intentional — it's the bug used for the "Debug" step of the assignment.
Do not fix it manually; that's the coding agent's job.

## How this maps to the assignment's 6-step workflow
| Step | What to do here |
|---|---|
| **Understand** | Ask the agent to summarize this repo, map the files, and explain `TodoList`'s data flow |
| **Instruct** | Point the agent at `AGENTS.md` and confirm it respects the constraints |
| **Change** | Ask for one small feature, e.g. "add a `rename_task(task_id, new_title)` method" |
| **Debug** | Point the agent at the failing `test_high_priority_pending` test and ask it to find + fix the root cause |
| **Verify** | Have the agent run `pytest -v` and confirm all tests pass; double-check yourself |

## Note
This is an alternative demo codebase to the inventory-tracker one, in case
you'd rather test on a to-do list app. Use whichever one you like — just
stay consistent and use the SAME codebase across all tools for a fair
comparison.

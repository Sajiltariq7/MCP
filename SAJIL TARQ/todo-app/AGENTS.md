# Project Instructions for Coding Agents

## Coding style
- Python 3.11+, follow PEP 8.
- Type hints required on all function signatures.
- No external dependencies beyond `pytest` — keep this project dependency-free.

## Test command
```
pytest -v
```
All tests must pass before a change is considered complete.

## Project constraint
- Do not change the public method signatures in `todo_app/todo.py`
  (`add_task`, `complete_task`, `delete_task`, `pending_count`,
  `high_priority_pending`) — only fix internal logic. Other code may depend
  on these signatures staying the same.

---
*This file exists so you can test whether each agentic coding tool actually
reads and follows project-level instructions. After giving an agent a task,
check whether it respected the rules above — note this in your tool README.*

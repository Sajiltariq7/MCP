# Frontend invariants

For the task board. Read [core.md](core.md) first.

| Rule | Status | Enforced in |
| --- | --- | --- |
| The `API` constant in `frontend/script.js` matches the backend port in `Taskfile.yaml` | Convention | Review |
| The board keeps working from `localStorage` when the API is unreachable | Current | `frontend/script.js` |
| The board stays static: no build step, served as files | Convention | Review |
| Every change the board sends to the API carries `actor: USER` | Current | `frontend/script.js` |

## Before you finish

1. Serve the board (`task frontend`) with the backend running, and try the change online and with the backend stopped.
2. Update [task-board.md](../task-board.md).

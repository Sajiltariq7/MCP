# Troubleshooting

## PowerShell Quoting Errors (Windows)
- When using `python -c` with complex expressions, PowerShell may misinterpret `||`, `;`, or quotes.
- Solution: Use temporary `.py` files or single-line strings with single quotes instead of complex expressions.

## Card Duplication / Subtask Rendering Bugs
- Ensure `subtasks` array is handled gracefully (`subtasks: []` initialized for new tasks).
- The `#detail-subtasks-list` container in the Task Details modal replaces `subtasksHtml` dynamically; no leftover references to deleted `subtasks` table.
- Daily View filtering excludes parent weekly goals (`is_weekly_goal` or missing `Day X` pattern).

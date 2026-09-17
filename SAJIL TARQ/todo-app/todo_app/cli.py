"""Simple command-line entry point for the to-do list demo."""

from todo_app.todo import TodoList


def main():
    todo = TodoList()
    todo.add_task("Write assignment report", priority="high")
    todo.add_task("Buy groceries", priority="low")
    todo.add_task("Review pull request", priority="high")
    print(f"Pending tasks: {todo.pending_count()}")


if __name__ == "__main__":
    main()

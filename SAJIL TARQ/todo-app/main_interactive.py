"""Interactive numbered-menu to-do app using TodoList from todo_app.todo."""

from todo_app.todo import TodoList


def view_tasks(todo: TodoList) -> None:
    """Print every task with its id, title, priority and status."""
    if not todo.tasks:
        print("No tasks.")
        return
    for task in todo.tasks.values():
        status = "done" if task.done else "pending"
        print(f"[{task.id}] ({task.priority}, {status}) {task.title}")


def main() -> None:
    todo = TodoList()
    while True:
        print("\n1. Add task")
        print("2. View tasks")
        print("3. Complete task")
        print("4. Delete task")
        print("5. Quit")
        print("6. Rename task")
        choice = input("Choose an option: ").strip()

        if choice == "1":
            title = input("Task title: ").strip()
            print(todo.add_task(title))
        elif choice == "2":
            view_tasks(todo)
        elif choice == "3":
            task_id = int(input("Task id to complete: "))
            todo.complete_task(task_id)
        elif choice == "4":
            task_id = int(input("Task id to delete: "))
            todo.delete_task(task_id)
        elif choice == "5":
            break
        elif choice == "6":
            task_id = int(input("Task id to rename: "))
            new_title = input("New title: ").strip()
            todo.rename_task(task_id, new_title)
            print(f"Task {task_id} renamed.")
        else:
            print("Invalid option.")


if __name__ == "__main__":
    main()
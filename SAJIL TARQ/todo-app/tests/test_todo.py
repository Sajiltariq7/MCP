from todo_app.todo import TodoList, TodoError
import pytest


def test_add_task():
    todo = TodoList()
    task_id = todo.add_task("Write report")
    assert todo.tasks[task_id].title == "Write report"
    assert todo.tasks[task_id].done is False


def test_add_task_empty_title_raises():
    todo = TodoList()
    with pytest.raises(TodoError):
        todo.add_task("   ")


def test_complete_task():
    todo = TodoList()
    task_id = todo.add_task("Write report")
    todo.complete_task(task_id)
    assert todo.tasks[task_id].done is True


def test_delete_task():
    todo = TodoList()
    task_id = todo.add_task("Write report")
    todo.delete_task(task_id)
    assert task_id not in todo.tasks


def test_pending_count():
    todo = TodoList()
    id1 = todo.add_task("Task A")
    todo.add_task("Task B")
    todo.complete_task(id1)
    assert todo.pending_count() == 1


def test_high_priority_pending():
    """This test currently FAILS — this is the intentional bug for the
    'Debug' exercise. A high-priority task that is NOT done should show
    up as pending, but the buggy implementation only returns completed
    high-priority tasks instead."""
    todo = TodoList()
    id1 = todo.add_task("Finish report", priority="high")
    todo.add_task("Buy milk", priority="low")
    id3 = todo.add_task("Review PR", priority="high")
    todo.complete_task(id3)  # this one is done, should NOT appear

    pending_high = todo.high_priority_pending()
    pending_titles = [t.title for t in pending_high]

    assert pending_titles == ["Finish report"]


def test_rename_task():
    todo = TodoList()
    task_id = todo.add_task("Write report")
    todo.rename_task(task_id, "Write final report")
    assert todo.tasks[task_id].title == "Write final report"


def test_rename_task_empty_title_raises():
    todo = TodoList()
    task_id = todo.add_task("Write report")
    with pytest.raises(TodoError):
        todo.rename_task(task_id, "   ")


def test_rename_task_not_found_raises():
    todo = TodoList()
    with pytest.raises(TodoError):
        todo.rename_task(99, "New title")

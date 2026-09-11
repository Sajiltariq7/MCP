document.addEventListener("DOMContentLoaded", () => {
    const todoForm = document.getElementById("todo-form");
    const taskInput = document.getElementById("task-title");
    const prioritySelect = document.getElementById("task-priority");
    const categorySelect = document.getElementById("task-category");
    const dateInput = document.getElementById("task-date");

    const taskList = document.getElementById("task-list");
    const pendingCount = document.getElementById("pending-count");
    const searchInput = document.getElementById("search-input");
    const filterTabs = document.querySelectorAll(".tab");
    const emptyState = document.getElementById("empty-state");
    const clearCompletedBtn = document.getElementById("clear-completed-btn");

    const API_URL = "http://localhost:8000/api/tasks";

    let tasks = [];
    let currentFilter = "all";
    let searchQuery = "";

    // 1. Fetch tasks from Python Server on page load
    async function fetchTasks() {
        try {
            const response = await fetch(API_URL);
            const data = await response.json();
            if (data.success) {
                tasks = data.tasks;
                renderTasks();
            }
        } catch (error) {
            console.error("Error connecting to MCP/REST server:", error);
        }
    }

    // 2. Add a new task to Python Server via REST POST request
    async function addTaskToServer(title, priority, category, dueDate) {
        try {
            const response = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: title,
                    priority: priority,
                    category: category,
                    dueDate: dueDate
                })
            });

            const data = await response.json();
            if (data.success) {
                // Fetch fresh list from server so tasks.json is the single source of truth
                await fetchTasks();
            }
        } catch (error) {
            console.error("Error adding task to server:", error);
        }
    }

    // 3. Delete a task from Python Server via REST DELETE request
    async function deleteTask(id) {
        try {
            const response = await fetch(`${API_URL}/${id}`, {
                method: "DELETE"
            });
            const data = await response.json();
            if (data.success) {
                await fetchTasks();
            }
        } catch (error) {
            console.error("Error deleting task from server:", error);
        }
    }

    todoForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const title = taskInput.value.trim();
        if (!title) return;

        addTaskToServer(
            title,
            prioritySelect.value,
            categorySelect.value,
            dateInput.value
        );

        taskInput.value = "";
        dateInput.value = "";
    });

    filterTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            filterTabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            currentFilter = tab.dataset.filter;
            renderTasks();
        });
    });

    searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderTasks();
    });

    clearCompletedBtn.addEventListener("click", () => {
        const completedTasks = tasks.filter(t => t.completed || t.done);
        completedTasks.forEach(t => deleteTask(t.id));
    });

    function toggleTask(id) {
        tasks = tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t);
        renderTasks();
    }

    function renderTasks() {
        taskList.innerHTML = "";

        const filteredTasks = tasks.filter(task => {
            const isCompleted = task.completed || task.done || false;
            const matchesFilter =
                currentFilter === "all" ? true :
                    currentFilter === "active" ? !isCompleted : isCompleted;

            const matchesSearch = task.title.toLowerCase().includes(searchQuery);

            return matchesFilter && matchesSearch;
        });

        if (filteredTasks.length === 0) {
            emptyState.classList.remove("hidden");
        } else {
            emptyState.classList.add("hidden");
        }

        filteredTasks.forEach(task => {
            const isCompleted = task.completed || task.done || false;
            const li = document.createElement("li");
            li.className = `task-item ${isCompleted ? "completed" : ""}`;

            const dateLabel = task.dueDate ? `📅 ${task.dueDate}` : "";

            li.innerHTML = `
                <div class="task-left">
                    <input type="checkbox" class="task-checkbox" ${isCompleted ? "checked" : ""}>
                    <div class="task-details">
                        <span class="task-title-text">${escapeHtml(task.title)}</span>
                        <div class="task-meta">
                            <span class="meta-tag priority-${task.priority}">${task.priority}</span>
                            <span class="meta-tag">${task.category || 'General'}</span>
                            ${dateLabel ? `<span class="meta-tag">${dateLabel}</span>` : ''}
                        </div>
                    </div>
                </div>
                <button class="delete-btn">&times;</button>
            `;

            li.querySelector(".task-checkbox").addEventListener("change", () => toggleTask(task.id));
            li.querySelector(".delete-btn").addEventListener("click", () => deleteTask(task.id));

            taskList.appendChild(li);
        });

        const activeCount = tasks.filter(t => !(t.completed || t.done)).length;
        pendingCount.textContent = `${activeCount} Pending`;
    }

    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    // Initial load from server
    fetchTasks();
});
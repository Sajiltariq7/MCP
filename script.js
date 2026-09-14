const API_URL = "http://127.0.0.1:8000/api/tasks";

document.addEventListener("DOMContentLoaded", fetchTasks);
document.getElementById("task-form").addEventListener("submit", addTask);

async function fetchTasks() {
  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    renderTasks(data.tasks);
  } catch (err) {
    console.error("Error fetching tasks:", err);
  }
}

function renderTasks(tasks) {
  const container = document.getElementById("tasks-container");
  container.innerHTML = "";

  tasks.forEach(task => {
    const div = document.createElement("div");
    div.className = `task-card ${task.status || 'pending'} priority-${task.priority}`;
    
    const subtasksHtml = (task.subtasks || []).map(s => `<li>${s.title}</li>`).join("");

    div.innerHTML = `
      <div class="task-header">
        <h3>${task.title}</h3>
        <span class="badge status-${task.status}">${task.status || 'pending'}</span>
      </div>
      <p class="due">Due: ${task.due_datetime ? new Date(task.due_datetime).toLocaleString() : 'No date set'}</p>
      ${subtasksHtml ? `<ul class="subtasks">${subtasksHtml}</ul>` : ''}
      <div class="actions">
        <button onclick="updateStatus(${task.id}, 'in_progress')">In Progress</button>
        <button onclick="updateStatus(${task.id}, 'completed')">Complete</button>
        <button onclick="deleteTask(${task.id})" class="delete-btn">Delete</button>
      </div>
    `;
    container.appendChild(div);
  });
}

async function addTask(e) {
  e.preventDefault();
  const title = document.getElementById("task-title").value;
  const due = document.getElementById("task-due").value;
  const priority = document.getElementById("task-priority").value;

  await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, due_datetime: due, priority })
  });

  document.getElementById("task-title").value = "";
  fetchTasks();
}

async function updateStatus(id, status) {
  await fetch(`${API_URL}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  fetchTasks();
}

async function deleteTask(id) {
  await fetch(`${API_URL}/${id}`, { method: "DELETE" });
  fetchTasks();
}
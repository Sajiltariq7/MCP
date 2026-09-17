const API_URL = "http://127.0.0.1:8000/api/tasks";

document.addEventListener("DOMContentLoaded", fetchTasks);
document.getElementById("task-form").addEventListener("submit", addTask);

// Store tasks globally so we can pre-fill form data when editing
let currentTasks = [];

async function fetchTasks() {
  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    
    // Server returns array directly: [...]
    currentTasks = Array.isArray(data) ? data : (data.tasks || []);
    renderTasks(currentTasks);
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
    
    // Subtasks rendering
    const subtasksHtml = (task.subtasks || []).map(s => `<li>${s.title}</li>`).join("");

    // Format Start, End, and Duration values
    const startedText = task.started_at ? new Date(task.started_at).toLocaleTimeString() : null;
    const completedText = task.completed_at ? new Date(task.completed_at).toLocaleTimeString() : null;
    const durationText = task.duration_formatted ? task.duration_formatted : null;

    div.innerHTML = `
      <div class="task-header">
        <h3>${task.title}</h3>
        <span class="badge status-${task.status}">${task.status || 'pending'}</span>
      </div>
      
      <div class="task-meta">
        <span class="due"><strong>Due:</strong> ${task.due_datetime ? new Date(task.due_datetime).toLocaleString() : 'No date'}</span>
        ${startedText ? `<span class="time-tag"><strong>Started:</strong> ${startedText}</span>` : ''}
        ${completedText ? `<span class="time-tag"><strong>Completed:</strong> ${completedText}</span>` : ''}
        ${durationText ? `<span class="duration-badge">⏱️ ${durationText}</span>` : ''}
      </div>

      ${subtasksHtml ? `<ul class="subtasks">${subtasksHtml}</ul>` : ''}
      
      <div class="actions">
        <button onclick="updateStatus(${task.id}, 'in_progress')">In Progress</button>
        <button onclick="updateStatus(${task.id}, 'completed')">Complete</button>
        <button onclick="openEditPrompt(${task.id})" class="edit-btn">✏️ Edit</button>
        <button onclick="deleteTask(${task.id})" class="delete-btn">Delete</button>
      </div>
    `;
    container.appendChild(div);
  });
}

// Function to prompt the user and trigger full update
async function openEditPrompt(id) {
  const task = currentTasks.find(t => t.id === id);
  if (!task) return;

  const newTitle = prompt("Update Task Title:", task.title);
  if (newTitle === null) return; // User cancelled

  const newPriority = prompt("Update Priority (low, normal, high):", task.priority || "normal");
  const newDue = prompt("Update Due Date (YYYY-MM-DDTHH:MM):", task.due_datetime || "");

  const updatedTaskObject = {
    title: newTitle || task.title,
    priority: newPriority || task.priority,
    due_datetime: newDue || task.due_datetime,
    status: task.status,
    category: task.category || "General",
    subtasks: task.subtasks || []
  };

  await updateFullTask(id, updatedTaskObject);
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
  // Changed from PATCH to PUT to match Starlette route endpoint
  await fetch(`${API_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  fetchTasks();
}

async function deleteTask(id) {
  await fetch(`${API_URL}/${id}`, { method: "DELETE" });
  fetchTasks();
}

async function updateFullTask(id, updatedTaskObject) {
  try {
    const res = await fetch(`${API_URL}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedTaskObject)
    });
    
    if (res.ok) {
      fetchTasks();
    }
  } catch (err) {
    console.error("Error doing full update:", err);
  }
}
let state = {
  tasks: [],
  logs: [],
  activeTab: 'board'
};

document.addEventListener('DOMContentLoaded', () => {
  fetchTasks();
  fetchAuditLogs();
});

// Helper: Format milliseconds into human-readable duration
function formatDuration(ms) {
  if (!ms || ms <= 0) return '0s';
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));

  let res = [];
  if (hours > 0) res.push(`${hours}h`);
  if (minutes > 0 || hours > 0) res.push(`${minutes}m`);
  res.push(`${seconds}s`);
  return res.join(' ');
}

// Helper: Calculate ongoing duration for "In Progress" tasks
function getElapsed(startTime) {
  if (!startTime) return null;
  const start = new Date(startTime).getTime();
  const now = Date.now();
  return formatDuration(now - start);
}

// Fetch tasks from FastMCP API or fallback JSON
async function fetchTasks() {
  const statusEl = document.getElementById('api-status');
  try {
    const res = await fetch('http://127.0.0.1:8000/api/tasks');
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.tasks = Array.isArray(data) ? data : (data.tasks || []);
    if (statusEl) {
      statusEl.className = "api-badge api-badge-connected";
      statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span><span>FastMCP: Connected</span>`;
    }
  } catch (err) {
    try {
      const fallback = await fetch('tasks.json');
      const fallbackData = await fallback.json();
      state.tasks = Array.isArray(fallbackData) ? fallbackData : (fallbackData.tasks || []);
      if (statusEl) {
        statusEl.className = "api-badge api-badge-fallback";
        statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span><span>Local Fallback</span>`;
      }
    } catch (e) {
      state.tasks = [];
      if (statusEl) {
        statusEl.className = "api-badge api-badge-offline";
        statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-red-500"></span><span>FastMCP: Offline</span>`;
      }
    }
  }
  renderDashboard();
}

// Render Dashboard Cards with Timer & Priority Badges
function renderDashboard() {
  const query = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const filtered = state.tasks.filter(t => 
    (t.title || '').toLowerCase().includes(query) || 
    (t.description || '').toLowerCase().includes(query)
  );

  const cols = {
    pending: document.getElementById('col-pending'),
    in_progress: document.getElementById('col-progress'),
    needs_review: document.getElementById('col-review'),
    completed: document.getElementById('col-completed')
  };

  Object.values(cols).forEach(c => { if (c) c.innerHTML = ''; });

  const counts = { pending: 0, in_progress: 0, needs_review: 0, completed: 0 };

  filtered.forEach(t => {
    const statusKey = (t.status || 'pending').toLowerCase().replace(' ', '_');
    if (counts[statusKey] !== undefined) counts[statusKey]++;

    // Priority Styling Map
    const priorityClasses = {
      low: 'badge-low',
      medium: 'badge-medium',
      high: 'badge-high',
      urgent: 'badge-urgent'
    };
    const priorityStyle = priorityClasses[t.priority?.toLowerCase()] || priorityClasses.medium;

    // Generate Duration / Timer Badge
    let timeBadgeHtml = '';
    if (t.status === 'completed' && t.duration_ms) {
      timeBadgeHtml = `<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 w-fit"><i class="fa-solid fa-stopwatch text-[10px]"></i> ${formatDuration(t.duration_ms)}</span>`;
    } else if (t.status === 'in_progress' && t.started_at) {
      timeBadgeHtml = `<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center gap-1 animate-pulse w-fit"><i class="fa-solid fa-play text-[8px]"></i> Active: ${getElapsed(t.started_at)}</span>`;
    }

    const card = document.createElement('div');
    card.className = "task-card space-y-2.5 shadow-sm group";

    card.onclick = (e) => {
      if (e.target.closest('select') || e.target.closest('button')) return;
      openDetailModal(t.id);
    };

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <h4 class="task-card-title">${t.title || 'Untitled'}</h4>
        <span class="badge-priority ${priorityStyle}">${t.priority || 'medium'}</span>
      </div>
      <p class="text-xs text-zinc-400 line-clamp-2">${t.description || 'No description provided.'}</p>
      
      ${timeBadgeHtml}

      <div class="flex items-center justify-between pt-2 border-t border-zinc-800/40 text-[10px] text-zinc-500">
        <select onchange="updateTaskStatus('${t.id}', this.value)" class="bg-[#121318] border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] text-zinc-300 focus:outline-none focus:border-red-500">
          <option value="pending" ${t.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="needs_review" ${t.status === 'needs_review' ? 'selected' : ''}>Needs Review</option>
          <option value="completed" ${t.status === 'completed' ? 'selected' : ''}>Completed</option>
        </select>
        <button onclick="deleteTask('${t.id}')" class="hover:text-red-400 transition p-1">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;

    if (cols[statusKey]) cols[statusKey].appendChild(card);
  });

  // Empty states
  Object.keys(cols).forEach(key => {
    if (counts[key] === 0 && cols[key]) {
      cols[key].innerHTML = `<div class="h-32 flex items-center justify-center text-xs text-zinc-600 italic">No tasks</div>`;
    }
  });

  // Counters
  if (document.getElementById('count-pending')) document.getElementById('count-pending').textContent = counts.pending;
  if (document.getElementById('count-progress')) document.getElementById('count-progress').textContent = counts.in_progress;
  if (document.getElementById('count-review')) document.getElementById('count-review').textContent = counts.needs_review;
  if (document.getElementById('count-completed')) document.getElementById('count-completed').textContent = counts.completed;

  renderTableView(filtered);
}

// Change Status & Handle Backend Update
async function updateTaskStatus(taskId, newStatus) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task) return;

  const now = new Date().toISOString();
  task.status = newStatus;

  if (newStatus === 'in_progress' && !task.started_at) {
    task.started_at = now;
  }

  if (newStatus === 'completed') {
    task.completed_at = now;
    if (task.started_at) {
      const startTime = new Date(task.started_at).getTime();
      const endTime = new Date(now).getTime();
      task.duration_ms = endTime - startTime;
    }
  }

  renderDashboard();

  const payload = {
    id: String(task.id),
    title: task.title || "Untitled",
    description: task.description || "",
    status: task.status || "pending",
    creator: task.creator || "human",
    actor: "USER",
    created_at: task.created_at || now,
    started_at: task.started_at || null,
    completed_at: task.completed_at || null,
    duration_ms: task.duration_ms || null,
    subtasks: Array.isArray(task.subtasks) ? task.subtasks : []
  };

  try {
    const response = await fetch('http://127.0.0.1:8000/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`Backend Error ${response.status}:`, await response.text());
      return;
    }

    fetchAuditLogs();
  } catch (e) {
    console.error('Failed to update task status:', e);
  }
}

// Render Table List View
function renderTableView(tasks) {
  const tbody = document.getElementById('task-table-body');
  if (!tbody) return;
  if (!tasks.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-xs text-zinc-500 italic">No tasks found</td></tr>`;
    return;
  }
  tbody.innerHTML = tasks.map(t => {
    const totalTime = t.duration_ms ? formatDuration(t.duration_ms) : (t.started_at ? 'In Progress' : 'Not Started');
    return `
      <tr onclick="openDetailModal('${t.id}')" class="table-row">
        <td class="p-4 font-medium text-white text-xs">${t.title || 'Untitled'}</td>
        <td class="p-4"><span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700/50">${t.status}</span></td>
        <td class="p-4 text-zinc-400 font-mono text-xs uppercase">${t.priority || 'medium'}</td>
        <td class="p-4 text-zinc-400 font-mono text-xs">${t.due_date || 'N/A'}</td>
        <td class="p-4 text-zinc-400 font-mono text-xs">${totalTime}</td>
        <td class="p-4 text-right" onclick="event.stopPropagation()">
          <button onclick="deleteTask('${t.id}')" class="text-zinc-500 hover:text-red-400 p-1 transition"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}

// Fetch logs from the FastMCP backend
async function fetchAuditLogs() {
  try {
    const response = await fetch('http://127.0.0.1:8000/api/activity');
    const logs = await response.json();
    renderAuditLogs(logs);
  } catch (error) {
    console.error('Failed to fetch activity logs:', error);
  }
}

// Render the logs into #audit-log-container
function renderAuditLogs(logs) {
  const container = document.getElementById('audit-log-container');
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = `<p class="text-zinc-500 text-xs">No activity recorded yet.</p>`;
    return;
  }

  container.innerHTML = logs.map(log => {
    const isMCP = log.actor === 'MCP_SERVER';
    
    const actorBadge = isMCP
      ? `<span class="px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-400 border border-purple-800/50 text-[9px]">MCP</span>`
      : `<span class="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50 text-[9px]">USER</span>`;

    const dateFormatted = log.timestamp 
      ? new Date(log.timestamp).toLocaleString() 
      : 'N/A';

    const taskId = log.details && log.details.id ? log.details.id : 'N/A';

    return `
      <div class="p-3 bg-[#121318] border border-zinc-800/80 rounded-lg flex items-center justify-between hover:border-red-500/30 transition text-xs font-mono">
        <div class="flex items-center space-x-2">
          <span class="px-1.5 py-0.5 rounded bg-zinc-800 text-red-400 text-[10px] border border-zinc-700/50">${log.action}</span>
          ${actorBadge}
          <span class="text-zinc-300">ID: ${taskId}</span>
        </div>
        <span class="text-zinc-500 text-[10px]">${dateFormatted}</span>
      </div>
    `;
  }).join('');
}

function switchTab(tab) {
  state.activeTab = tab;
  const views = {
    board: document.getElementById('view-board'),
    list: document.getElementById('view-list'),
    audit: document.getElementById('view-audit')
  };

  const navs = {
    board: document.getElementById('nav-board'),
    list: document.getElementById('nav-list'),
    audit: document.getElementById('nav-audit')
  };

  Object.keys(views).forEach(key => {
    if (views[key]) {
      if (key === tab) {
        views[key].classList.remove('hidden');
        views[key].classList.add('block');
        if (navs[key]) navs[key].classList.add('active');
      } else {
        views[key].classList.remove('block');
        views[key].classList.add('hidden');
        if (navs[key]) navs[key].classList.remove('active');
      }
    }
  });

  if (tab === 'audit') fetchAuditLogs();
  else renderDashboard();
}

function openTaskModal() {
  document.getElementById('taskModal').classList.remove('hidden');
}

function closeTaskModal() {
  document.getElementById('taskModal').classList.add('hidden');
}

async function saveTask() {
  const title = document.getElementById('taskTitleInput').value;
  const description = document.getElementById('taskDescInput').value;
  const status = document.getElementById('taskStatusInput').value;
  const priority = document.getElementById('taskPriorityInput').value;
  const dueDate = document.getElementById('taskDueDateInput').value;

  if (!title) return;

  const now = new Date().toISOString();
  const newTask = {
    id: Date.now().toString(),
    title,
    description,
    status,
    priority: priority || 'medium',
    due_date: dueDate || null,
    creator: 'human',
    created_at: now,
    started_at: status === 'in_progress' ? now : null,
    completed_at: status === 'completed' ? now : null,
    duration_ms: null,
    subtasks: []
  };

  state.tasks.push(newTask);
  renderDashboard();
  closeTaskModal();

  document.getElementById('taskTitleInput').value = '';
  document.getElementById('taskDescInput').value = '';
  document.getElementById('taskPriorityInput').value = 'medium';
  document.getElementById('taskDueDateInput').value = '';

  try {
    await fetch('http://127.0.0.1:8000/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTask)
    });
    fetchAuditLogs();
  } catch (e) {
    console.error('Failed to sync task with FastMCP backend', e);
  }
}

async function deleteTask(taskId) {
  try {
    await fetch(`http://127.0.0.1:8000/api/tasks/${taskId}?actor=USER`, {
      method: 'DELETE'
    });
    
    fetchTasks();
    fetchAuditLogs();
  } catch (error) {
    console.error('Failed to delete task:', error);
  }
}

function openDetailModal(taskId) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task) return;

  renderTaskDetails(task);
  document.getElementById('detailModal').classList.remove('hidden');
}

// Render Details View (Read-Only Mode)
function renderTaskDetails(task) {
  const body = document.getElementById('detailModalBody');
  if (!body) return;

  let durationText = 'Not Started';
  if (task.duration_ms) {
    durationText = formatDuration(task.duration_ms);
  } else if (task.status === 'in_progress' && task.started_at) {
    durationText = `Active (${getElapsed(task.started_at)})`;
  } else if (task.status === 'completed') {
    durationText = 'Completed';
  }

  body.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between border-b border-zinc-800 pb-3 gap-2">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-zinc-800 text-zinc-300 border border-zinc-700/50">
            ${task.status || 'pending'}
          </span>
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-zinc-800 text-red-400 border border-zinc-700/50">
            ${task.priority || 'medium'}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <button type="button" onclick="showTaskHistory('${task.id}')" class="btn-secondary">
            <i class="fa-solid fa-clock-rotate-left text-[10px] text-indigo-400"></i> History
          </button>
          <span class="text-xs font-mono text-zinc-500 shrink-0">ID: ${task.id}</span>
        </div>
      </div>

      <div>
        <label class="block text-[10px] text-zinc-500 uppercase mb-1 font-mono">Task Title</label>
        <div class="w-full bg-[#121318] border border-zinc-800/80 rounded-lg p-2 text-sm text-white font-semibold">
          ${task.title || 'Untitled'}
        </div>
      </div>

      <div>
        <label class="block text-[10px] text-zinc-500 uppercase mb-1 font-mono">Description</label>
        <div class="w-full bg-[#121318] border border-zinc-800/80 rounded-lg p-2.5 text-xs text-zinc-300 min-h-[70px] whitespace-pre-wrap leading-relaxed">
          ${task.description || '<span class="text-zinc-600 italic">No description provided.</span>'}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 bg-[#121318] p-3 rounded-lg border border-zinc-800/80 text-xs">
        <div>
          <span class="block text-[10px] text-zinc-500 uppercase mb-0.5 font-mono">Due Date</span>
          <span class="font-mono text-zinc-300 text-[11px]">${task.due_date || 'N/A'}</span>
        </div>
        <div>
          <span class="block text-[10px] text-zinc-500 uppercase mb-0.5 font-mono">Elapsed / Duration</span>
          <span class="font-mono text-emerald-400 text-[11px] block">${durationText}</span>
        </div>
        <div>
          <span class="block text-[10px] text-zinc-500 uppercase mb-0.5 font-mono">Started At</span>
          <span class="font-mono text-zinc-400 text-[10px]">${task.started_at ? new Date(task.started_at).toLocaleString() : 'N/A'}</span>
        </div>
        <div>
          <span class="block text-[10px] text-zinc-500 uppercase mb-0.5 font-mono">Completed At</span>
          <span class="font-mono text-zinc-400 text-[10px]">${task.completed_at ? new Date(task.completed_at).toLocaleString() : 'N/A'}</span>
        </div>
      </div>

      <div class="flex justify-end pt-2 border-t border-zinc-800/80">
        <button type="button" onclick="renderEditTaskForm('${task.id}')" class="btn-primary">
          <i class="fa-solid fa-pen-to-square text-[11px]"></i> Edit Task
        </button>
      </div>
    </div>
  `;
}

// Render Edit Form Mode
function renderEditTaskForm(taskId) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task) return;

  const body = document.getElementById('detailModalBody');
  if (!body) return;

  body.innerHTML = `
    <form id="editTaskForm" onsubmit="event.preventDefault(); updateTaskFromModal('${task.id}');" class="space-y-4">
      <div class="flex items-center justify-between border-b border-zinc-800 pb-3 gap-2">
        <div class="flex items-center gap-2">
          <select id="editTaskStatus" class="bg-[#121318] border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-300 font-mono focus:outline-none focus:border-red-500">
            <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>PENDING</option>
            <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>IN PROGRESS</option>
            <option value="needs_review" ${task.status === 'needs_review' ? 'selected' : ''}>NEEDS REVIEW</option>
            <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>COMPLETED</option>
          </select>

          <select id="editTaskPriority" class="bg-[#121318] border border-zinc-800 rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:border-red-500 text-zinc-300">
            <option value="low" ${task.priority === 'low' ? 'selected' : ''}>LOW</option>
            <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>MEDIUM</option>
            <option value="high" ${task.priority === 'high' ? 'selected' : ''}>HIGH</option>
            <option value="urgent" ${task.priority === 'urgent' ? 'selected' : ''}>URGENT</option>
          </select>
        </div>
        <span class="text-xs font-mono text-zinc-500 shrink-0">ID: ${task.id}</span>
      </div>

      <div>
        <label class="block text-[10px] text-zinc-500 uppercase mb-1 font-mono">Task Title</label>
        <input type="text" id="editTaskTitle" value="${task.title || ''}" class="w-full bg-[#121318] border border-zinc-800/80 rounded-lg p-2 text-sm text-white font-semibold focus:outline-none focus:border-red-500">
      </div>

      <div>
        <label class="block text-[10px] text-zinc-500 uppercase mb-1 font-mono">Description</label>
        <textarea id="editTaskDesc" rows="3" class="w-full bg-[#121318] border border-zinc-800/80 rounded-lg p-2.5 text-xs text-zinc-300 focus:outline-none focus:border-red-500 leading-relaxed">${task.description || ''}</textarea>
      </div>

      <div>
        <label class="block text-[10px] text-zinc-500 uppercase mb-1 font-mono">Due Date</label>
        <input type="date" id="editTaskDueDate" value="${task.due_date || ''}" class="bg-[#121318] border border-zinc-800/80 rounded p-1.5 text-[11px] text-zinc-300 w-full focus:outline-none focus:border-red-500 [color-scheme:dark]">
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t border-zinc-800/80">
        <button type="button" onclick="renderTaskDetails(state.tasks.find(t => String(t.id) === '${task.id}'))" class="btn-cancel">Cancel</button>
        <button type="submit" class="btn-primary">
          <i class="fa-solid fa-floppy-disk text-[11px]"></i> Save Changes
        </button>
      </div>
    </form>
  `;
}

// Fetch and display history for a specific task
async function showTaskHistory(taskId) {
  try {
    const res = await fetch('http://127.0.0.1:8000/api/activity');
    const logs = await res.json();
    
    const taskLogs = logs.filter(log => log.details && String(log.details.id) === String(taskId));
    
    const body = document.getElementById('detailModalBody');
    if (!body) return;

    if (taskLogs.length === 0) {
      body.innerHTML = `
        <div class="space-y-4">
          <div class="flex items-center justify-between border-b border-zinc-800 pb-2">
            <span class="text-xs font-mono text-zinc-400">History for Task ID: ${taskId}</span>
            <button onclick="openDetailModal('${taskId}')" class="text-xs text-indigo-400 hover:underline">← Back to Edit</button>
          </div>
          <p class="text-xs text-zinc-500 italic p-4 text-center">No history recorded for this task yet.</p>
        </div>
      `;
      return;
    }

    const logsHtml = taskLogs.map(log => {
      const isMCP = log.actor === 'MCP_SERVER';
      const actorBadge = isMCP
        ? `<span class="px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-400 border border-purple-800/50 text-[9px]">MCP</span>`
        : `<span class="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50 text-[9px]">USER</span>`;

      return `
        <div class="p-2.5 bg-[#121318] border border-zinc-800 rounded-lg flex items-center justify-between text-xs font-mono">
          <div class="flex items-center gap-2">
            <span class="px-1.5 py-0.5 rounded bg-zinc-800 text-red-400 text-[10px] border border-zinc-700/50">${log.action}</span>
            ${actorBadge}
          </div>
          <span class="text-zinc-500 text-[10px]">${new Date(log.timestamp).toLocaleString()}</span>
        </div>
      `;
    }).join('');

    body.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-center justify-between border-b border-zinc-800 pb-2">
          <span class="text-xs font-mono text-zinc-400">Activity History (ID: ${taskId})</span>
          <button onclick="openDetailModal('${taskId}')" class="text-xs text-indigo-400 hover:underline">← Back to Edit</button>
        </div>
        <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
          ${logsHtml}
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Failed to load task history:', err);
  }
}

// Function to handle saving changes from the modal
async function updateTaskFromModal(taskId) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task) return;

  const newTitle = document.getElementById('editTaskTitle')?.value || '';
  const newDesc = document.getElementById('editTaskDesc')?.value || '';
  const newStatus = document.getElementById('editTaskStatus')?.value || 'pending';
  const newPriority = document.getElementById('editTaskPriority')?.value || 'medium';
  const newDueDate = document.getElementById('editTaskDueDate')?.value || null;

  if (!newTitle) return;

  const now = new Date().toISOString();

  if (newStatus === 'in_progress' && !task.started_at) {
    task.started_at = now;
  }
  if (newStatus === 'completed' && !task.completed_at) {
    task.completed_at = now;
    if (task.started_at) {
      task.duration_ms = new Date(now).getTime() - new Date(task.started_at).getTime();
    }
  }

  const payload = {
    id: String(task.id),
    title: newTitle,
    description: newDesc,
    status: newStatus,
    priority: newPriority,
    due_date: newDueDate || null,
    creator: task.creator || "human",
    actor: "USER",
    created_at: task.created_at || now,
    started_at: task.started_at || null,
    completed_at: task.completed_at || null,
    duration_ms: task.duration_ms || null,
    subtasks: Array.isArray(task.subtasks) ? task.subtasks : []
  };

  Object.assign(task, payload);

  renderDashboard();
  closeDetailModal();

  try {
    const res = await fetch('http://127.0.0.1:8000/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error('Backend rejected update:', await res.text());
      return;
    }

    fetchAuditLogs();
  } catch (e) {
    console.error('Failed to sync updated task:', e);
  }
}

function closeDetailModal() {
  document.getElementById('detailModal').classList.add('hidden');
}

// Function to handle column selection
function setupColumnSelection() {
  const columns = document.querySelectorAll('.kanban-col');

  columns.forEach((col) => {
    col.addEventListener('click', (e) => {
      // Avoid triggering column selection if clicking directly on a task card or button inside
      if (e.target.closest('.task-card') || e.target.closest('button')) {
        return;
      }

      // Remove .selected class from all columns
      columns.forEach((c) => c.classList.remove('selected'));

      // Add .selected class to the clicked column
      col.classList.add('selected');
    });
  });
}

// Ensure this function runs after the DOM content is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  setupColumnSelection();
});
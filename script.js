// State Management
let state = {
  tasks: [],
  logs: [],
  activeTab: 'board',
  editingTaskId: null,
  isServerOnline: false
};

let liveTimerInterval = null;

// Helper: Normalize status string
function normalizeStatus(status) {
  if (!status) return 'pending';
  const s = String(status).trim().toLowerCase();
  if (s === 'in progress' || s === 'in_progress') return 'in_progress';
  if (s === 'needs review' || s === 'needs_review') return 'needs_review';
  if (s === 'completed') return 'completed';
  return 'pending';
}

// Helper: Convert normalized status to display title case
function toTitleStatus(normalizedStatus) {
  switch (normalizedStatus) {
    case 'in_progress': return 'IN PROGRESS';
    case 'needs_review': return 'NEEDS REVIEW';
    case 'completed': return 'COMPLETED';
    default: return 'PENDING';
  }
}

// Helper: Format short time string (e.g. "2:45 PM")
function getShortTime(dateStr = null) {
  const date = dateStr ? new Date(dateStr) : new Date();
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

// Helper: Save local tasks to localStorage
function saveToLocalStorage() {
  localStorage.setItem('mcp_engine_tasks', JSON.stringify(state.tasks));
  localStorage.setItem('mcp_engine_logs', JSON.stringify(state.logs));
}

// Helper: Load local tasks from localStorage
function loadFromLocalStorage() {
  const storedTasks = localStorage.getItem('mcp_engine_tasks');
  const storedLogs = localStorage.getItem('mcp_engine_logs');

  state.tasks = storedTasks ? JSON.parse(storedTasks) : (typeof INITIAL_TASKS !== 'undefined' ? INITIAL_TASKS : []);
  state.logs = storedLogs ? JSON.parse(storedLogs) : (typeof INITIAL_LOGS !== 'undefined' ? INITIAL_LOGS : []);

  if (!storedTasks) saveToLocalStorage();
}

// Helper: Add local audit log entry matching FastAPI log payload format
function addLocalAuditLog(action, taskTitle, actor = 'USER', taskId = '', updateSummary = '') {
  const logEntry = {
    timestamp: new Date().toISOString(),
    action: action,
    actor: actor,
    updateSummary: updateSummary, // Holds detailed update descriptions
    details: {
      id: taskId,
      title: taskTitle
    }
  };
  state.logs.unshift(logEntry);
  saveToLocalStorage();
}

// Helper: Format log update text dynamically if fallback is needed
function getLogUpdateText(log) {
  if (log.updateSummary) return log.updateSummary;
  
  const action = (log.action || '').toUpperCase();
  if (action.includes('CREATE')) return 'Task created';
  if (action.includes('DELETE')) return 'Task removed from system';
  if (action.includes('UPDATE')) return 'Task details updated';
  return 'Activity recorded';
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadFromLocalStorage();
  renderDashboard();

  fetchTasks();
  fetchAuditLogs();
  setupColumnSelection();

  liveTimerInterval = setInterval(() => {
    if (state.activeTab === 'board' && state.tasks.some(t => normalizeStatus(t.status) === 'in_progress')) {
      updateLiveTimers();
    }
  }, 1000);
});

/* ==========================================
   NAVIGATION & TAB SWITCHING
   ========================================== */
function switchTab(tabName) {
  state.activeTab = tabName;
  const views = ['board', 'list', 'audit'];

  views.forEach(v => {
    const sec = document.getElementById(`view-${v}`);
    const nav = document.getElementById(`nav-${v}`);
    
    if (sec) sec.classList.add('hidden');
    if (nav) {
      nav.classList.remove('active');
      const icon = nav.querySelector('i');
      if (icon) {
        icon.classList.remove('text-red-500');
        icon.classList.add('text-zinc-500');
      }
    }
  });

  const activeSec = document.getElementById(`view-${tabName}`);
  const activeNav = document.getElementById(`nav-${tabName}`);

  if (activeSec) activeSec.classList.remove('hidden');
  if (activeNav) {
    activeNav.classList.add('active');
    const icon = activeNav.querySelector('i');
    if (icon) {
      icon.classList.remove('text-zinc-500');
      icon.classList.add('text-red-500');
    }
  }

  if (tabName === 'audit') {
    fetchAuditLogs();
  } else {
    renderDashboard();
  }
}

/* ==========================================
   MODAL CONTROLS & TASK SAVE/EDIT
   ========================================== */
function openTaskModal(taskId = null) {
  const modal = document.getElementById('taskModal');
  const title = document.getElementById('modalTitle');
  state.editingTaskId = taskId;

  if (taskId) {
    const task = state.tasks.find(t => String(t.id) === String(taskId));
    if (!task) return;

    if (title) title.innerHTML = `<i class="fa-solid fa-pen-to-square text-red-500 text-sm"></i> Edit Task`;
    document.getElementById('taskTitleInput').value = task.title || '';
    document.getElementById('taskDescInput').value = task.description || '';
    document.getElementById('taskPriorityInput').value = task.priority || 'medium';
    document.getElementById('taskStatusInput').value = normalizeStatus(task.status);
    document.getElementById('taskDueDateInput').value = task.due_date || '';
  } else {
    if (title) title.innerHTML = `<i class="fa-solid fa-plus-circle text-red-500 text-sm"></i> Create New Task`;
    document.getElementById('taskTitleInput').value = '';
    document.getElementById('taskDescInput').value = '';
    document.getElementById('taskPriorityInput').value = 'medium';
    document.getElementById('taskStatusInput').value = 'pending';
    document.getElementById('taskDueDateInput').value = '';
  }

  if (modal) modal.classList.remove('hidden');
}

function closeTaskModal() {
  const modal = document.getElementById('taskModal');
  if (modal) modal.classList.add('hidden');
  state.editingTaskId = null;
}

async function saveTask() {
  const title = document.getElementById('taskTitleInput')?.value.trim();
  const description = document.getElementById('taskDescInput')?.value.trim();
  const priority = document.getElementById('taskPriorityInput')?.value || 'medium';
  const rawStatus = document.getElementById('taskStatusInput')?.value || 'pending';
  const status = toTitleStatus(normalizeStatus(rawStatus));
  const dueDate = document.getElementById('taskDueDateInput')?.value || null;

  if (!title) {
    alert('Please enter a task title.');
    return;
  }

  const now = new Date().toISOString();
  const timeStr = getShortTime(now);
  let task = state.editingTaskId 
    ? state.tasks.find(t => String(t.id) === String(state.editingTaskId)) 
    : null;

  const norm = normalizeStatus(status);

  if (task) {
    const changes = [];
    const oldNormStatus = normalizeStatus(task.status);
    
    if (oldNormStatus !== norm) {
      if (norm === 'in_progress') {
        changes.push(`Task shifted to IN PROGRESS state (AT: ${timeStr})`);
      } else if (norm === 'needs_review') {
        changes.push(`Task status updated to NEEDS REVIEW`);
      } else if (norm === 'completed') {
        changes.push(`Task marked as COMPLETED (AT: ${timeStr})`);
      } else {
        changes.push(`Task moved back to PENDING state`);
      }
    }

    if (task.title !== title) changes.push(`Title updated to "${title}"`);
    if (task.priority !== priority) changes.push(`Priority changed to ${priority.toUpperCase()}`);
    if (task.description !== description) changes.push(`Task description modified`);
    
    const updateSummary = changes.length > 0 ? changes.join(' | ') : 'Task configuration updated';

    task.title = title;
    task.description = description;
    task.priority = priority;
    task.status = status;
    task.due_date = dueDate;
    
    addLocalAuditLog('UPDATE', task.title, 'USER', task.id, updateSummary);
  } else {
    task = {
      id: String(Date.now()),
      title,
      description,
      priority,
      status,
      due_date: dueDate,
      creator: 'human',
      created_at: now,
      started_at: norm === 'in_progress' ? now : null,
      completed_at: norm === 'completed' ? now : null,
      duration_ms: null,
      subtasks: []
    };
    state.tasks.push(task);
    
    let initialDesc = `Task created in ${status} state`;
    if (norm === 'in_progress') initialDesc = `Task created and shifted directly to IN PROGRESS (AT: ${timeStr})`;
    
    addLocalAuditLog('CREATE', task.title, 'USER', task.id, initialDesc);
  }

  saveToLocalStorage();
  renderDashboard();
  closeTaskModal();

  if (state.isServerOnline) {
    const payload = {
      id: String(task.id),
      title: task.title,
      description: task.description || '',
      status: task.status,
      priority: task.priority,
      due_date: task.due_date,
      creator: task.creator || 'human',
      actor: 'USER',
      created_at: task.created_at || now,
      started_at: task.started_at || null,
      completed_at: task.completed_at || null,
      duration_ms: task.duration_ms || null,
      subtasks: task.subtasks || []
    };

    try {
      await fetch('http://127.0.0.1:8000/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      fetchAuditLogs();
    } catch (err) {
      console.warn('Backend save failed, stored locally.');
    }
  }
}

/* ==========================================
   STATUS DROPDOWN & AUDIT LOG MESSAGES
   ========================================== */
async function updateTaskStatus(taskId, rawNewStatus) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task) return;

  const newStatusNormalized = normalizeStatus(rawNewStatus);
  const formattedStatus = toTitleStatus(newStatusNormalized);
  const now = new Date().toISOString();
  const timeStr = getShortTime(now);

  task.status = formattedStatus;

  let updateSummary = `Task status updated to ${formattedStatus}`;

  if (newStatusNormalized === 'in_progress') {
    if (!task.started_at) task.started_at = now;
    updateSummary = `Task shifted to IN PROGRESS state (AT: ${timeStr})`;
  } else if (newStatusNormalized === 'needs_review') {
    updateSummary = `Task status updated. IT NEEDS REVIEW`;
  } else if (newStatusNormalized === 'completed') {
    task.completed_at = now;
    if (task.started_at) {
      const startTime = new Date(task.started_at).getTime();
      const endTime = new Date(now).getTime();
      task.duration_ms = endTime - startTime;
    }
    updateSummary = `Task marked as COMPLETED (AT: ${timeStr})`;
  } else if (newStatusNormalized === 'pending') {
    updateSummary = `Task moved back to PENDING state`;
  }

  addLocalAuditLog('UPDATE', task.title, 'USER', task.id, updateSummary);
  saveToLocalStorage();
  renderDashboard();

  if (state.isServerOnline) {
    const payload = {
      id: String(task.id),
      title: task.title || "Untitled",
      description: task.description || "",
      status: task.status,
      priority: task.priority || "medium",
      due_date: task.due_date || null,
      creator: task.creator || "human",
      actor: "USER",
      created_at: task.created_at || now,
      started_at: task.started_at || null,
      completed_at: task.completed_at || null,
      duration_ms: task.duration_ms || null,
      subtasks: Array.isArray(task.subtasks) ? task.subtasks : []
    };

    try {
      await fetch('http://127.0.0.1:8000/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      fetchAuditLogs();
    } catch (e) {
      console.warn('Backend update failed.');
    }
  }
}

async function deleteTask(taskId) {
  const taskToDelete = state.tasks.find(t => String(t.id) === String(taskId));
  if (taskToDelete) {
    const timeStr = getShortTime();
    addLocalAuditLog('DELETE', taskToDelete.title, 'USER', taskToDelete.id, `Task deleted from system (AT: ${timeStr})`);
  }

  state.tasks = state.tasks.filter(t => String(t.id) !== String(taskId));
  saveToLocalStorage();
  renderDashboard();

  if (state.isServerOnline) {
    try {
      await fetch(`http://127.0.0.1:8000/api/tasks/${taskId}?actor=USER`, {
        method: 'DELETE'
      });
      fetchAuditLogs();
    } catch (error) {
      console.warn('Backend delete failed.');
    }
  }
}

/* ==========================================
   DETAIL MODAL
   ========================================== */
function openDetailModal(taskId) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  const detailBody = document.getElementById('detailModalBody');
  if (!task || !detailBody) return;

  const taskLogs = (state.logs || []).filter(log => log.details && String(log.details.id) === String(taskId));

  let historyHtml = '';
  if (taskLogs.length === 0) {
    historyHtml = `
      <div class="text-[11px] font-mono text-zinc-500 italic p-3 bg-[#121318] rounded border border-zinc-800/80 text-center">
        No history recorded for this task yet.
      </div>`;
  } else {
    historyHtml = taskLogs.map(log => {
      const timeStr = log.timestamp 
        ? new Date(log.timestamp).toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            hour: 'numeric', 
            minute: '2-digit', 
            hour12: true 
          }) 
        : 'Unknown time';

      let actionBadge = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      if (log.action?.includes('DELETE')) actionBadge = "bg-red-500/10 text-red-400 border-red-500/20";
      if (log.action?.includes('CREATE')) actionBadge = "bg-blue-500/10 text-blue-400 border-blue-500/20";

      const updateText = getLogUpdateText(log);

      return `
        <div class="p-2.5 bg-[#121318] rounded border border-zinc-800/80 space-y-1.5">
          <div class="flex items-center justify-between text-xs">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 text-[10px] font-mono font-semibold rounded border ${actionBadge}">
                ${log.action}
              </span>
              <span class="text-zinc-400 font-mono text-[11px]">by <strong class="text-zinc-200">${log.actor || 'USER'}</strong></span>
            </div>
            
            <span class="text-[12px] font-mono text-zinc-400 bg-zinc-900 px-2 py-1 rounded-md border border-zinc-800">
              <i class="fa-regular fa-clock text-[11px] mr-1.5 text-zinc-500"></i>${timeStr}
            </span>
          </div>

          <div class="text-[11px] font-mono text-zinc-400 pt-1 border-t border-zinc-800/40 flex items-center gap-1.5">
            <i class="fa-solid fa-angle-right text-[10px] text-zinc-500"></i>
            <span>${updateText}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  const elapsedTime = task.duration_ms 
    ? formatDuration(task.duration_ms) 
    : (task.started_at ? `${getElapsed(task.started_at)} (Active)` : 'Not Started');

  detailBody.innerHTML = `
    <div class="space-y-4 my-3 text-xs">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 overflow-hidden">
          <h2 class="text-base font-bold text-white truncate">${task.title}</h2>
          <span class="px-2 py-0.5 text-xs font-mono font-medium text-zinc-300 bg-zinc-800/80 border border-zinc-700/50 rounded shrink-0">
            #${task.id}
          </span>
        </div>
        <span class="badge-priority badge-${task.priority || 'low'} shrink-0">${task.priority || 'low'}</span>
      </div>

      <p class="text-zinc-300 leading-relaxed bg-[#121318] p-3 rounded border border-zinc-800/80">
        ${task.description || 'No description provided.'}
      </p>

      <div class="grid grid-cols-2 gap-3 pt-2 text-zinc-400 font-mono">
        <div><span class="text-zinc-500 uppercase text-[10px] block">Status</span> <span class="text-zinc-200 capitalize">${toTitleStatus(normalizeStatus(task.status))}</span></div>
        <div><span class="text-zinc-500 uppercase text-[10px] block">Creator</span> <span class="text-zinc-200">${task.creator || 'human'}</span></div>
        <div><span class="text-zinc-500 uppercase text-[10px] block">Due Date</span> <span class="text-zinc-200">${task.due_date || 'None'}</span></div>
        <div><span class="text-zinc-500 uppercase text-[10px] block">Time Elapsed</span> <span class="text-zinc-200">${elapsedTime}</span></div>
        <div class="col-span-2">
          <span class="text-zinc-500 uppercase text-[10px] block">Created At</span> 
          <span class="text-zinc-200">${formatDate(task.created_at)}</span>
        </div>
      </div>

      <div class="pt-3 border-t border-zinc-800/80">
        <h4 class="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center gap-1.5">
          <i class="fa-solid fa-clock-rotate-left text-zinc-500"></i> Task History
        </h4>
        <div class="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
          ${historyHtml}
        </div>
      </div>

      <div class="flex justify-end pt-2 gap-2">
        <button onclick="closeDetailModal(); openTaskModal('${task.id}')" class="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-white text-xs transition">
          <i class="fa-solid fa-pen-to-square mr-1"></i> Edit
        </button>
      </div>
    </div>
  `;

  const modal = document.getElementById('detailModal');
  if (modal) modal.classList.remove('hidden');
}

function closeDetailModal() {
  const modal = document.getElementById('detailModal');
  if (modal) modal.classList.add('hidden');
}

/* ==========================================
   DATA FETCHING & AUDIT LOGS
   ========================================== */
async function fetchTasks() {
  const statusEl = document.getElementById('api-status');

  try {
    const res = await fetch('http://127.0.0.1:8000/api/tasks');
    if (!res.ok) throw new Error("Server offline");
    
    const data = await res.json();
    state.tasks = Array.isArray(data) ? data : (data.tasks || []);
    state.isServerOnline = true;

    if (statusEl) {
      statusEl.className = "api-badge api-badge-online";
      statusEl.innerHTML = `<span>Server Connected</span>`;
    }
  } catch (err) {
    state.isServerOnline = false;
    const storedTasks = localStorage.getItem('mcp_engine_tasks');
    state.tasks = storedTasks ? JSON.parse(storedTasks) : (typeof INITIAL_TASKS !== 'undefined' ? INITIAL_TASKS : []);

    if (statusEl) {
      statusEl.className = "api-badge api-badge-offline";
      statusEl.innerHTML = `<span>Standalone Mode</span>`;
    }
  }

  saveToLocalStorage();
  renderDashboard();
}

async function fetchAuditLogs() {
  try {
    const res = await fetch('http://127.0.0.1:8000/api/audit');
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.logs = Array.isArray(data) ? data : [];
    saveToLocalStorage();
  } catch (err) {
    const storedLogs = localStorage.getItem('mcp_engine_logs');
    state.logs = storedLogs ? JSON.parse(storedLogs) : (typeof INITIAL_LOGS !== 'undefined' ? INITIAL_LOGS : []);
  }
  renderAuditLogs();
}

function renderAuditLogs() {
  const container = document.getElementById('audit-log-container');
  if (!container) return;

  if (!state.logs || state.logs.length === 0) {
    container.innerHTML = `<div class="text-center text-zinc-500 py-8 font-mono text-xs">No activity logs recorded yet.</div>`;
    return;
  }

  container.innerHTML = state.logs.map(log => {
    const timeStr = log.timestamp 
      ? new Date(log.timestamp).toLocaleString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          hour: 'numeric', 
          minute: '2-digit', 
          hour12: true 
        }) 
      : 'Unknown time';

    let actionBadge = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    if (log.action?.includes('DELETE')) actionBadge = "bg-red-500/10 text-red-400 border-red-500/20";
    if (log.action?.includes('CREATE')) actionBadge = "bg-blue-500/10 text-blue-400 border-blue-500/20";

    const taskId = log.details?.id ? `#${log.details.id}` : 'N/A';
    const taskTitle = log.details?.title || 'Action Performed';
    const updateText = getLogUpdateText(log);

    return `
      <div class="p-3 bg-[#121318] rounded-lg border border-zinc-800/80 mb-2 space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="px-2.5 py-1 text-[11px] font-mono font-semibold rounded border ${actionBadge}">
              ${log.action}
            </span>
            
            <span class="px-2 py-0.5 text-xs font-mono font-medium text-zinc-300 bg-zinc-800/80 border border-zinc-700/50 rounded shrink-0">
              ${taskId}
            </span>

            <span class="text-zinc-300 text-xs font-mono font-medium truncate max-w-xs">
              ${taskTitle}
            </span>
          </div>

          <div class="flex items-center gap-3">
            <span class="text-xs font-mono text-zinc-400 bg-zinc-900/60 px-2 py-1 rounded border border-zinc-800/60">
              Actor: <strong class="text-zinc-200">${log.actor || 'USER'}</strong>
            </span>

            <span class="font-mono text-xs text-zinc-300 bg-zinc-900 px-2.5 py-1 rounded-md border border-zinc-800 flex items-center">
              <i class="fa-regular fa-clock mr-1.5 text-zinc-400"></i>${timeStr}
            </span>
          </div>
        </div>

        <div class="pt-1.5 border-t border-zinc-800/50 text-[11px] font-mono text-zinc-400 flex items-center gap-1.5 pl-1">
          <i class="fa-solid fa-angle-right text-[10px] text-zinc-500"></i>
          <span>${updateText}</span>
        </div>
      </div>
    `;
  }).join('');
}

/* ==========================================
   HELPERS & DASHBOARD RENDERERS
   ========================================== */
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

function getElapsed(startTime) {
  if (!startTime) return null;
  const start = new Date(startTime).getTime();
  const now = Date.now();
  return formatDuration(now - start);
}

function updateLiveTimers() {
  state.tasks.filter(t => normalizeStatus(t.status) === 'in_progress' && t.started_at).forEach(t => {
    const el = document.getElementById(`active-timer-${t.id}`);
    if (el) {
      el.innerHTML = `<i class="fa-solid fa-play text-[8px]"></i> Active: ${getElapsed(t.started_at)}`;
    }
  });
}

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
    const statusKey = normalizeStatus(t.status);
    if (counts[statusKey] !== undefined) counts[statusKey]++;

    const priorityClasses = {
      low: 'badge-low',
      medium: 'badge-medium',
      high: 'badge-high',
      urgent: 'badge-urgent'
    };
    const priorityStyle = priorityClasses[t.priority?.toLowerCase()] || priorityClasses.medium;

    let timeBadgeHtml = '';
    if (statusKey === 'completed' && t.duration_ms) {
      timeBadgeHtml = `<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 w-fit"><i class="fa-solid fa-stopwatch text-[10px]"></i> ${formatDuration(t.duration_ms)}</span>`;
    } else if (statusKey === 'in_progress' && t.started_at) {
      timeBadgeHtml = `<span id="active-timer-${t.id}" class="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center gap-1 animate-pulse w-fit"><i class="fa-solid fa-play text-[8px]"></i> Active: ${getElapsed(t.started_at)}</span>`;
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
          <option value="pending" ${statusKey === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="in_progress" ${statusKey === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="needs_review" ${statusKey === 'needs_review' ? 'selected' : ''}>Needs Review</option>
          <option value="completed" ${statusKey === 'completed' ? 'selected' : ''}>Completed</option>
        </select>
        <button onclick="deleteTask('${t.id}')" class="hover:text-red-400 transition p-1">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;

    if (cols[statusKey]) cols[statusKey].appendChild(card);
  });

  Object.keys(cols).forEach(key => {
    if (counts[key] === 0 && cols[key]) {
      cols[key].innerHTML = `<div class="h-32 flex items-center justify-center text-xs text-zinc-600 italic">No tasks</div>`;
    }
  });

  if (document.getElementById('count-pending')) document.getElementById('count-pending').textContent = counts.pending;
  if (document.getElementById('count-progress')) document.getElementById('count-progress').textContent = counts.in_progress;
  if (document.getElementById('count-review')) document.getElementById('count-review').textContent = counts.needs_review;
  if (document.getElementById('count-completed')) document.getElementById('count-completed').textContent = counts.completed;

  renderTableView(filtered);
}

function renderTableView(tasks) {
  const tbody = document.getElementById('task-table-body');
  if (!tbody) return;
  if (!tasks.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-xs text-zinc-500 italic">No tasks found</td></tr>`;
    return;
  }
  tbody.innerHTML = tasks.map(t => {
    const totalTime = t.duration_ms ? formatDuration(t.duration_ms) : (t.started_at ? 'In Progress' : 'Not Started');
    const displayStatus = toTitleStatus(normalizeStatus(t.status));
    return `
      <tr onclick="openDetailModal('${t.id}')" class="table-row hover:bg-zinc-800/40 cursor-pointer">
        <td class="p-4 font-medium text-white text-xs">${t.title || 'Untitled'}</td>
        <td class="p-4"><span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700/50">${displayStatus}</span></td>
        <td class="p-4 text-zinc-400 font-mono text-xs">${t.creator || 'human'}</td>
        <td class="p-4 text-zinc-400 font-mono text-xs">${totalTime}</td>
        <td class="p-4 text-right" onclick="event.stopPropagation()">
          <button onclick="openTaskModal('${t.id}')" class="text-zinc-500 hover:text-white p-1 transition mr-2"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteTask('${t.id}')" class="text-zinc-500 hover:text-red-400 p-1 transition"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}

function setupColumnSelection() {
  const columns = document.querySelectorAll('.kanban-col');

  columns.forEach((col) => {
    col.addEventListener('click', (e) => {
      if (e.target.closest('.task-card') || e.target.closest('button') || e.target.closest('select')) {
        return;
      }
      columns.forEach((c) => c.classList.remove('selected'));
      col.classList.add('selected');
    });
  });
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}
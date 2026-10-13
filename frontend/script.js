// Backend REST API (backend/app.py)
const API = 'http://127.0.0.1:8190/api';
// MCP server (mcp_server/server.py): agents connect to /mcp (Streamable HTTP; /sse for old SSE clients), the UI reads /status
const MCP_URL = 'http://127.0.0.1:8001';
const MCP_ENDPOINT = `${MCP_URL}/mcp`;

// State Management
let state = {
  tasks: [],
  logs: [],
  activeTab: 'board',
  activityFilter: 'all',
  apiKey: null,
  showKey: false,
  mcpOnline: null,
  agents: [],
  reportMode: 'day',
  report: null,
  editingTaskId: null,
  isServerOnline: false,
  dragging: false,
  agentName: 'all',
  page: 1
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

// Helper: Safely normalize subtasks into an array of standard objects
function parseSubtasks(subtasksData) {
  if (!subtasksData) return [];
  let parsed = subtasksData;
  if (typeof subtasksData === 'string') {
    try {
      parsed = JSON.parse(subtasksData);
    } catch (e) {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.map(item => {
    if (typeof item === 'object' && item !== null) {
      return {
        content: item.content || item.title || item.text || 'Unnamed Subtask',
        done: Boolean(item.done || item.completed)
      };
    }
    return { content: String(item), done: false };
  });
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

  state.tasks = storedTasks ? JSON.parse(storedTasks) : [];
  state.logs = storedLogs ? JSON.parse(storedLogs) : [];

  if (!storedTasks) saveToLocalStorage();
}

// Helper: Add local audit log entry matching FastAPI log payload format
function addLocalAuditLog(action, taskTitle, actor = 'USER', taskId = '', updateSummary = '') {
  const logEntry = {
    timestamp: new Date().toISOString(),
    action: action,
    actor: actor,
    updateSummary: updateSummary,
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
  setupDragAndDrop();
  setupTouchDrag();
  fetchApiKey();
  fetchAgents();
  setInterval(fetchAgents, 5000);
  setInterval(autoRefresh, 5000);

  liveTimerInterval = setInterval(() => {
    if (state.activeTab === 'board' && state.tasks.some(t => normalizeStatus(t.status) === 'in_progress')) {
      updateLiveTimers();
    }
  }, 1000);
});

/* ==========================================
   NAVIGATION & TAB SWITCHING
   ========================================== */
const TABS = ['board', 'list', 'audit', 'report', 'agents'];

function switchTab(tabName) {
  state.activeTab = tabName;

  TABS.forEach(v => {
    const active = v === tabName;
    document.getElementById(`view-${v}`)?.classList.toggle('hidden', !active);
    const nav = document.getElementById(`nav-${v}`);
    if (nav) {
      nav.setAttribute('aria-selected', active);
      nav.tabIndex = active ? 0 : -1;
      if (active) nav.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
  document.getElementById('tabs')?.style.setProperty('--i', TABS.indexOf(tabName));

  if (tabName === 'audit') fetchAuditLogs();
  else if (tabName === 'agents') { fetchApiKey(); fetchAgents(); }
  else if (tabName === 'report') fetchAuditLogs().then(renderReport);
  else renderDashboard();
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

    if (title) title.textContent = 'Edit task';
    document.getElementById('taskTitleInput').value = task.title || '';
    document.getElementById('taskDescInput').value = task.description || '';
    document.getElementById('taskPriorityInput').value = task.priority || 'medium';
    document.getElementById('taskStatusInput').value = normalizeStatus(task.status);
    document.getElementById('taskDueDateInput').value = task.due_date || '';
  } else {
    if (title) title.textContent = 'New task';
    document.getElementById('taskTitleInput').value = '';
    document.getElementById('taskDescInput').value = '';
    document.getElementById('taskPriorityInput').value = 'medium';
    document.getElementById('taskStatusInput').value = 'pending';
    document.getElementById('taskDueDateInput').value = '';
  }

  if (modal) modal.classList.remove('hidden');
  document.getElementById('taskTitleInput').focus();
}

function closeTaskModal() {
  const modal = document.getElementById('taskModal');
  if (modal) modal.classList.add('hidden');
  state.editingTaskId = null;
}

// Full task body for POST /tasks (create, or restore after an undo)
function taskPayload(task) {
  return {
    id: String(task.id),
    title: task.title || 'Untitled',
    description: task.description || '',
    status: task.status,
    priority: task.priority || 'medium',
    due_date: task.due_date || null,
    creator: task.creator || 'human',
    actor: 'USER',
    created_at: task.created_at || new Date().toISOString(),
    started_at: task.started_at || null,
    completed_at: task.completed_at || null,
    duration_ms: task.duration_ms || null,
    subtasks: parseSubtasks(task.subtasks)
  };
}

/* Every change is sent through write(). If the API can't be reached, the change waits in an outbox
   (kept in localStorage) and is replayed in order on the next successful sync, so offline edits survive. */
const OUTBOX_KEY = 'mcp_engine_outbox';
let outbox = [];
try { outbox = JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch (err) { outbox = []; }
const saveOutbox = () => { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch (err) { /* storage full or blocked */ } };

// true when the API took the change, or rejected it for good (4xx, e.g. the task was already deleted)
async function send(op) {
  try {
    const res = await fetch(`${API}${op.path}`, {
      method: op.method,
      headers: { 'Content-Type': 'application/json' },
      body: op.body ? JSON.stringify(op.body) : undefined
    });
    if (res.status >= 400 && res.status < 500) console.warn(`Change dropped (${res.status}):`, op);
    return res.status < 500;
  } catch (err) {
    return false;
  }
}

async function write(method, path, body) {
  const op = { method, path, body };
  // Earlier offline changes go first, so the order of edits is kept
  if (outbox.length || !(await send(op))) {
    outbox.push(op);
    saveOutbox();
    state.isServerOnline = false;
    setApiStatus(false);
    return false;
  }
  fetchAuditLogs();
  return true;
}

async function flushOutbox() {
  while (outbox.length) {
    if (!(await send(outbox[0]))) return false;
    outbox.shift();
    saveOutbox();
  }
  return true;
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
  let patch = null;

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

    // Send only what changed, so an agent's edits to other fields of this task survive
    patch = { actor: 'USER' };
    if (task.title !== title) patch.title = title;
    if ((task.description || '') !== description) patch.description = description;
    if ((task.priority || 'medium') !== priority) patch.priority = priority;
    if (oldNormStatus !== norm) patch.status = status;
    if ((task.due_date || null) !== dueDate) patch.due_date = dueDate;

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
  if (patch) await write('PATCH', `/tasks/${task.id}`, patch);
  else await write('POST', '/tasks', taskPayload(task));
}

/* ==========================================
   STATUS DROPDOWN & SUBTASK TOGGLE CONTROLS
   ========================================== */
async function toggleSubtask(taskId, index) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task) return;

  const subtasks = parseSubtasks(task.subtasks);
  if (subtasks[index]) {
    subtasks[index].done = !subtasks[index].done;
    task.subtasks = subtasks;

    const completedCount = subtasks.filter(s => s.done).length;
    addLocalAuditLog('UPDATE', task.title, 'USER', task.id, `Subtask updated (${completedCount}/${subtasks.length} completed)`);
    saveToLocalStorage();
    openDetailModal(taskId); // Refresh modal view
    await write('PATCH', `/tasks/${task.id}`, { subtasks, actor: 'USER' });
  }
}

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
    if (task.started_at && !task.duration_ms) {
      const startTime = new Date(task.started_at).getTime();
      const endTime = new Date(now).getTime();
      task.duration_ms = endTime - startTime;
    }
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
  await write('PATCH', `/tasks/${task.id}`, { status: formattedStatus, actor: 'USER' });
}

async function deleteTask(taskId) {
  const taskToDelete = state.tasks.find(t => String(t.id) === String(taskId));
  if (!taskToDelete) return;
  closeDetailModal();
  addLocalAuditLog('DELETE', taskToDelete.title, 'USER', taskToDelete.id, `Task deleted from system (AT: ${getShortTime()})`);

  state.tasks = state.tasks.filter(t => String(t.id) !== String(taskId));
  saveToLocalStorage();
  renderDashboard();
  showUndo(taskToDelete);
  await write('DELETE', `/tasks/${encodeURIComponent(taskId)}?actor=USER`);
}

// After a delete, offer Undo for 8 seconds. Undo puts the task back with its history and timestamps.
let undoTimer = null;
function showUndo(task) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-text').textContent = `Deleted "${task.title || 'Untitled'}".`;
  document.getElementById('toast-undo').onclick = () => restoreTask(task);
  toast.classList.remove('hidden');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => toast.classList.add('hidden'), 8000);
}

async function restoreTask(task) {
  clearTimeout(undoTimer);
  document.getElementById('toast').classList.add('hidden');
  if (!state.tasks.some(t => String(t.id) === String(task.id))) state.tasks.push(task);
  addLocalAuditLog('RESTORE', task.title, 'USER', task.id, 'Task restored');
  saveToLocalStorage();
  renderDashboard();
  await write('POST', '/tasks?restore=true', taskPayload(task));
}

/* ==========================================
   RENDER HELPERS (Inkpop markup)
   ========================================== */
// Task text comes from people and the AI agent: always escape before innerHTML
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const STATUS_LABEL = { pending: 'Pending', in_progress: 'In progress', needs_review: 'Needs review', completed: 'Completed' };
const STATUS_TONE = { pending: 'tone-1', in_progress: 'tone-2', needs_review: 'tone-4', completed: 'tone-3' };
const PRIORITY_TONE = { low: '', medium: 'tone-1', high: 'tone-4', urgent: 'tone-5' };
const STATUS_ICON = { pending: 'fa-hourglass-half', in_progress: 'fa-play', needs_review: 'fa-magnifying-glass', completed: 'fa-check' };

function statusPill(statusKey) {
  return `<span class="status ${STATUS_TONE[statusKey]}"><i class="fa-solid ${STATUS_ICON[statusKey]}" aria-hidden="true"></i>${toTitleStatus(statusKey)}</span>`;
}

function priorityChip(priority) {
  const p = (priority || 'medium').toLowerCase();
  return `<span class="chip ${PRIORITY_TONE[p] ?? ''}">${esc(p)}</span>`;
}

function logTone(action = '') {
  if (action.includes('DELETE')) return 'var(--p5)';
  if (action.includes('CREATE')) return 'var(--p1)';
  return 'var(--p3)';
}

function logTime(timestamp) {
  return timestamp
    ? new Date(timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    : 'Unknown time';
}

/* ==========================================
   PER-TASK HISTORY (audit trail inside the detail view)
   ========================================== */
function renderTaskHistory(taskId) {
  const historyBody = document.getElementById('taskHistory');
  if (!historyBody) return;

  const taskLogs = (state.logs || []).filter(log => log.details && String(log.details.id) === String(taskId));

  historyBody.innerHTML = taskLogs.length === 0
    ? `<li><p class="soft">No history yet. Changes to this task show up here.</p></li>`
    : taskLogs.map(log => `
        <li style="--tone: ${logTone(log.action)}">
          <div class="log">
            <div class="log-top"><span class="badge-key">${esc(log.action)}</span><span class="chip ${isAgentLog(log) ? 'tone-6' : ''}">${esc(isAgentLog(log) ? agentName(log.actor) : (log.actor || 'USER'))}</span><time>${logTime(log.timestamp)}</time></div>
            <p class="soft">${esc(getLogUpdateText(log))}</p>
          </div>
        </li>`).join('');
}

/* ==========================================
   DETAIL MODAL (CLEAN & SUBTASK FOCUS)
   ========================================== */
function openDetailModal(taskId) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  const detailBody = document.getElementById('detailModalBody');
  if (!task || !detailBody) return;

  const subtasks = parseSubtasks(task.subtasks);
  const completedCount = subtasks.filter(s => s.done).length;
  const subtasksHtml = subtasks.length > 0
    ? `<div class="subtasks">${subtasks.map((st, idx) => `
        <label><input type="checkbox" class="check" ${st.done ? 'checked' : ''} onchange="toggleSubtask('${esc(task.id)}', ${idx})">
          <span class="${st.done ? 'done' : ''}">${esc(st.content)}</span></label>`).join('')}</div>`
    : `<p class="soft">No subtasks yet. The AI agent adds them when it reports progress.</p>`;

  const normStatus = normalizeStatus(task.status);
  let elapsedTime = 'Not started';
  if (task.duration_ms) {
    elapsedTime = formatDuration(task.duration_ms);
  } else if (task.started_at) {
    const label = { in_progress: 'active', needs_review: 'in review' }[normStatus] || 'paused';
    elapsedTime = `${getElapsed(task.started_at)} (${label})`;
  }

  detailBody.innerHTML = `
    <div class="row"><h3 style="font-size:22px; overflow-wrap:anywhere">${esc(task.title)}</h3><span class="badge-key">#${esc(task.id)}</span>${priorityChip(task.priority)}</div>
    <div class="note-box">${esc(task.description || 'No description provided.')}</div>
    <dl class="meta">
      <div><dt><label for="detailStatus">Status</label></dt><dd>
        <select id="detailStatus" class="input input-sm" onchange="updateTaskStatus('${esc(task.id)}', this.value).then(() => openDetailModal('${esc(task.id)}'))">
          ${['pending', 'in_progress', 'needs_review', 'completed'].map(k => `<option value="${k}" ${k === normStatus ? 'selected' : ''}>${STATUS_LABEL[k]}</option>`).join('')}
        </select></dd></div>
      <div><dt>Creator</dt><dd>${esc(task.creator || 'human')}</dd></div>
      <div><dt>Due date</dt><dd class="mono">${esc(task.due_date || 'None')}${isOverdue(task) ? ' <span class="chip tone-5">Overdue</span>' : ''}</dd></div>
      <div><dt>Time spent</dt><dd class="mono">${elapsedTime}</dd></div>
      <div><dt>Created</dt><dd class="mono">${formatDate(task.created_at)}</dd></div>
      <div><dt>Subtasks</dt><dd><span class="chip">${completedCount} of ${subtasks.length} done</span></dd></div>
    </dl>
    <section class="stack-sm"><h4>Subtasks</h4>${subtasksHtml}</section>
    <section class="stack-sm"><h4>History</h4><ol id="taskHistory" class="timeline"></ol></section>
    <div class="modal-foot">
      <button class="btn btn-sm btn-warn" onclick="deleteTask('${esc(task.id)}')"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete</button>
      <button class="btn btn-sm btn-primary" onclick="closeDetailModal(); openTaskModal('${esc(task.id)}')"><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit</button>
    </div>
  `;

  renderTaskHistory(task.id);
  document.getElementById('detailModal')?.classList.remove('hidden');
  fetchAuditLogs().then(() => renderTaskHistory(task.id)); // pick up the AI agent's latest changes
}

function closeDetailModal() {
  document.getElementById('detailModal')?.classList.add('hidden');
}

/* ==========================================
   DATA FETCHING & AUDIT LOGS
   ========================================== */
function setApiStatus(online) {
  const statusEl = document.getElementById('api-status');
  if (!statusEl) return;
  statusEl.className = `status ${online ? 'tone-3' : 'tone-5'}`;
  statusEl.title = online ? `Backend ${API}` : `Can't reach ${API}`;
  statusEl.innerHTML = online
    ? `<span class="live-dot pulse" aria-hidden="true"></span>Live · synced ${getShortTime()}`
    : `<i class="fa-solid fa-plug-circle-xmark" aria-hidden="true"></i>Offline · ${outbox.length ? `${outbox.length} change${outbox.length > 1 ? 's' : ''} waiting` : 'saving locally'}`;
}

let lastTasksJson = '';

async function fetchTasks() {
  try {
    if (!(await flushOutbox())) throw new Error('offline');
    const res = await fetch(`${API}/tasks`);
    if (!res.ok) throw new Error("Server offline");

    const data = await res.json();
    state.tasks = Array.isArray(data) ? data : (data.tasks || []);
    state.isServerOnline = true;
  } catch (err) {
    state.isServerOnline = false;
    const storedTasks = localStorage.getItem('mcp_engine_tasks');
    state.tasks = storedTasks ? JSON.parse(storedTasks) : [];
  }

  setApiStatus(state.isServerOnline);
  const json = JSON.stringify(state.tasks);
  if (json === lastTasksJson) return; // nothing changed: keep the DOM (and keyboard focus) as it is
  lastTasksJson = json;
  saveToLocalStorage();
  renderDashboard();
}

// Every 5 s pick up what agents changed. Skip while the person is busy so nothing jumps under them.
function autoRefresh() {
  const modalOpen = [...document.querySelectorAll('.modal')].some(m => !m.classList.contains('hidden'));
  if (document.hidden || state.dragging || modalOpen) return;
  fetchTasks();
  if (state.activeTab === 'audit') fetchAuditLogs();
}

async function fetchAuditLogs() {
  try {
    const res = await fetch(`${API}/audit`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.logs = Array.isArray(data) ? data : [];
    saveToLocalStorage();
  } catch (err) {
    const storedLogs = localStorage.getItem('mcp_engine_logs');
    state.logs = storedLogs ? JSON.parse(storedLogs) : [];
  }
  renderAuditLogs();
}

const ACTIVITY_FILTERS = ['all', 'agent', 'human'];
// Agents log as 'AI:<name>' (older entries: 'AI_AGENT'); people log as 'USER'
const isAgentActor = (actor) => /^AI\b|^AI[_:]/i.test(actor || '');
const isAgentLog = (log) => isAgentActor(log.actor);
const agentName = (actor) => (actor || '').includes(':') ? actor.slice(actor.indexOf(':') + 1) : 'AI agent';

function setActivityFilter(filter) {
  state.activityFilter = filter;
  const group = document.getElementById('activity-filter');
  group?.style.setProperty('--i', ACTIVITY_FILTERS.indexOf(filter));
  group?.querySelectorAll('.tab').forEach((b, i) => b.setAttribute('aria-pressed', ACTIVITY_FILTERS[i] === filter));
  renderAuditLogs();
}

function renderAuditLogs() {
  const container = document.getElementById('audit-log-container');
  if (!container) return;

  const logs = state.logs || [];
  const agentCount = logs.filter(isAgentLog).length;
  document.getElementById('n-all').textContent = logs.length;
  document.getElementById('n-agent').textContent = agentCount;
  document.getElementById('n-human').textContent = logs.length - agentCount;

  // Agent filter: also narrow to one agent by name
  const names = [...new Set(logs.filter(isAgentLog).map(l => agentName(l.actor)))].sort();
  const picker = document.getElementById('agent-name-filter');
  picker.classList.toggle('hidden', state.activityFilter !== 'agent');
  if (!names.includes(state.agentName)) state.agentName = 'all';
  picker.innerHTML = `<option value="all">All agents</option>` + names.map(n => `<option value="${esc(n)}" ${n === state.agentName ? 'selected' : ''}>${esc(n)}</option>`).join('');

  const shown = logs.filter(log => state.activityFilter === 'all' || (state.activityFilter === 'agent') === isAgentLog(log))
    .filter(log => state.activityFilter !== 'agent' || state.agentName === 'all' || agentName(log.actor) === state.agentName);
  if (shown.length === 0) {
    const who = { all: 'anyone', agent: 'the AI agent', human: 'a person' }[state.activityFilter];
    container.innerHTML = `<li><div class="empty"><h3>Nothing yet</h3><p>No activity from ${who} so far.</p></div></li>`;
    return;
  }

  container.innerHTML = shown.map(log => {
    const agent = isAgentLog(log);
    return `
    <li style="--tone: ${logTone(log.action)}">
      <div class="log">
        <div class="log-top">
          <span class="badge-key">${esc(log.action)}</span>
          ${log.details?.id ? `<span class="chip">#${esc(log.details.id)}</span>` : ''}
          <span class="chip ${agent ? 'tone-6' : ''}"><i class="fa-solid ${agent ? 'fa-robot' : 'fa-user'}" aria-hidden="true"></i>&nbsp;${esc(agent ? agentName(log.actor) : (log.actor || 'USER'))}</span>
          <time>${logTime(log.timestamp)}</time>
        </div>
        ${log.details?.title && log.details.title !== getLogUpdateText(log) ? `<p class="log-title">${esc(log.details.title)}</p>` : ''}
        <p class="soft">${esc(getLogUpdateText(log))}</p>
      </div>
    </li>`;
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
    if (el) el.textContent = `Active ${getElapsed(t.started_at)}`;
  });
}

// Past its due date (local calendar day) and not completed
function isOverdue(t) {
  return Boolean(t.due_date) && normalizeStatus(t.status) !== 'completed' && t.due_date < dateKey(new Date());
}

function timeBadge(t, statusKey) {
  const elapsed = t.started_at ? Date.now() - new Date(t.started_at).getTime() : 0;
  if (statusKey === 'completed' && t.duration_ms >= 1000) {
    return `<span class="status tone-3"><i class="fa-solid fa-stopwatch" aria-hidden="true"></i>${formatDuration(t.duration_ms)}</span>`;
  }
  if (statusKey === 'in_progress' && elapsed >= 1000) {
    return `<span class="status tone-2"><i class="fa-solid fa-play" aria-hidden="true"></i><span id="active-timer-${esc(t.id)}">Active ${formatDuration(elapsed)}</span></span>`;
  }
  if (statusKey === 'needs_review' && t.duration_ms >= 1000) {
    return `<span class="status tone-4"><i class="fa-solid fa-pause" aria-hidden="true"></i>Took ${formatDuration(t.duration_ms)}</span>`;
  }
  return '';
}

const EMPTY_COLUMN = {
  pending: 'Nothing waiting. Add a task to start.',
  in_progress: 'Nobody is working on anything.',
  needs_review: 'Nothing to review right now.',
  completed: 'Nothing finished yet.'
};

function renderMascot(counts) {
  const total = counts.pending + counts.in_progress + counts.needs_review + counts.completed;
  const pct = total ? Math.round((counts.completed / total) * 100) : 0;
  const meter = document.getElementById('progress-meter');
  if (meter) {
    meter.setAttribute('aria-valuenow', pct);
    meter.firstElementChild.style.setProperty('--value', `${pct}%`);
  }
  const label = document.getElementById('progress-label');
  if (label) label.textContent = `${counts.completed} of ${total} tasks completed (${pct}%)`;

  const line = document.getElementById('mascot-line');
  if (!line) return;
  if (!total) line.textContent = "I'm Tick. The board is empty. Add a task and I'll keep watch.";
  else if (counts.needs_review) line.textContent = `${counts.needs_review} task${counts.needs_review > 1 ? 's' : ''} waiting for your review. Don't keep them waiting.`;
  else if (counts.in_progress) line.textContent = `${counts.in_progress} in progress. I'm timing every one.`;
  else if (counts.pending) line.textContent = `${counts.pending} pending. Someone pick one up.`;
  else line.textContent = 'Everything is done. Good work.';
}

const PAGE_SIZE = 20; // cards per column per page

function taskCard(t, statusKey) {
  const card = document.createElement('article');
  card.className = `card task ${STATUS_TONE[statusKey]}`;
  card.tabIndex = 0;
  card.draggable = true;
  card.dataset.id = t.id;
  card.setAttribute('aria-label', `${t.title || 'Untitled'}, ${STATUS_LABEL[statusKey]}. Press Enter for details.`);
  card.onclick = (e) => { if (!e.target.closest('button')) openDetailModal(t.id); };
  card.onkeydown = (e) => { if (e.key === 'Enter' && e.target === card) openDetailModal(t.id); };

  const isAI = isAgentActor(t.creator);
  const overdue = isOverdue(t);
  card.innerHTML = `
    <div class="task-top"><h3>${esc(t.title || 'Untitled')}</h3>${priorityChip(t.priority)}</div>
    ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
    <div class="task-foot">
      <span class="chip ${isAI ? 'tone-6' : ''}"><i class="fa-solid ${isAI ? 'fa-robot' : 'fa-user'}" aria-hidden="true"></i>&nbsp;${isAI ? esc(agentName(t.creator)) : 'Human'}</span>
      ${timeBadge(t, statusKey)}
      ${overdue ? `<span class="chip tone-5"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>&nbsp;Overdue · ${esc(t.due_date)}</span>`
        : t.due_date ? `<span class="chip"><i class="fa-regular fa-calendar" aria-hidden="true"></i>&nbsp;${esc(t.due_date)}</span>` : ''}
      <span class="task-actions">
        <button class="btn btn-round btn-sm" onclick="openTaskModal('${esc(t.id)}')" aria-label="Edit ${esc(t.title || 'task')}" title="Edit"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
        <button class="btn btn-round btn-sm btn-warn" onclick="deleteTask('${esc(t.id)}')" aria-label="Delete ${esc(t.title || 'task')}" title="Delete"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </span>
    </div>
  `;
  return card;
}

function changePage(step) {
  state.page += step;
  renderDashboard(); // clamps the page to what exists
  document.querySelector('#view-board .section-head')?.scrollIntoView({ block: 'nearest' });
}

function renderDashboard() {
  const query = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const filtered = state.tasks.filter(t =>
    (t.title || '').toLowerCase().includes(query) ||
    (t.description || '').toLowerCase().includes(query)
  );

  const columns = {
    pending: { el: 'col-pending', count: 'count-pending', range: 'range-pending' },
    in_progress: { el: 'col-progress', count: 'count-progress', range: 'range-progress' },
    needs_review: { el: 'col-review', count: 'count-review', range: 'range-review' },
    completed: { el: 'col-completed', count: 'count-completed', range: 'range-completed' }
  };

  // Oldest first in every column, so the task that has waited longest is on top
  const byStatus = { pending: [], in_progress: [], needs_review: [], completed: [] };
  filtered.forEach(t => byStatus[normalizeStatus(t.status)].push(t));
  const created = (t) => new Date(t.created_at || 0).getTime();
  Object.values(byStatus).forEach(list => list.sort((a, b) => created(a) - created(b)));

  // One page number for the whole board; there are as many pages as the fullest column needs
  const pages = Math.max(1, ...Object.values(byStatus).map(list => Math.ceil(list.length / PAGE_SIZE)));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * PAGE_SIZE;

  Object.entries(columns).forEach(([key, ids]) => {
    const list = byStatus[key];
    const shown = list.slice(start, start + PAGE_SIZE);
    const col = document.getElementById(ids.el);
    col.innerHTML = '';
    shown.forEach(t => col.appendChild(taskCard(t, key)));

    if (!list.length) {
      col.innerHTML = `<div class="empty"><p>${query ? 'No matches.' : EMPTY_COLUMN[key]}</p><p>Drop a task here.</p></div>`;
    } else if (!shown.length) {
      col.innerHTML = `<div class="empty"><p>All ${list.length} are on earlier pages.</p><p>Drop a task here.</p></div>`;
    }
    document.getElementById(ids.count).textContent = list.length;
    document.getElementById(ids.range).textContent = shown.length ? `${start + 1}–${start + shown.length} of ${list.length}` : '';
  });

  document.getElementById('page-label').textContent = `Page ${state.page} / ${pages}`;
  document.getElementById('page-prev').disabled = state.page === 1;
  document.getElementById('page-next').disabled = state.page === pages;

  const counts = Object.fromEntries(Object.entries(byStatus).map(([key, list]) => [key, list.length]));
  renderMascot(counts);
  renderTableView(filtered);
}

function renderTableView(tasks) {
  const tbody = document.getElementById('task-table-body');
  if (!tbody) return;
  if (!tasks.length) {
    tbody.innerHTML = `<tr><td colspan="5"><p class="soft">No tasks found.</p></td></tr>`;
    return;
  }
  tbody.innerHTML = tasks.map(t => {
    const totalTime = t.duration_ms ? formatDuration(t.duration_ms) : (t.started_at ? 'In progress' : 'Not started');
    return `
      <tr onclick="openDetailModal('${esc(t.id)}')">
        <td><b>${esc(t.title || 'Untitled')}</b></td>
        <td>${statusPill(normalizeStatus(t.status))}</td>
        <td><span class="chip ${t.creator === 'AI' ? 'tone-6' : ''}">${esc(t.creator || 'human')}</span></td>
        <td class="mono">${totalTime}</td>
        <td class="actions" onclick="event.stopPropagation()">
          <button class="btn btn-round btn-sm" onclick="openTaskModal('${esc(t.id)}')" aria-label="Edit task"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
          <button class="btn btn-round btn-sm btn-warn" onclick="deleteTask('${esc(t.id)}')" aria-label="Delete task"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}

// Drag a card onto another column to change its status
function setupDragAndDrop() {
  const board = document.querySelector('.board');
  if (!board) return;

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.task');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
    state.dragging = true;
  });
  board.addEventListener('dragend', (e) => {
    e.target.closest('.task')?.classList.remove('dragging');
    state.dragging = false;
    board.querySelectorAll('.drop-target').forEach(c => c.classList.remove('drop-target'));
  });
  board.addEventListener('dragover', (e) => {
    const col = e.target.closest('.col');
    if (!col) return;
    e.preventDefault();
    board.querySelectorAll('.drop-target').forEach(c => c !== col && c.classList.remove('drop-target'));
    col.classList.add('drop-target');
  });
  board.addEventListener('drop', (e) => {
    const col = e.target.closest('.col');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('drop-target');
    const id = e.dataTransfer.getData('text/plain');
    const task = state.tasks.find(t => String(t.id) === String(id));
    if (task && normalizeStatus(task.status) !== col.dataset.status) updateTaskStatus(id, col.dataset.status);
  });
}

// Touch screens have no native drag and drop: hold a card for 0.3 s, then drag it to a column.
// A quick swipe still scrolls the page; the page scrolls by itself near the top and bottom edges.
function setupTouchDrag() {
  const board = document.querySelector('.board');
  if (!board) return;
  let timer = null, drag = null, startX = 0, startY = 0;
  const colAt = (x, y) => document.elementFromPoint(x, y)?.closest('.col');
  const highlight = () => board.querySelectorAll('.col').forEach(c => c.classList.toggle('drop-target', c === colAt(drag.x, drag.y)));

  const stop = () => {
    clearTimeout(timer);
    timer = null;
    if (!drag) return;
    drag.ghost.remove();
    drag.card.classList.remove('dragging');
    board.querySelectorAll('.drop-target').forEach(c => c.classList.remove('drop-target'));
    drag = null;
    state.dragging = false;
  };

  const autoScroll = () => {
    if (!drag) return;
    const edge = 80;
    if (drag.y < edge) window.scrollBy(0, -12);
    else if (drag.y > innerHeight - edge) window.scrollBy(0, 12);
    highlight();
    requestAnimationFrame(autoScroll);
  };

  board.addEventListener('touchstart', (e) => {
    const card = e.target.closest('.task');
    if (!card || e.target.closest('button') || e.touches.length > 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    timer = setTimeout(() => {
      timer = null;
      const rect = card.getBoundingClientRect();
      const ghost = card.cloneNode(true);
      ghost.classList.add('touch-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, { width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top}px` });
      document.body.appendChild(ghost);
      card.classList.add('dragging');
      drag = { card, ghost, dx: startX - rect.left, dy: startY - rect.top, x: startX, y: startY };
      state.dragging = true;
      navigator.vibrate?.(15);
      requestAnimationFrame(autoScroll);
    }, 300);
  }, { passive: true });

  board.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (!drag) {
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > 10) { clearTimeout(timer); timer = null; } // a swipe: let it scroll
      return;
    }
    e.preventDefault(); // the finger is moving a card, not the page
    drag.x = t.clientX;
    drag.y = t.clientY;
    drag.ghost.style.left = `${t.clientX - drag.dx}px`;
    drag.ghost.style.top = `${t.clientY - drag.dy}px`;
  }, { passive: false });

  board.addEventListener('touchend', (e) => {
    if (!drag) return stop();
    e.preventDefault(); // no click afterwards, so the detail view stays closed
    const col = colAt(drag.x, drag.y);
    const id = drag.card.dataset.id;
    stop();
    const task = state.tasks.find(t => String(t.id) === String(id));
    if (col && task && normalizeStatus(task.status) !== col.dataset.status) updateTaskStatus(id, col.dataset.status);
  });
  board.addEventListener('touchcancel', stop);
  board.addEventListener('contextmenu', (e) => { if (drag || timer) e.preventDefault(); });
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return esc(dateString);

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/* ==========================================
   REPORT: day/week JSON an agent (even a small LLM) can turn into a report
   ========================================== */
const pad2 = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');

// Local time with offset, e.g. 2026-10-13T00:00:00+05:00
function localIso(d) {
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad2(off / 60)}:${pad2(off % 60)}`;
}
const dateKey = (d) => localIso(d).slice(0, 10);
const longDate = (d) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// Day = that calendar day. Week = Monday 00:00 to next Monday 00:00 around the picked date. End is exclusive.
function periodBounds(mode, dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  if (mode === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + (mode === 'week' ? 7 : 1));
  return { start, end };
}

const EVENT_ORDER = ['created', 'started', 'moved_to_review', 'completed', 'moved_back_to_pending', 'edited'];
const STATUS_ORDER = { completed: 0, needs_review: 1, in_progress: 2, pending: 3 };

function buildReport(mode, dateStr) {
  const { start, end } = periodBounds(mode, dateStr);
  const inPeriod = (ts) => { const t = ts ? new Date(ts).getTime() : NaN; return t >= start.getTime() && t < end.getTime(); };
  const logsInPeriod = (state.logs || []).filter(l => inPeriod(l.timestamp));
  const actorType = (log) => isAgentLog(log) ? 'ai_agent' : 'human';
  const lastDay = new Date(end.getTime() - 1);
  const label = mode === 'day' ? longDate(start) : `Week of ${longDate(start)} to ${longDate(lastDay)}`;
  const today = dateKey(new Date());

  const tasks = state.tasks.map(t => {
    const status = normalizeStatus(t.status);
    const logs = logsInPeriod.filter(l => String(l.details?.id) === String(t.id));
    const events = new Set();
    let completedAt = status === 'completed' && inPeriod(t.completed_at) ? t.completed_at : null;
    if (inPeriod(t.created_at)) events.add('created');
    if (inPeriod(t.started_at)) events.add('started');
    if (completedAt) events.add('completed');
    logs.forEach(l => {
      const text = getLogUpdateText(l).toLowerCase();
      if ((l.action || '').includes('CREATE')) events.add('created');
      else if (text.includes('review')) events.add('moved_to_review');
      else if (text.includes('completed')) { events.add('completed'); completedAt ||= l.timestamp; }
      else if (text.includes('in progress') || text.includes('in_progress')) events.add('started');
      else if (text.includes('pending')) events.add('moved_back_to_pending');
      else events.add('edited');
    });
    if (!events.size) return null;

    const subtasks = parseSubtasks(t.subtasks);
    const elapsed = t.started_at ? Date.now() - new Date(t.started_at).getTime() : 0;
    const spentMs = t.duration_ms >= 1000 ? t.duration_ms : (status === 'in_progress' && elapsed >= 1000 ? elapsed : null);
    return {
      id: String(t.id),
      title: t.title || 'Untitled',
      description: t.description || '',
      priority: (t.priority || 'medium').toLowerCase(),
      created_by: isAgentActor(t.creator) ? 'ai_agent' : 'human',
      created_by_name: isAgentActor(t.creator) ? agentName(t.creator) : 'person',
      status_now: STATUS_LABEL[status],
      events_in_period: EVENT_ORDER.filter(e => events.has(e)),
      completed_on: completedAt ? dateKey(new Date(completedAt)) : null,
      time_spent: spentMs ? formatDuration(spentMs) : 'not tracked',
      time_spent_ms: spentMs,
      due_date: t.due_date || null,
      is_overdue: isOverdue(t),
      subtasks: { done: subtasks.filter(s => s.done).length, total: subtasks.length, items: subtasks.map(s => ({ text: s.content, done: s.done })) },
      activity: logs.slice().reverse().map(l => ({
        when: localIso(new Date(l.timestamp)), actor: isAgentLog(l) ? agentName(l.actor) : (l.actor || 'USER'), actor_type: actorType(l), action: l.action, summary: getLogUpdateText(l)
      }))
    };
  }).filter(Boolean).sort((a, b) =>
    STATUS_ORDER[normalizeStatus(a.status_now)] - STATUS_ORDER[normalizeStatus(b.status_now)] || a.title.localeCompare(b.title));

  const count = (event) => tasks.filter(t => t.events_in_period.includes(event)).length;
  const completedMs = tasks.filter(t => t.events_in_period.includes('completed')).reduce((sum, t) => sum + (t.time_spent_ms || 0), 0);
  const snapshot = { pending: 0, in_progress: 0, needs_review: 0, completed: 0 };
  state.tasks.forEach(t => snapshot[normalizeStatus(t.status)]++);
  const titles = (pred) => tasks.filter(pred).map(t => t.title);

  const report = {
    report_type: mode === 'day' ? 'daily_task_report' : 'weekly_task_report',
    instructions_for_llm: [
      `1. Start with the heading: "${mode === 'day' ? 'Daily' : 'Weekly'} report: ${label}".`,
      '2. Write 2 or 3 sentences that summarise the period using ONLY the numbers in "summary".',
      '3. Write a section "Completed" listing every task whose status_now is "Completed", with its time_spent.',
      '4. Write a section "In progress and waiting" listing every other task with its status_now and events_in_period.',
      '5. Write a section "Needs attention" using "needs_attention". If all its lists are empty, write "Nothing needs attention."',
      '6. If "deleted_tasks" is not empty, list them in a short "Deleted" section.',
      mode === 'week' ? '7. End with one line per day from "per_day" saying how many tasks were completed that day.' : '7. Keep the whole report under 250 words.',
      '8. Use only facts from this JSON. Never invent tasks, names, numbers or dates. If a value is "not tracked" or empty, say so or leave it out.'
    ],
    period: { type: mode, label, start: localIso(start), end_exclusive: localIso(end),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    generated_at: localIso(new Date()),
    summary: {
      tasks_with_activity: tasks.length,
      tasks_created: count('created'),
      tasks_started: count('started'),
      tasks_moved_to_review: count('moved_to_review'),
      tasks_completed: count('completed'),
      tasks_deleted: logsInPeriod.filter(l => (l.action || '').includes('DELETE')).length,
      time_spent_on_completed_tasks: completedMs ? formatDuration(completedMs) : 'not tracked',
      actions_by_human: logsInPeriod.filter(l => !isAgentLog(l)).length,
      actions_by_ai_agent: logsInPeriod.filter(isAgentLog).length
    },
    needs_attention: {
      waiting_for_review: titles(t => t.status_now === 'Needs review'),
      overdue: titles(t => t.is_overdue),
      still_in_progress: titles(t => t.status_now === 'In progress')
    },
    board_now: { ...snapshot, total: state.tasks.length },
    tasks,
    deleted_tasks: logsInPeriod.filter(l => (l.action || '').includes('DELETE')).map(l => ({
      id: String(l.details?.id || ''), summary: getLogUpdateText(l), deleted_by: l.actor || 'USER', when: localIso(new Date(l.timestamp))
    }))
  };

  if (mode === 'week') {
    report.per_day = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start); day.setDate(start.getDate() + i);
      const key = dateKey(day);
      return {
        date: key,
        weekday: day.toLocaleDateString('en-GB', { weekday: 'long' }),
        tasks_completed: tasks.filter(t => t.completed_on === key).length,
        actions: logsInPeriod.filter(l => dateKey(new Date(l.timestamp)) === key).length
      };
    });
  }

  report.field_guide = {
    status_now: 'The task status at the moment this JSON was generated: Pending, In progress, Needs review or Completed.',
    events_in_period: 'What happened to the task inside the period, in order: created, started, moved_to_review, completed, moved_back_to_pending, edited.',
    time_spent: 'Time from start to review/completion (or time so far if still in progress). "not tracked" means no start time was recorded.',
    created_by: '"human" for tasks a person made on the board, "ai_agent" for tasks an AI agent made through MCP.',
    actor_type: '"human" or "ai_agent": who performed that action. For agents, "actor" is the agent\'s name.',
    created_by_name: 'The agent\'s name (for example "opencode") when created_by is "ai_agent".',
    is_overdue: 'true when the due date has passed and the task is not completed.',
    completed_on: 'The date (YYYY-MM-DD) the task was completed inside this period, or null.',
    board_now: 'How many tasks are in each column right now, across all time.'
  };
  return report;
}

function setReportMode(mode) {
  state.reportMode = mode;
  const group = document.getElementById('report-mode');
  group.style.setProperty('--i', mode === 'week' ? 1 : 0);
  group.querySelectorAll('.tab').forEach((b, i) => b.setAttribute('aria-pressed', (i === 1) === (mode === 'week')));
  renderReport();
}

function renderReport() {
  const input = document.getElementById('report-date');
  if (!input.value) input.value = dateKey(new Date());
  const report = state.report = buildReport(state.reportMode, input.value);
  const s = report.summary;
  document.getElementById('report-label').textContent = report.period.label;
  document.getElementById('report-tiles').innerHTML = [
    ['tone-1', 'Tasks touched', s.tasks_with_activity, 'had activity'],
    ['tone-3', 'Completed', s.tasks_completed, s.time_spent_on_completed_tasks],
    ['tone-4', 'Waiting review', report.needs_attention.waiting_for_review.length, 'need a human'],
    ['tone-6', 'Agent actions', s.actions_by_ai_agent, `${s.actions_by_human} by humans`]
  ].map(([tone, name, value, note]) => `<div class="tile ${tone}"><small>${name}</small><b>${value}</b><span>${esc(note)}</span></div>`).join('');
  document.getElementById('report-json').textContent = JSON.stringify(report, null, 2);
}

function downloadReport() {
  if (!state.report) return;
  const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.report.report_type}_${state.report.period.start.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ==========================================
   AGENTS: MCP CONNECTIONS + API KEY
   ========================================== */
async function fetchAgents() {
  try {
    const res = await fetch(`${MCP_URL}/status`);
    if (!res.ok) throw new Error();
    state.agents = (await res.json()).agents || [];
    state.mcpOnline = true;
  } catch (err) {
    state.agents = [];
    state.mcpOnline = false;
  }
  renderAgents();
}

function renderAgents() {
  const live = state.agents.filter(a => a.key_valid).length; // agents, not sessions (one agent can hold several)
  document.getElementById('n-agents').textContent = live;

  const statusEl = document.getElementById('mcp-status');
  statusEl.className = `status ${state.mcpOnline ? 'tone-3' : 'tone-5'}`;
  statusEl.innerHTML = state.mcpOnline
    ? `<span class="live-dot pulse" aria-hidden="true"></span>MCP server running`
    : `<i class="fa-solid fa-plug-circle-xmark" aria-hidden="true"></i>MCP server offline`;

  const list = document.getElementById('agent-list');
  if (!state.mcpOnline) {
    list.innerHTML = `<li class="empty"><h3>MCP server is not running</h3><p>Start it with <code>task mcp</code> (or <code>task dev</code> for everything).</p></li>`;
    return;
  }
  if (!state.agents.length) {
    list.innerHTML = `<li class="empty"><h3>No agent connected</h3><p>Copy a config from the API key panel into your agent and start it. It shows up here within 5 seconds.</p></li>`;
    return;
  }
  list.innerHTML = state.agents.map(a => `
    <li class="agent">
      <span class="avatar" aria-hidden="true"><i class="fa-solid fa-robot"></i></span>
      <div>
        <b>${esc(a.name)}</b> ${a.version ? `<span class="chip">v${esc(a.version)}</span>` : ''}
        ${a.sessions > 1 ? `<span class="chip" title="This agent holds ${a.sessions} MCP sessions">${a.sessions} sessions</span>` : ''}
        <p class="soft">Connected since ${getShortTime(a.connected_at)}</p>
      </div>
      <span class="agent-actions">${a.key_valid
        ? `<span class="status tone-3"><span class="live-dot pulse" aria-hidden="true"></span>Connected</span>`
        : `<span class="status tone-5"><i class="fa-solid fa-key" aria-hidden="true"></i>Old key: reconnect</span>`}
      ${a.ids?.length ? `<button class="btn btn-sm btn-warn" onclick="disconnectAgent('${esc(a.ids.join(','))}', this)" aria-label="Disconnect ${esc(a.name)}"><i class="fa-solid fa-plug-circle-xmark" aria-hidden="true"></i> Disconnect</button>` : ''}</span>
    </li>`).join('');
}

async function fetchApiKey() {
  try {
    const res = await fetch(`${API}/mcp/key`);
    if (!res.ok) throw new Error();
    state.apiKey = (await res.json()).key;
  } catch (err) {
    state.apiKey = null;
  }
  renderKey();
}

// Ends all of the agent's sessions and closes its connections. It can reconnect with the key; rotating the key keeps it out.
async function disconnectAgent(ids, btn) {
  btn.disabled = true;
  try {
    for (const id of ids.split(',')) {
      const res = await fetch(`${MCP_URL}/agents/${encodeURIComponent(id)}/disconnect`, {
        method: 'POST', headers: { Authorization: `Bearer ${state.apiKey}` }
      });
      if (!res.ok && res.status !== 404) throw new Error(res.status); // 404: that session had already gone
    }
  } catch (err) {
    btn.disabled = false;
    alert("Couldn't disconnect the agent: the MCP server or the API is not reachable.");
    return;
  }
  fetchAgents();
}

async function rotateKey() {
  if (!confirm('Rotate the API key? Every connected agent is cut off until it uses the new key.')) return;
  try {
    const res = await fetch(`${API}/mcp/key/rotate`, { method: 'POST' });
    if (!res.ok) throw new Error();
    state.apiKey = (await res.json()).key;
    state.showKey = true;
    renderKey();
    fetchAuditLogs();
  } catch (err) {
    alert("Couldn't rotate the key: the backend is offline.");
  }
}

function toggleKey() {
  state.showKey = !state.showKey;
  renderKey();
}

// opencode v2 config shape: mcp.servers.<name>
const opencodeSnippet = (key) => JSON.stringify({ mcp: { servers: { 'todo-list-server': {
  type: 'remote', url: MCP_ENDPOINT, headers: { Authorization: `Bearer ${key}` } } } } }, null, 2);
// --global writes to the user's opencode config, so the key never lands in this repo's committed opencode.json
const opencodeCommand = (key) => `opencode mcp add todo-list-server --url ${MCP_ENDPOINT} --header "Authorization=Bearer ${key}" --global`;
const claudeSnippet = (key) => `claude mcp add --transport http todo-list-server ${MCP_ENDPOINT} --header "Authorization: Bearer ${key}"`;

function renderKey() {
  const shown = !state.apiKey ? null : state.showKey ? state.apiKey : `${state.apiKey.slice(0, 6)}${'•'.repeat(26)}`;
  document.getElementById('api-key').textContent = shown || 'Backend offline: start it with task backend';
  document.getElementById('snippet-opencode-cmd').textContent = opencodeCommand(shown || '<key>');
  document.getElementById('snippet-opencode').textContent = opencodeSnippet(shown || '<key>');
  document.getElementById('snippet-claude').textContent = claudeSnippet(shown || '<key>');
  document.getElementById('key-toggle').innerHTML = state.showKey
    ? '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i> Hide'
    : '<i class="fa-solid fa-eye" aria-hidden="true"></i> Show';
}

async function copyText(text, btn) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  const label = btn.innerHTML;
  btn.textContent = 'Copied ✓';
  setTimeout(() => { btn.innerHTML = label; }, 1200);
}

// Escape closes the top modal; arrow keys move between view tabs
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    for (const [id, close] of [['taskModal', closeTaskModal], ['detailModal', closeDetailModal]]) {
      if (!document.getElementById(id).classList.contains('hidden')) return close();
    }
  }
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (step && e.target.closest('#tabs')) {
    const i = (TABS.indexOf(state.activeTab) + step + TABS.length) % TABS.length;
    switchTab(TABS[i]);
    document.getElementById(`nav-${TABS[i]}`).focus();
  }
});

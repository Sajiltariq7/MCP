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
  tools: [],
  reportMode: 'day',
  report: null,
  editingTaskId: null,
  isServerOnline: false,
  dragging: false,
  agentName: 'all',
  page: 1,
  creatorFilter: 'all',
  deleted: []
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
  fetchDeleted();
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
const TABS = ['board', 'list', 'audit', 'report', 'deleted', 'agents'];

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
  else if (tabName === 'deleted') fetchDeleted();
  else renderDashboard();
}

/* ==========================================
   MODAL CONTROLS & TASK SAVE/EDIT
   ========================================== */
function openTaskModal(taskId = null) {
  const modal = document.getElementById('taskModal');
  const task = taskId ? state.tasks.find(t => String(t.id) === String(taskId)) : null;
  if (taskId && !task) return;
  state.editingTaskId = taskId;

  document.getElementById('modalTitle').textContent = task ? 'Edit task' : 'New task';
  document.getElementById('taskTitleInput').value = task?.title || '';
  document.getElementById('taskDescInput').value = task?.description || '';
  document.getElementById('taskPriorityInput').value = task?.priority || 'medium';
  document.getElementById('taskDueDateInput').value = task?.due_date || '';
  // Most tasks need a screenshot, so that is the default for new ones
  document.getElementById('taskEvidenceInput').value = task ? (task.evidence_type || 'none') : 'screenshot';
  document.getElementById('taskEvidenceNote').value = task?.evidence_note || '';
  document.getElementById('newTaskHint').classList.toggle('hidden', Boolean(task));
  document.getElementById('taskRefsInput').value = '';
  showChosenRefs();
  syncEvidenceNote();

  modal.classList.remove('hidden');
  document.getElementById('taskTitleInput').focus();
}

function showChosenRefs() {
  const files = [...document.getElementById('taskRefsInput').files];
  document.getElementById('taskRefsChosen').textContent = files.length
    ? files.map(f => f.name).join(', ')
    : 'A mockup, a screenshot of the bug, an example: anything that helps do the task.';
}

// "Another attachment" must say which file; "No evidence" needs no note
function syncEvidenceNote() {
  const kind = document.getElementById('taskEvidenceInput').value;
  const note = document.getElementById('taskEvidenceNote');
  note.classList.toggle('hidden', kind === 'none');
  note.required = kind === 'attachment';
  note.placeholder = kind === 'attachment'
    ? 'Which file is needed? e.g. the exported CSV report'
    : 'What should the screenshot show? (optional) e.g. the login page after the fix';
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
    subtasks: parseSubtasks(task.subtasks),
    evidence_type: task.evidence_type || 'none',
    evidence_note: task.evidence_note || '',
    comments: task.comments || []
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
    if (res.status >= 400 && res.status < 500) {
      // Refused for good (a lifecycle rule, a deleted task): say why, then reload what the API has
      let detail = `The change was refused (${res.status}).`;
      try { detail = (await res.json()).detail || detail; } catch (err) { /* not JSON */ }
      showToast(typeof detail === 'string' ? detail : JSON.stringify(detail));
      setTimeout(fetchTasks, 0);
    }
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

// New tasks always start in Pending; status changes go through requestMove() (drag, or the detail view)
async function saveTask() {
  const title = document.getElementById('taskTitleInput').value.trim();
  const description = document.getElementById('taskDescInput').value.trim();
  const priority = document.getElementById('taskPriorityInput').value || 'medium';
  const dueDate = document.getElementById('taskDueDateInput').value || null;
  const evidenceType = document.getElementById('taskEvidenceInput').value;
  const evidenceNote = evidenceType === 'none' ? '' : document.getElementById('taskEvidenceNote').value.trim();

  if (!title) return alert('Please enter a task title.');
  if (evidenceType === 'attachment' && !evidenceNote) return alert('Say which attachment is needed.');

  let task = state.editingTaskId ? state.tasks.find(t => String(t.id) === String(state.editingTaskId)) : null;
  let patch = null;

  if (task) {
    const changes = [];
    if (task.title !== title) changes.push(`Title updated to "${title}"`);
    if ((task.priority || 'medium') !== priority) changes.push(`Priority changed to ${priority.toUpperCase()}`);
    if ((task.description || '') !== description) changes.push('Task description modified');
    if ((task.evidence_type || 'none') !== evidenceType || (task.evidence_note || '') !== evidenceNote) changes.push('Evidence requirement changed');

    // Send only what changed, so an agent's edits to other fields of this task survive
    patch = { actor: 'USER' };
    if (task.title !== title) patch.title = title;
    if ((task.description || '') !== description) patch.description = description;
    if ((task.priority || 'medium') !== priority) patch.priority = priority;
    if ((task.due_date || null) !== dueDate) patch.due_date = dueDate;
    if ((task.evidence_type || 'none') !== evidenceType) patch.evidence_type = evidenceType;
    if ((task.evidence_note || '') !== evidenceNote) patch.evidence_note = evidenceNote;

    Object.assign(task, { title, description, priority, due_date: dueDate, evidence_type: evidenceType, evidence_note: evidenceNote });
    addLocalAuditLog('UPDATE', task.title, 'USER', task.id, changes.join(' | ') || 'Task configuration updated');
  } else {
    task = {
      id: String(Date.now()),
      title,
      description,
      priority,
      status: 'Pending',
      due_date: dueDate,
      creator: 'human',
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      duration_ms: null,
      subtasks: [],
      evidence_type: evidenceType,
      evidence_note: evidenceNote,
      comments: [],
      attachments: []
    };
    state.tasks.push(task);
    addLocalAuditLog('CREATE', task.title, 'USER', task.id, 'Task created in Pending');
  }

  const refs = [...document.getElementById('taskRefsInput').files];
  saveToLocalStorage();
  renderDashboard();
  closeTaskModal();
  const saved = patch ? await write('PATCH', `/tasks/${task.id}`, patch) : await write('POST', '/tasks', taskPayload(task));
  if (refs.length) {
    if (saved) await uploadAttachments(task.id, refs, 'reference');
    else showToast('The task is saved locally. Attach the reference files from the task once the API is back.');
  }
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

async function updateTaskStatus(taskId, rawNewStatus, comment = '') {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task) return;

  const newStatusNormalized = normalizeStatus(rawNewStatus);
  const formattedStatus = toTitleStatus(newStatusNormalized);
  const now = new Date().toISOString();
  const timeStr = getShortTime(now);

  const previousStatus = task.status;
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

  if (comment) {
    const from = STATUS_LABEL[normalizeStatus(previousStatus)];
    const backward = isBackward(normalizeStatus(previousStatus), newStatusNormalized);
    task.comments = [...(task.comments || []), { author: 'USER', text: comment, at: now, kind: backward ? 'sent_back' : 'note', from, to: STATUS_LABEL[newStatusNormalized] }];
    updateSummary += ` (sent back: ${comment})`;
  }

  addLocalAuditLog('UPDATE', task.title, 'USER', task.id, updateSummary);
  saveToLocalStorage();
  renderDashboard();
  refreshDetail(taskId);
  await write('PATCH', `/tasks/${task.id}`, { status: formattedStatus, actor: 'USER', ...(comment ? { comment } : {}) });
}

function deleteTask(taskId) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task) return;
  const status = normalizeStatus(task.status);
  if (status === 'needs_review' || status === 'completed') {
    return askReason({
      title: `Delete "${task.title}"?`,
      text: `It is ${STATUS_LABEL[status]}, so say why it is being deleted. It moves to the Deleted tab with everything it had.`,
      label: 'Why delete it?',
      button: 'Delete',
      placeholder: 'e.g. Duplicate of another task.',
      danger: true
    }, (reason) => removeTask(task, reason));
  }
  return removeTask(task, '');
}

async function removeTask(task, reason) {
  closeDetailModal();
  addLocalAuditLog('DELETE', task.title, 'USER', task.id, `Task deleted${reason ? `: ${reason}` : ''} (AT: ${getShortTime()})`);
  state.tasks = state.tasks.filter(t => String(t.id) !== String(task.id));
  saveToLocalStorage();
  renderDashboard();
  showUndo(task);
  await write('DELETE', `/tasks/${encodeURIComponent(task.id)}?actor=USER${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`);
  fetchDeleted();
}

// A short message at the bottom of the screen, optionally with one action button
let undoTimer = null;
function showToast(text, actionLabel = '', action = null, ms = 8000) {
  const toast = document.getElementById('toast');
  const button = document.getElementById('toast-undo');
  document.getElementById('toast-text').textContent = text;
  button.classList.toggle('hidden', !action);
  button.textContent = actionLabel;
  button.onclick = () => { toast.classList.add('hidden'); action(); };
  toast.classList.remove('hidden');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => toast.classList.add('hidden'), ms);
}

// After a delete, offer Undo for 8 seconds. Undo puts the task back with its history and timestamps.
function showUndo(task) {
  showToast(`Deleted "${task.title || 'Untitled'}".`, 'Undo', () => restoreTask(task));
}

async function restoreTask(task) {
  clearTimeout(undoTimer);
  document.getElementById('toast').classList.add('hidden');
  if (!state.tasks.some(t => String(t.id) === String(task.id))) state.tasks.push(task);
  addLocalAuditLog('RESTORE', task.title, 'USER', task.id, 'Task restored');
  saveToLocalStorage();
  renderDashboard();
  await write('POST', '/tasks?restore=true', taskPayload(task));
  fetchDeleted();
}

/* ==========================================
   STATUS MOVES: the same rules the API enforces for people and agents
   ========================================== */
const ALLOWED_MOVES = {
  pending: ['in_progress'],
  in_progress: ['needs_review', 'pending'],
  needs_review: ['completed', 'in_progress', 'pending'],
  completed: ['needs_review', 'in_progress']
};
const NEXT_HINT = { pending: 'Move it to In progress first.', in_progress: 'Move it to Needs review first; approving it completes it.' };
// Going back needs a reason: review -> work, or reopening a completed task (to review or to work)
const isBackward = (from, to) => (['needs_review', 'completed'].includes(from) && ['in_progress', 'pending'].includes(to)) || (from === 'completed' && to === 'needs_review');

// Two kinds of files: references (material to work from, any time) and evidence (proof, added while In progress)
const evidenceOf = (t) => (t.attachments || []).filter(a => (a.kind || 'evidence') === 'evidence');
const referencesOf = (t) => (t.attachments || []).filter(a => a.kind === 'reference');

// What evidence is still missing before review, or null
function missingEvidence(t) {
  const kind = t.evidence_type || 'none';
  const files = evidenceOf(t);
  const what = t.evidence_note ? `: ${t.evidence_note}` : '';
  if (kind === 'screenshot' && !files.some(a => (a.content_type || '').startsWith('image/'))) return `It needs a screenshot first${what}.`;
  if (kind === 'attachment' && !files.length) return `It needs an attachment first${what}.`;
  return null;
}

// If the detail view shows this task, redraw it (e.g. to reset its status picker)
function refreshDetail(taskId) {
  const open = !document.getElementById('detailModal').classList.contains('hidden');
  if (open && String(state.detailTaskId) === String(taskId)) openDetailModal(taskId);
}

// Every status change on the board goes through here: drag, touch drag, and the detail view's picker
function requestMove(taskId, rawTo) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task) return;
  const from = normalizeStatus(task.status);
  const to = normalizeStatus(rawTo);
  if (from === to) return;

  if (!ALLOWED_MOVES[from].includes(to)) {
    showToast(`Can't move "${task.title}" from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}. ${NEXT_HINT[from] || ''}`);
    return refreshDetail(taskId);
  }
  if (to === 'needs_review') {
    const missing = missingEvidence(task);
    if (missing) {
      showToast(`"${task.title}" can't go to review yet. ${missing}`, 'Open task', () => openDetailModal(taskId));
      return refreshDetail(taskId);
    }
  }
  if (isBackward(from, to)) return openReasonModal(task, from, to);
  return updateTaskStatus(taskId, to);
}

// One "why?" dialog for everything that needs a reason: sending back, reopening, deleting
let reasonRequest = null;
function askReason({ title, text, label, button, placeholder, danger = false }, onSubmit, onCancel = null) {
  reasonRequest = { onSubmit, onCancel };
  document.getElementById('reasonTitle').textContent = title;
  document.getElementById('reasonText').textContent = text;
  document.getElementById('reasonLabel').textContent = label;
  const submit = document.getElementById('reasonSubmit');
  submit.className = `btn ${danger ? 'btn-warn' : 'btn-primary'}`;
  submit.innerHTML = `<i class="fa-solid ${danger ? 'fa-trash' : 'fa-rotate-left'}" aria-hidden="true"></i> ${esc(button)}`;
  const input = document.getElementById('reasonInput');
  input.value = '';
  input.placeholder = placeholder;
  document.getElementById('reasonModal').classList.remove('hidden');
  input.focus();
}

// Sending a task back from review (or reopening it) needs a reason, which the agent will read
function openReasonModal(task, from, to) {
  askReason({
    title: from === 'completed' ? `Reopen to ${STATUS_LABEL[to]}` : `Send back to ${STATUS_LABEL[to]}`,
    text: `"${task.title}" moves from ${STATUS_LABEL[from]} back to ${STATUS_LABEL[to]}.`,
    label: 'Why? It is saved on the card, and the agent or person working on it reads it.',
    button: from === 'completed' ? 'Reopen' : 'Send back',
    placeholder: 'e.g. The button is still misaligned on mobile.'
  }, (reason) => updateTaskStatus(task.id, to, reason), () => refreshDetail(task.id));
}

function closeReasonModal() {
  document.getElementById('reasonModal').classList.add('hidden');
  const request = reasonRequest;
  reasonRequest = null;
  request?.onCancel?.();
}

async function submitReason() {
  const reason = document.getElementById('reasonInput').value.trim();
  if (!reason || !reasonRequest) return;
  const request = reasonRequest;
  reasonRequest = null;
  document.getElementById('reasonModal').classList.add('hidden');
  await request.onSubmit(reason);
}

/* ==========================================
   EVIDENCE: attach files from the detail view
   ========================================== */
const MAX_UPLOAD = 10 * 1024 * 1024;
const fileBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

function uploadFromInput(taskId, input, kind) {
  const files = [...input.files];
  input.value = '';
  return uploadAttachments(taskId, files, kind);
}

// kind: 'reference' (material to work from) or 'evidence' (proof of the work, only while In progress)
async function uploadAttachments(taskId, files, kind) {
  for (const file of files) {
    if (file.size > MAX_UPLOAD) { showToast(`${file.name} is larger than 10 MB.`); continue; }
    try {
      const res = await fetch(`${API}/tasks/${encodeURIComponent(taskId)}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content_base64: await fileBase64(file), kind, actor: 'USER' })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `error ${res.status}`);
    } catch (err) {
      showToast(`Couldn't attach ${file.name}: ${err.message === 'Failed to fetch' ? 'the API is offline' : err.message}`);
    }
  }
  await fetchTasks();
  fetchAuditLogs();
  refreshDetail(taskId);
}

const attachmentUrl = (a) => `${API.replace(/\/api$/, '')}${a.url}`;

function evidenceThumb(a) {
  const url = attachmentUrl(a);
  const image = /^image\/(png|jpeg|gif|webp)$/.test(a.content_type || '');
  const by = isAgentActor(a.uploaded_by) ? agentName(a.uploaded_by) : 'Human';
  return `<a class="evidence-item" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(a.note || a.filename)}">
      ${image ? `<img src="${esc(url)}" alt="${esc(a.note || a.filename)}" loading="lazy">` : `<span class="evidence-file"><i class="fa-solid fa-file-lines" aria-hidden="true"></i></span>`}
      <span class="evidence-name">${esc(a.filename)}</span>
      <span class="evidence-by">${esc(by)}</span>
    </a>`;
}

function evidenceChip(t) {
  const kind = t.evidence_type || 'none';
  if (kind === 'none') return '';
  const missing = missingEvidence(t);
  const icon = kind === 'screenshot' ? 'fa-camera' : 'fa-paperclip';
  const label = missing ? (kind === 'screenshot' ? 'Screenshot needed' : 'Attachment needed') : `${evidenceOf(t).length} evidence`;
  return `<span class="chip ${missing ? 'tone-4' : 'tone-3'}" title="${esc(missing || 'Evidence attached')}"><i class="fa-solid ${icon}" aria-hidden="true"></i>&nbsp;${label}</span>`;
}

// An agent asked to delete this In Progress task; a person approves or keeps it
function deleteRequestBox(t) {
  const r = t.delete_request;
  if (!r) return '';
  const who = isAgentActor(r.by) ? agentName(r.by) : 'Someone';
  return `<div class="sent-back delete-request">
      <span><i class="fa-solid fa-trash" aria-hidden="true"></i> <b>${esc(who)} asks to delete it:</b> ${esc(r.reason)}</span>
      <span class="row">
        <button class="btn btn-sm btn-warn" onclick="approveDeleteRequest('${esc(t.id)}')">Approve delete</button>
        <button class="btn btn-sm" onclick="rejectDeleteRequest('${esc(t.id)}')">Keep it</button>
      </span>
    </div>`;
}

function approveDeleteRequest(taskId) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task?.delete_request) return;
  const r = task.delete_request;
  return removeTask(task, `Approved deletion requested by ${isAgentActor(r.by) ? agentName(r.by) : r.by}: ${r.reason}`);
}

function rejectDeleteRequest(taskId) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task?.delete_request) return;
  const r = task.delete_request;
  askReason({
    title: 'Keep this task?',
    text: `${isAgentActor(r.by) ? agentName(r.by) : 'Someone'} asked to delete "${task.title}": ${r.reason}`,
    label: "Why keep it? The agent reads this in the task's comments.",
    button: 'Keep task',
    placeholder: 'e.g. Still needed for the demo.'
  }, async (why) => {
    await write('DELETE', `/tasks/${encodeURIComponent(taskId)}/delete-request?actor=USER&reason=${encodeURIComponent(why)}`);
    await fetchTasks();
    refreshDetail(taskId);
  });
}

// How each kind of comment is labelled
function commentLabel(c) {
  return {
    sent_back: `Sent back to ${c.to || ''}`,
    delete_request: 'Asked to delete',
    delete_rejected: 'Kept (deletion rejected)'
  }[c.kind] || 'Note';
}

function referenceChip(t) {
  const n = referencesOf(t).length;
  return n ? `<span class="chip tone-2" title="Reference files to work from"><i class="fa-solid fa-image" aria-hidden="true"></i>&nbsp;${n} reference${n > 1 ? 's' : ''}</span>` : '';
}

// The latest comment, when it is the reason the task was sent back and the task is still where it was sent
function sentBackComment(t, statusKey) {
  const last = (t.comments || []).at(-1);
  return last?.kind === 'sent_back' && normalizeStatus(last.to) === statusKey ? last : null;
}

/* ==========================================
   DELETED TAB: deleted tasks with everything they had
   ========================================== */
async function fetchDeleted() {
  try {
    const res = await fetch(`${API}/tasks/deleted`);
    if (!res.ok) throw new Error();
    state.deleted = await res.json();
  } catch (err) {
    return; // offline: keep what we had
  }
  renderDeleted();
}

async function restoreDeleted(taskId, btn) {
  btn.disabled = true;
  if (await write('POST', `/tasks/${encodeURIComponent(taskId)}/restore?actor=USER`)) {
    await fetchTasks();
    await fetchDeleted();
    showToast('Task restored to the board.');
  } else {
    btn.disabled = false;
  }
}

// Gone for good, with its files: the one action here that can't be undone, so it asks first
async function purgeDeleted(taskId, btn) {
  const task = state.deleted.find(t => String(t.id) === String(taskId));
  if (!confirm(`Delete "${task?.title || 'this task'}" forever? Its files are removed too. This can't be undone.`)) return;
  btn.disabled = true;
  if (await write('DELETE', `/tasks/deleted/${encodeURIComponent(taskId)}?actor=USER`)) await fetchDeleted();
  else btn.disabled = false;
}

function renderDeleted() {
  const list = document.getElementById('deleted-list');
  const tasks = state.deleted || [];
  document.getElementById('n-deleted').textContent = tasks.length;
  if (!list) return;
  if (!tasks.length) {
    list.innerHTML = `<div class="empty"><h3>Nothing deleted</h3><p>Deleted tasks show up here with everything they had, ready to restore.</p></div>`;
    return;
  }
  const when = (ts) => ts ? formatDate(ts) : 'Not yet';
  const who = (actor) => isAgentActor(actor) ? agentName(actor) : 'Human';
  list.innerHTML = tasks.map(t => {
    const statusKey = normalizeStatus(t.status);
    const subtasks = parseSubtasks(t.subtasks);
    const refs = referencesOf(t), proof = evidenceOf(t);
    const evidenceNeed = { screenshot: 'A screenshot', attachment: 'An attachment', none: 'None' }[t.evidence_type || 'none'];
    return `
      <article class="card deleted-card ${STATUS_TONE[statusKey]}">
        <div class="task-top"><h3>${esc(t.title || 'Untitled')}</h3>${priorityChip(t.priority)}</div>
        <div class="row">${statusPill(statusKey)}<span class="chip tone-5"><i class="fa-solid fa-trash" aria-hidden="true"></i>&nbsp;Deleted by ${esc(who(t.deleted_by))} · ${esc(when(t.deleted_at))}</span></div>
        ${t.delete_reason ? `<p class="sent-back"><b>Why:</b> ${esc(t.delete_reason)}</p>` : ''}
        ${t.description ? `<p class="deleted-desc">${esc(t.description)}</p>` : ''}
        <dl class="meta">
          <div><dt>Created by</dt><dd>${esc(creatorLabel(t.creator))}</dd></div>
          <div><dt>Created</dt><dd class="mono">${esc(when(t.created_at))}</dd></div>
          <div><dt>Started</dt><dd class="mono">${esc(when(t.started_at))}</dd></div>
          <div><dt>Finished</dt><dd class="mono">${esc(when(t.completed_at))}</dd></div>
          <div><dt>Time spent</dt><dd class="mono">${t.duration_ms >= 1000 ? formatDuration(t.duration_ms) : 'Not tracked'}</dd></div>
          <div><dt>Due</dt><dd class="mono">${esc(t.due_date || 'None')}</dd></div>
          <div><dt>Evidence needed</dt><dd>${esc(evidenceNeed)}${t.evidence_note ? `: ${esc(t.evidence_note)}` : ''}</dd></div>
          <div><dt>Subtasks</dt><dd>${subtasks.filter(s => s.done).length} of ${subtasks.length} done</dd></div>
        </dl>
        ${refs.length ? `<p class="field-title">Reference files</p><div class="evidence-grid">${refs.map(evidenceThumb).join('')}</div>` : ''}
        ${proof.length ? `<p class="field-title">Evidence</p><div class="evidence-grid">${proof.map(evidenceThumb).join('')}</div>` : ''}
        ${(t.comments || []).length ? `<details><summary>${t.comments.length} comment${t.comments.length > 1 ? 's' : ''}</summary><ul class="comments">${t.comments.slice().reverse().map(c => `
          <li class="${c.kind === 'sent_back' ? 'sent-back' : 'note-box'}"><span><b>${esc(commentLabel(c))}</b> · ${esc(who(c.author))} · <time>${logTime(c.at)}</time></span><span>${esc(c.text)}</span></li>`).join('')}</ul></details>` : ''}
        ${subtasks.length ? `<details><summary>${subtasks.length} subtask${subtasks.length > 1 ? 's' : ''}</summary><ul class="comments">${subtasks.map(s => `<li>${s.done ? '✓' : '○'} ${esc(s.content)}</li>`).join('')}</ul></details>` : ''}
        <div class="row deleted-foot">
          <span class="row">
            <button class="btn btn-sm btn-primary" onclick="restoreDeleted('${esc(t.id)}', this)"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Restore</button>
            <button class="btn btn-sm btn-warn" onclick="purgeDeleted('${esc(t.id)}', this)"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete forever</button>
          </span>
          <span class="badge-key">#${esc(t.id)}</span>
        </div>
      </article>`;
  }).join('');
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

  const kind = task.evidence_type || 'none';
  const missing = missingEvidence(task);
  const files = evidenceOf(task);
  const refs = referencesOf(task);
  const referencesHtml = `
    <section class="stack-sm">
      <h4>Reference files</h4>
      <p class="soft">Material to work from: mockups, screenshots of the bug, examples. Look at these before starting.</p>
      ${refs.length ? `<div class="evidence-grid">${refs.map(evidenceThumb).join('')}</div>` : '<p class="soft">No reference files.</p>'}
      <div class="row">
        <button class="btn btn-sm" onclick="this.nextElementSibling.click()"><i class="fa-solid fa-image" aria-hidden="true"></i> Add reference</button>
        <input type="file" multiple hidden aria-label="Add reference files" onchange="uploadFromInput('${esc(task.id)}', this, 'reference')">
        <span class="hint soft">Any time, up to 10 MB each.</span>
      </div>
    </section>`;
  const evidenceUpload = normStatus === 'in_progress'
    ? `<div class="row">
        <button class="btn btn-sm" onclick="this.nextElementSibling.click()"><i class="fa-solid fa-camera" aria-hidden="true"></i> Attach evidence</button>
        <input type="file" multiple hidden aria-label="Attach evidence" onchange="uploadFromInput('${esc(task.id)}', this, 'evidence')">
        <span class="hint soft">Proof of the finished work, up to 10 MB each.</span>
      </div>`
    : `<p class="hint soft">${normStatus === 'pending'
        ? 'Evidence is attached once the task is In progress: it is proof of the finished work.'
        : 'Evidence can be added while the task is In progress.'}</p>`;
  const evidenceHtml = `
    <section class="stack-sm">
      <h4>Evidence</h4>
      <p class="row soft">${kind === 'none' ? 'No evidence needed for this task.'
        : `Needs ${kind === 'screenshot' ? 'a screenshot' : 'an attachment'}${task.evidence_note ? `: ${esc(task.evidence_note)}` : ''}.`}
        ${kind === 'none' ? '' : missing ? '<span class="chip tone-4">Missing</span>' : '<span class="chip tone-3">Attached</span>'}</p>
      ${files.length ? `<div class="evidence-grid">${files.map(evidenceThumb).join('')}</div>` : ''}
      ${evidenceUpload}
    </section>`;
  const comments = task.comments || [];
  const commentsHtml = !comments.length ? '' : `
    <section class="stack-sm">
      <h4>Comments</h4>
      <ul class="comments">${comments.slice().reverse().map(c => `
        <li class="${c.kind === 'sent_back' ? 'sent-back' : 'note-box'}">
          <span><b>${esc(commentLabel(c))}</b> · ${esc(isAgentActor(c.author) ? agentName(c.author) : 'Human')} · <time>${logTime(c.at)}</time></span>
          <span>${esc(c.text)}</span>
        </li>`).join('')}</ul>
    </section>`;

  detailBody.innerHTML = `
    <div class="row"><h3 style="font-size:22px; overflow-wrap:anywhere">${esc(task.title)}</h3><span class="badge-key">#${esc(task.id)}</span>${priorityChip(task.priority)}</div>
    ${deleteRequestBox(task)}
    <div class="note-box">${esc(task.description || 'No description provided.')}</div>
    <dl class="meta">
      <div><dt><label for="detailStatus">Status</label></dt><dd>
        <select id="detailStatus" class="input input-sm" onchange="requestMove('${esc(task.id)}', this.value)">
          ${['pending', 'in_progress', 'needs_review', 'completed'].map(k => `<option value="${k}" ${k === normStatus ? 'selected' : ''} ${k !== normStatus && !ALLOWED_MOVES[normStatus].includes(k) ? 'disabled' : ''}>${STATUS_LABEL[k]}</option>`).join('')}
        </select></dd></div>
      <div><dt>Creator</dt><dd>${esc(creatorLabel(task.creator))}</dd></div>
      <div><dt>Due date</dt><dd class="mono">${esc(task.due_date || 'None')}${isOverdue(task) ? ' <span class="chip tone-5">Overdue</span>' : ''}</dd></div>
      <div><dt>Time spent</dt><dd class="mono">${elapsedTime}</dd></div>
      <div><dt>Created</dt><dd class="mono">${formatDate(task.created_at)}</dd></div>
      <div><dt>Subtasks</dt><dd><span class="chip">${completedCount} of ${subtasks.length} done</span></dd></div>
    </dl>
    ${referencesHtml}
    ${evidenceHtml}
    ${commentsHtml}
    <section class="stack-sm"><h4>Subtasks</h4>${subtasksHtml}</section>
    <section class="stack-sm"><h4>History</h4><ol id="taskHistory" class="timeline"></ol></section>
    <div class="modal-foot">
      <button class="btn btn-sm btn-warn" onclick="deleteTask('${esc(task.id)}')"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete</button>
      <button class="btn btn-sm btn-primary" onclick="closeDetailModal(); openTaskModal('${esc(task.id)}')"><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit</button>
    </div>
  `;

  state.detailTaskId = task.id;
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
  if (state.activeTab === 'deleted') fetchDeleted();
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
// "opencode (AI agent)", "Unnamed AI agent" (older entries) or "Human"
const creatorLabel = (actor) => !isAgentActor(actor) ? 'Human' : agentName(actor) === 'AI agent' ? 'Unnamed AI agent' : `${agentName(actor)} (AI agent)`;

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
    ${(() => { const c = sentBackComment(t, statusKey); return c ? `<p class="sent-back"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> <b>Sent back:</b> ${esc(c.text)}</p>` : ''; })()}
    ${deleteRequestBox(t)}
    <div class="task-foot">
      <span class="chip ${isAI ? 'tone-6' : ''}"><i class="fa-solid ${isAI ? 'fa-robot' : 'fa-user'}" aria-hidden="true"></i>&nbsp;${isAI ? esc(agentName(t.creator)) : 'Human'}</span>
      ${timeBadge(t, statusKey)}
      ${referenceChip(t)}
      ${evidenceChip(t)}
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
  // Fuzzy: typos and abbreviations still match (see searchScore)
  const scored = state.tasks.map(t => ({ t, score: searchScore(query, t) })).filter(x => x.score > 0);
  const filtered = scored.map(x => x.t);

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
  renderTableView(scored, query);
}

/* ==========================================
   SEARCH (fuzzy) AND THE TASK MANAGER TABLE
   ========================================== */
const plain = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

// Letters of `q` appear in `w` in order, starting with the same letter: "dshbrd" -> "dashboard"
function inOrder(q, w) {
  if (q[0] !== w[0]) return false;
  let i = 0;
  for (const ch of w) if (ch === q[i] && ++i === q.length) return true;
  return false;
}

// At most one typo (insert, delete, swap or change a letter): "dashbaord" -> "dashboard"
function oneTypo(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return a === b;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    const swapped = a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
    return swapped || a.slice(i + 1) === b.slice(i + 1);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// 0 = no match. Every word of the query must match the title, description or creator:
// as text (best), as letters in order, or with one typo. Higher scores are better matches.
function searchScore(query, t) {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const title = plain(t.title);
  const text = `${title} ${plain(t.description)} ${plain(isAgentActor(t.creator) ? agentName(t.creator) : 'human')}`;
  const textWords = text.split(/[^a-z0-9]+/).filter(Boolean);
  let score = 0;
  for (const q of words) {
    if (title.includes(q)) score += 4;
    else if (text.includes(q)) score += 3;
    else if (q.length >= 3 && textWords.some(w => inOrder(q, w))) score += 2;
    else if (q.length >= 4 && textWords.some(w => oneTypo(q, w) || oneTypo(q, w.slice(0, q.length)))) score += 1;
    else return 0;
  }
  return score;
}

const creatorKey = (t) => isAgentActor(t.creator) ? `agent:${agentName(t.creator)}` : 'human';

function renderTableView(scored, query) {
  const tbody = document.getElementById('task-table-body');
  if (!tbody) return;

  // Creator filter: All, Human, then every agent that has created a task
  const picker = document.getElementById('creator-filter');
  const agents = [...new Set(state.tasks.filter(t => isAgentActor(t.creator)).map(t => agentName(t.creator)))].sort();
  if (state.creatorFilter !== 'all' && state.creatorFilter !== 'human' && !agents.includes(state.creatorFilter.slice(6))) state.creatorFilter = 'all';
  picker.innerHTML = [['all', 'All creators'], ['human', 'Human'], ...agents.map(a => [`agent:${a}`, creatorLabel(`AI:${a}`)])]
    .map(([value, label]) => `<option value="${esc(value)}" ${value === state.creatorFilter ? 'selected' : ''}>${esc(label)}</option>`).join('');

  const rows = scored
    .filter(({ t }) => state.creatorFilter === 'all' || creatorKey(t) === state.creatorFilter)
    .sort((a, b) => query ? b.score - a.score : 0) // best matches first while searching
    .map(({ t }) => t);
  document.getElementById('manager-count').textContent = `${rows.length} of ${state.tasks.length} tasks`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5"><p class="soft">${query || state.creatorFilter !== 'all' ? 'No tasks match. Try fewer words or another creator.' : 'No tasks yet.'}</p></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(t => {
    const totalTime = t.duration_ms ? formatDuration(t.duration_ms) : (t.started_at ? 'In progress' : 'Not started');
    const isAI = isAgentActor(t.creator);
    return `
      <tr onclick="openDetailModal('${esc(t.id)}')">
        <td><b>${esc(t.title || 'Untitled')}</b></td>
        <td>${statusPill(normalizeStatus(t.status))}</td>
        <td><span class="chip ${isAI ? 'tone-6' : ''}"><i class="fa-solid ${isAI ? 'fa-robot' : 'fa-user'}" aria-hidden="true"></i>&nbsp;${esc(isAI ? agentName(t.creator) : 'Human')}</span></td>
        <td class="mono">${totalTime}</td>
        <td class="actions" onclick="event.stopPropagation()">
          <button class="btn btn-round btn-sm" onclick="openTaskModal('${esc(t.id)}')" aria-label="Edit task"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
          <button class="btn btn-round btn-sm btn-warn" onclick="deleteTask('${esc(t.id)}')" aria-label="Delete task"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}

// Self-check for the matcher; runs once, logs only on failure
(() => {
  const t = { title: 'Fix the dashboard chart', description: 'Labels overlap', creator: 'AI:opencode' };
  const cases = [['dashboard', true], ['dshbrd', true], ['dashbaord', true], ['dasboard', true], ['chart labels', true],
    ['opencode', true], ['opnecode', true], ['zebra', false], ['dashboard zebra', false], ['xyz', false]];
  const bad = cases.filter(([q, want]) => (searchScore(q, t) > 0) !== want);
  if (bad.length) console.error('searchScore self-check failed:', bad);
})();


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
    if (task && normalizeStatus(task.status) !== col.dataset.status) requestMove(id, col.dataset.status);
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
    if (col && task && normalizeStatus(task.status) !== col.dataset.status) requestMove(id, col.dataset.status);
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
      evidence: { required: t.evidence_type || 'none', details: t.evidence_note || '', attached: evidenceOf(t).map(a => a.filename), missing: Boolean(missingEvidence(t)) },
      references: referencesOf(t).map(a => ({ file: a.filename, note: a.note || '' })),
      comments: (t.comments || []).map(c => ({ kind: c.kind, text: c.text, by: isAgentActor(c.author) ? agentName(c.author) : 'person', when: localIso(new Date(c.at)) })),
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
      still_in_progress: titles(t => t.status_now === 'In progress'),
      deletion_requested: state.tasks.filter(t => t.delete_request).map(t => `${t.title} (${t.delete_request.reason})`)
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
    evidence: 'Proof the task needs before review ("screenshot", "attachment" or "none"), the files attached, and whether it is still missing.',
    comments: 'Notes on the task. kind "sent_back" is a reviewer explaining why the task went back; "delete_request" is an agent asking to delete it; "delete_rejected" is a person keeping it.',
    references: 'Files given to work from (mockups, screenshots of the bug). Not proof of work.',
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
    const data = await res.json();
    state.agents = data.agents || [];
    state.tools = data.tools || [];
    state.mcpOnline = true;
  } catch (err) {
    state.agents = [];
    state.mcpOnline = false;
  }
  renderAgents();
  renderTools();
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

// The MCP tools, as the server describes them (so the list never drifts from the code)
function renderTools() {
  const list = document.getElementById('tool-list');
  document.getElementById('n-tools').textContent = state.mcpOnline ? state.tools.length : 0;
  if (!state.mcpOnline) {
    list.dataset.sig = '';
    list.innerHTML = `<div class="empty"><p>Start the MCP server (<code>task mcp</code>) to see its tools.</p></div>`;
    return;
  }
  const sig = JSON.stringify(state.tools);
  if (list.dataset.sig === sig) return; // unchanged: keep any open "More" sections open
  list.dataset.sig = sig;
  const optional = (p) => p.default !== null && p.default !== undefined && p.default !== '' ? `optional, default ${JSON.stringify(p.default)}` : 'optional';
  list.innerHTML = state.tools.map(t => {
    const [summary, ...more] = (t.description || '').split(/\n\s*\n/);
    return `<article class="tool">
      <div class="row"><span class="badge-key">${esc(t.name)}</span>${t.params.map(p =>
        `<span class="chip ${p.required ? 'tone-1' : ''}" title="${esc(p.required ? 'required' : optional(p))}">${esc(p.name)}${p.required ? '' : '?'}</span>`).join('')}</div>
      <p>${esc(summary)}</p>
      ${more.length ? `<details><summary>More</summary><pre class="tool-doc">${esc(more.join('\n\n'))}</pre></details>` : ''}
    </article>`;
  }).join('');
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
    for (const [id, close] of [['reasonModal', closeReasonModal], ['taskModal', closeTaskModal], ['detailModal', closeDetailModal]]) {
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

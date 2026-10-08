// State Management
window.state = window.state || {
  tasks: [],
  logs: [],
  activeTab: 'board',
  editingTaskId: null,
  isServerOnline: false,
  activeWeek: 1,
  viewMode: 'status'
};

if (typeof liveTimerInterval === 'undefined') { var liveTimerInterval = null; }

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

  const saveBtn = document.getElementById('save-task-btn') || document.querySelector('.btn-primary');
  if (saveBtn) saveBtn.addEventListener('click', (e) => { e.preventDefault(); saveTask(e); });

  fetchTasks();
  fetchAuditLogs();
  setupColumnSelection();
  setViewMode('status');

  liveTimerInterval = setInterval(() => {
    if (state.activeTab === 'board' && state.tasks.some(t => normalizeStatus(t.status) === 'in_progress')) {
      updateLiveTimers();
    }
  }, 1000);
});

/* ==========================================
   NAVIGATION & TAB SWITCHING
   ========================================== */
let viewMode = 'status'; // 'status' or 'daily'

function setViewMode(mode) {
  if (window.state) window.state.viewMode = mode;
  viewMode = mode;
  const statusBtn = document.getElementById('statusViewBtn');
  const dailyBtn = document.getElementById('dailyViewBtn');
  const statusBoard = document.getElementById('statusBoard') || document.getElementById('kanban-grid');
  const dailyBoard = document.getElementById('dailyBoard') || document.getElementById('daily-view-grid');
  if (mode === 'daily') {
    if (statusBoard) statusBoard.style.display = 'none';
    if (dailyBoard) { dailyBoard.style.display = 'grid'; dailyBoard.classList.remove('hidden'); }
    if (statusBtn) statusBtn.classList.remove('active');
    if (dailyBtn) dailyBtn.classList.add('active');
    renderDailyColumns();
  } else {
    if (statusBoard) { statusBoard.style.display = 'grid'; statusBoard.classList.remove('hidden'); }
    if (dailyBoard) { dailyBoard.style.display = 'none'; dailyBoard.classList.add('hidden'); }
    if (statusBtn) statusBtn.classList.add('active');
    if (dailyBtn) dailyBtn.classList.remove('active');
  }
}

function renderDailyColumns() {
  if (viewMode !== 'daily') return;
  const dayColumns = [1,2,3,4,5];
  dayColumns.forEach(day => {
    const col = document.getElementById('col-day' + day);
    const countEl = document.getElementById('count-day' + day);
    if (!col || !countEl) return;
    const tasksForDay = state.tasks.filter(t => {
      // Exclude parent weekly goal summaries
      if (t.is_weekly_goal === true) return false;
      if (!t.title || !t.title.includes('Day ')) return false;
      if (t.parent_id === null || t.parent_id === undefined || t.parent_id === '') {
        // Check if title actually indicates a daily subtask; if no "Day X" present, skip
        const titleContainsDay = /Day\s+\d+/.test(t.title || '');
        if (!titleContainsDay) return false;
      }
      if (t.day_number === day) return true;
      const titleMatch = t.title && t.title.includes('Day ' + day);
      if (titleMatch) return true;
      const due = t.due_date ? new Date(t.due_date) : null;
      if (due) {
        return t.due_date === due ? true : false;
      }
      return false;
    });
    countEl.textContent = tasksForDay.length;
    const now = new Date();
    col.innerHTML = tasksForDay.map(t => {
      let timerHtml = '';
      if (t.status === 'IN_PROGRESS' && t.started_at) {
        const started = new Date(t.started_at);
        const diffMs = now - started;
        const mins = Math.floor(diffMs / 60000);
        const secs = Math.floor((diffMs % 60000) / 1000);
        timerHtml = `<div class="text-[10px] font-mono text-violet-400 mt-1">● Active: ${mins}m ${secs}s</div>`;
      }
      return `<div class="kanban-card p-2 mb-2 bg-[#181920] rounded border border-zinc-800/80 hover:border-zinc-600 transition shadow-sm cursor-pointer" draggable="true" data-task-id="${t.id}" onclick="openDetailModal('${t.id}')" ondragstart="handleDragStart(event, '${t.id}')">
        <h4 class="text-xs font-bold text-white mb-1 truncate">${t.title ? t.title.replace(/Week\s+\d+\s+-\s+Day\s+\d+:\s*/i, '').trim() : 'Untitled'}</h4>
        <span class="badge-priority badge-${t.priority || 'low'}">${t.priority || 'low'}</span>
        <div class="text-[10px] text-zinc-500 mt-1 font-mono">Week ${t.week_number || 1}</div>
        ${timerHtml}
      </div>`;
    }).join('');
  });
}

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
function addSubtaskItem() {
  const input = document.getElementById('editSubtaskInput');
  const list = document.getElementById('editSubtaskList');
  const text = input.value.trim();
  if (!text) return;
  const itemDiv = document.createElement('div');
  itemDiv.className = 'subtask-item flex items-center gap-2 text-xs font-mono text-zinc-300 bg-[#181920] px-2 py-1 rounded border border-zinc-800/80';
  itemDiv.innerHTML = '<span>' + text + '</span><button onclick="this.parentElement.remove()" class="text-zinc-500 hover:text-red-400 text-[10px] ml-auto">Remove</button>';
  list.appendChild(itemDiv);
  input.value = '';
}

function openTaskModal(taskId = null) {
  const modal = document.getElementById('taskModal');
  const title = document.getElementById('modalTitle');
  state.editingTaskId = taskId;

  if (taskId) {
  const now = new Date().toISOString();
  const timeStr = getShortTime(now);
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task) return;

    if (title) title.innerHTML = `<i class="fa-solid fa-pen-to-square text-red-500 text-sm"></i> Edit Task`;
    document.getElementById('taskTitleInput').value = task.title || '';
    document.getElementById('taskDescInput').value = task.description || '';
    document.getElementById('taskPriorityInput').value = task.priority || 'medium';
    document.getElementById('taskStatusInput').value = normalizeStatus(task.status);
    document.getElementById('taskDueDateInput').value = task.due_date || '';

    // Load existing subtasks into edit list
    const editSubtaskList = document.getElementById('editSubtaskList');
    if (editSubtaskList) editSubtaskList.innerHTML = '';
    const existingSubtasks = task.subtasks || task.subtask_items || [];
    existingSubtasks.forEach(sub => {
      const text = (typeof sub === 'string') ? sub : (sub.title || sub.content || sub.name || 'Unnamed');
      const itemDiv = document.createElement('div');
      itemDiv.className = 'subtask-item flex items-center gap-2 text-xs font-mono text-zinc-300 bg-[#181920] px-2 py-1 rounded border border-zinc-800/80';
      itemDiv.innerHTML = '<span>' + text + '</span><button onclick="this.parentElement.remove()" class="text-zinc-500 hover:text-red-400 text-[10px] ml-auto">Remove</button>';
      if (editSubtaskList) editSubtaskList.appendChild(itemDiv);
    });
  } else {
    if (title) title.innerHTML = `<i class="fa-solid fa-plus-circle text-red-500 text-sm"></i> Create New Task`;
    document.getElementById('taskTitleInput').value = '';
    document.getElementById('taskDescInput').value = '';
    document.getElementById('taskPriorityInput').value = 'medium';
    document.getElementById('taskStatusInput').value = 'pending';
    document.getElementById('taskDueDateInput').value = '';
    const subtaskList = document.getElementById('editSubtaskList');
    if (subtaskList) subtaskList.innerHTML = '';
    if (typeof currentSubtasks !== 'undefined') currentSubtasks = [];
  }

  if (modal) modal.classList.remove('hidden');
}

function closeTaskModal() {
  const modal = document.getElementById('taskModal');
  if (modal) modal.classList.add('hidden');
  state.editingTaskId = null;

  // Clear subtask container and internal tracking
  const subtaskList = document.getElementById('editSubtaskList');
  if (subtaskList) subtaskList.innerHTML = '';
  if (typeof currentSubtasks !== 'undefined') currentSubtasks = [];
}

async function saveTask(event) {
  console.log("=== saveTask triggered ===");
  if (event) event.preventDefault();
  const title = document.getElementById('taskTitleInput')?.value.trim();
  const description = document.getElementById('taskDescInput')?.value.trim();
  const priority = document.getElementById('taskPriorityInput')?.value || 'medium';
  const rawStatus = document.getElementById('taskStatusInput')?.value || '';
  let status = toTitleStatus(normalizeStatus(rawStatus || 'pending'));
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

  // Status fallback: if empty/invalid, preserve existing status
  const rawStatusVal = document.getElementById('taskStatusInput')?.value || '';
  let normalizedStatus = normalizeStatus(rawStatusVal);
  if (!normalizedStatus || normalizedStatus === 'pending' && rawStatusVal === '') {
    if (task && task.status) {
      status = task.status;
    } else if (rawStatusVal === '') {
      status = 'Pending';
    }
  }

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

  // Extract subtask items from edit list by selecting direct child divs
  const subtaskContainer = document.getElementById('editSubtaskList');
  const subtaskItems = subtaskContainer
    ? Array.from(subtaskContainer.children).map(div => {
        const span = div.querySelector('span');
        return (span ? span.textContent.trim() : (div.innerText ? div.innerText.replace('Remove', '').trim() : '')).trim();
      }).filter(Boolean)
    : [];

  // Attach subtasks directly to task before local/server save (as simple strings)
  if (task) {
    task.subtasks = subtaskItems;
  }

  saveToLocalStorage();
  renderDashboard();
  closeTaskModal();

  if (state.isServerOnline) {
    const payload = {
      id: String(task.id),
      title: task.title,
      description: task.description || '',
      status: String(task.status || 'PENDING').toUpperCase(),
      priority: String(task.priority || 'MEDIUM').toUpperCase(),
      due_date: task.due_date || null,
      week_number: parseInt(document.getElementById('taskWeekNumberInput')?.value || '1') || 1,
      creator: task.creator || 'human',
      actor: 'USER',
      created_at: task.created_at || now,
      started_at: task.started_at || null,
      completed_at: task.completed_at || null,
      duration_ms: task.duration_ms || null,
      subtasks: subtaskItems.map(text => ({ title: text, completed: false }))
    };

    try {
      console.log("Saving payload:", payload);
      const res = await fetch('http://127.0.0.1:8000/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json();
        console.error("FastAPI Validation Details:", errData);
      } else {
        fetchAuditLogs();
      }
    } catch (err) {
      console.error('Backend save failed, stored locally.', err);
    }
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
      subtasks: parseSubtasks(task.subtasks)
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
   DETAIL MODAL (WITH SUBTASKS INCLUDED)
   ========================================== */
/* ==========================================
   DEDICATED HISTORY MODAL CONTROLS
   ========================================== */
function openHistoryModal(taskId) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  const historyBody = document.getElementById('historyModalBody');
  if (!historyBody) return;

  const taskLogs = (state.logs || []).filter(log => log.details && String(log.details.id) === String(taskId));

  if (taskLogs.length === 0) {
    historyBody.innerHTML = `
      <div class="text-[11px] font-mono text-zinc-500 italic p-4 bg-[#121318] rounded border border-zinc-800/80 text-center">
        No history recorded for this task yet.
      </div>`;
  } else {
    historyBody.innerHTML = taskLogs.map(log => {
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

  const modal = document.getElementById('historyModal');
  if (modal) modal.classList.remove('hidden');
}

function closeHistoryModal() {
  const modal = document.getElementById('historyModal');
  if (modal) modal.classList.add('hidden');
}

/* ==========================================
   UPDATED DETAIL MODAL (CLEAN & SUBTASK FOCUS)
   ========================================== */
function openDetailModal(taskId) {
  if (!taskId || typeof taskId !== 'string') {
    console.warn('Invalid taskId passed to openDetailModal:', taskId);
    return;
  }
  const encodedId = encodeURIComponent(taskId);
  fetch('http://localhost:8000/api/tasks/' + encodedId)
    .then(r => {
      if (!r.ok) throw new Error('Task not found: ' + r.status);
      const contentType = r.headers.get('content-type');
      return (contentType && contentType.includes('application/json')) ? r.json() : r.text();
    })
    .then(data => {
      let task = data;
      if (Array.isArray(data)) {
        task = data.find(t => String(t.id) === String(taskId)) || data[0];
      } else if (data && data.task) {
        task = data.task;
      }
      console.log('Fetched task detail:', task);
      if (!task || !task.id) {
        document.getElementById('detailModalBody').innerHTML = '<div class="text-xs text-red-500 font-mono p-3">Failed to load task details.</div>';
        document.getElementById('detailModal').classList.remove('hidden');
        return;
      }
      renderTaskDetails(task);
    })
    .catch(err => {
      console.error('Task fetch error:', err);
      document.getElementById('detailModalBody').innerHTML = '<div class="text-xs text-red-500 font-mono p-3">Failed to load task details.</div>';
    });
}
function renderTaskDetails(task, rawSubtasks) {
  console.log("Task details payload:", task);
  if (!task || !task.id) {
    console.warn('renderTaskDetails called without valid task');
    return;
  }
  const detailBody = document.getElementById('detailModalBody');
  if (!detailBody) return;

  const normStatus = normalizeStatus(task.status);
  const totalMinutesLog = (task.daily_progress || []).reduce((sum, log) => sum + (parseInt(log.minutes_worked || 0)), 0);
  let elapsedTime = 'Not Started';

  if (totalMinutesLog > 0) {
    const hrs = Math.floor(totalMinutesLog / 60);
    const mins = totalMinutesLog % 60;
    elapsedTime = hrs + "h " + mins + "m";
  } else if (normStatus === 'in_progress' && task.started_at) {
    const elapsed = getElapsed(task.started_at);
    elapsedTime = elapsed + " (Active)";
  } else if (normStatus === 'completed' && task.completed_at) {
    elapsedTime = formatDuration(task.duration_ms) || 'N/A';
  } else if (normStatus === 'in_progress' && task.created_at) {
    const el = getElapsed(task.created_at);
    elapsedTime = el + " (Active since create)";
  }

  detailBody.innerHTML = `
    <div class="space-y-4 my-3 text-xs">
      <div id="detail-subtasks-list" class="subtasks-section mt-4"></div>
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
        <div><span class="text-zinc-500 uppercase text-[10px] block">Completed Date</span> <span class="text-zinc-200">${task.completed_date || 'N/A'}</span></div>
        <div><span class="text-zinc-500 uppercase text-[10px] block">Week #</span> <span class="text-zinc-200">${task.week_number || 1}</span></div>
        <div><span class="text-zinc-500 uppercase text-[10px] block">Day #</span> <span class="text-zinc-200">${task.day_number || 1}</span></div>
        <div><span class="text-zinc-500 uppercase text-[10px] block">Time Elapsed</span> <span class="text-zinc-200">${elapsedTime}</span></div>
        <div class="col-span-2">
          <span class="text-zinc-500 uppercase text-[10px] block">Created At</span> 
          <span class="text-zinc-200">${formatDate(task.created_at)}</span>
        </div>
      </div>

      <div class="pt-2 border-t border-zinc-800/80 mt-2">
        <h4 class="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Log Daily Progress</h4>
        <div class="flex gap-2 mb-2">
          <input type="number" id="progressMinutesInput" placeholder="Minutes worked" class="modal-input text-[11px] flex-1">
          <input type="text" id="progressNotesInput" placeholder="Notes / progress..." class="modal-input text-[11px] flex-[2]">
        </div>
        <button onclick="logDailyProgress('${task.id}')" class="btn-primary text-xs w-full">Log Daily Progress</button>
      </div>

      <div class="flex justify-end pt-3 gap-2 border-t border-zinc-800/80">
        <button onclick="openHistoryModal('${task.id}')" class="px-3 py-1.5 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs transition border border-zinc-700/50 flex items-center gap-1.5 font-mono">
          <i class="fa-solid fa-clock-rotate-left text-zinc-400"></i> History
        </button>
        <button onclick="closeDetailModal(); openTaskModal('${task.id}')" class="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-white text-xs transition flex items-center gap-1.5 font-mono">
          <i class="fa-solid fa-pen-to-square"></i> Edit
        </button>
      </div>
    </div>
  `;

  // Render daily progress logs instead of subtasks
  const progressContainer = document.getElementById('detail-subtasks-list');
  if (progressContainer) {
        fetch('http://localhost:8000/api/progress/' + encodeURIComponent(String(task.id || "")))
        .then(r => r.json())
      .catch(() => ({ progress: [] }))
      .then(data => {
        const logs = (data && data.progress) ? data.progress : [];
        if (logs.length > 0) {
          progressContainer.innerHTML = logs.map(entry => {
            const dateStr = entry.date || entry.timestamp || 'N/A';
            const minutes = entry.minutes_worked || 0;
            const note = entry.progress_notes || entry.notes || '';
            return `<div class="p-2 mb-1 bg-[#121318] rounded border border-zinc-800/80 text-zinc-300 text-xs font-mono"><span class="text-zinc-400">${dateStr}</span> — <span class="text-emerald-400">${minutes} min</span> — ${note}</div>`;
          }).join('');
        } else {
          progressContainer.innerHTML = `<div class="text-[11px] font-mono text-zinc-500 italic p-3 bg-[#121318] rounded border border-zinc-800/80 text-center">No daily progress logged yet.</div>`;
        }
      });
  }

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
    } else if (statusKey === 'needs_review' && t.started_at) {
      const timeText = t.duration_ms ? formatDuration(t.duration_ms) : getElapsed(t.started_at);
      timeBadgeHtml = `<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1 w-fit"><i class="fa-solid fa-pause text-[8px]"></i> Review: ${timeText}</span>`;
    }

   const card = document.createElement('div');
// REMOVED 'overflow-hidden' so 3D depth and hover glow aren't clipped
card.className = "task-card space-y-2.5 p-3.5 group cursor-pointer relative"; 
card.setAttribute('draggable', 'true');


    card.onclick = (e) => {
      if (e.target.tagName === 'SELECT' || e.target.closest('button')) return;
      openDetailModal(t.id);
    };
    card.addEventListener('dragstart', (e) => handleDragStart(e, t.id));

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <h4 class="task-card-title text-sm font-semibold text-white truncate">${t.title || 'Untitled'}</h4>
        <span class="badge-priority ${priorityStyle}">${t.priority || 'medium'}</span>
      </div>
      <p class="text-xs text-zinc-400 line-clamp-2">${t.description || 'No description provided.'}</p>
      
      ${timeBadgeHtml}

      <div class="flex items-center justify-between pt-2 border-t border-zinc-800/40 text-[10px] text-zinc-500">
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

function handleDragStart(event, taskId) {
  console.log("DRAG START - target:", event.target, "currentTarget:", event.currentTarget, "taskId:", taskId);
  event.dataTransfer.setData('text/plain', taskId);
  event.target.style.opacity = '0.5';
}

function handleDragEnter(event) {
    event.preventDefault();
    event.currentTarget.classList.add('drag-over');
}

function handleDragOver(event) {
  console.log("DRAG OVER - preventDefault called", event.currentTarget);
  event.preventDefault();
  event.currentTarget.classList.add('drag-over');
}

function handleDragLeave(event) {
  event.currentTarget.classList.remove('drag-over');
}

function handleDrop(event, targetStatus) {
  console.log("DRAG DROP - targetStatus:", targetStatus, "data:", event.dataTransfer.getData('text/plain'));
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  const taskId = event.dataTransfer.getData('text/plain');
  if (!taskId) return;
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task) return;
  const normStatus = normalizeStatus(targetStatus);
  const oldNorm = normalizeStatus(task.status);
  const now = new Date().toISOString();
  const timeStr = getShortTime(now);
  let changes = [];
  if (oldNorm !== normStatus) {
    if (normStatus === 'in_progress') changes.push(`Task shifted to IN PROGRESS (AT: ${timeStr})`);
    else if (normStatus === 'needs_review') changes.push(`Task status updated to NEEDS REVIEW`);
    else if (normStatus === 'completed') changes.push(`Task marked as COMPLETED (AT: ${timeStr})`);
    else changes.push(`Task moved back to PENDING`);
  }
  const updateSummary = changes.join(' | ') || 'Status updated via drag-and-drop';
  task.status = targetStatus;
  if (normStatus === 'in_progress' && !task.started_at) task.started_at = now;
  if (normStatus === 'completed' && !task.completed_at) task.completed_at = now;
  addLocalAuditLog('UPDATE', task.title, 'USER', task.id, updateSummary);
  saveToLocalStorage();
  // Persist status change to server (POST /api/tasks handles updates)
  try {
    if (state.isServerOnline) {
        fetch('http://localhost:8000/api/tasks', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          id: task.id,
          title: task.title || "Untitled",
          description: task.description || "",
          status: normStatus,
          priority: task.priority || 'medium',
          week_number: task.week_number || 1,
          day_number: task.day_number || 1,
          due_date: task.due_date,
          creator: task.creator || 'human',
          actor: 'USER',
          updated_at: now
        })
      }).then(r => {
        if (!r.ok) console.warn('Status update POST returned ' + r.status);
        renderDashboard();
      }).catch(err => console.error('Drag-and-drop sync error:', err));
    } else {
      renderDashboard();
    }
  } catch (err) {
    console.error('Drag-and-drop sync error:', err);
  }
  renderDashboard();
  if (typeof fetchTasks === 'function') fetchTasks();  // refresh server state
  if (typeof window !== 'undefined' && document.getElementById('detailModal') && !document.getElementById('detailModal').classList.contains('hidden')) {
    openDetailModal(task.id);
  }
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

function resetDecomposeModal() {
  const weekInput = document.getElementById('weeklyWeekInput');
  const goalInput = document.getElementById('weeklyGoalInput');
  const startInput = document.getElementById('weeklyStartInput');
  const descInput = document.getElementById('weeklyGoalDescInput');
  if (weekInput) weekInput.value = '1';
  if (goalInput) goalInput.value = '';
  if (startInput) startInput.value = '';
  if (descInput) descInput.value = '';
}

function openWeeklyGoalModal() {
  document.getElementById('weeklyGoalModal').classList.remove('hidden');
  resetDecomposeModal();
}
function closeWeeklyGoalModal() {
  document.getElementById('weeklyGoalModal').classList.add('hidden');
}
function decomposeWeeklyGoal() {
  const week = document.getElementById('weeklyWeekInput').value;
  const goal = document.getElementById('weeklyGoalInput').value;
  const start = document.getElementById('weeklyStartInput').value;
  const desc = document.getElementById('weeklyGoalDescInput') ? document.getElementById('weeklyGoalDescInput').value : '';
  if (!goal || !start) {
    alert('Please enter goal title and start date.');
    return;
  }
  fetch('http://localhost:8000/api/weekly/decompose', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({week_number: parseInt(week), goal_title: goal, start_date: start, description: desc})
  }).then(r => r.json()).then(data => {
    if (data.message) {
      closeWeeklyGoalModal();
      resetDecomposeModal();
      if (typeof fetchTasks === 'function') fetchTasks();
    } else {
      const errMsg = data.detail ? JSON.stringify(data.detail) : (data.error ? JSON.stringify(data) : 'Unknown error');
      console.error('Weekly goal failed:', errMsg);
      document.getElementById('reportModalBody').innerHTML = '<div class="text-xs text-red-500 font-mono">Failed: ' + errMsg + '</div>';
      document.getElementById('reportModal').classList.remove('hidden');
    }
  }).catch(err => {
    console.error('Weekly goal error:', err);
    document.getElementById('reportModalBody').innerHTML = '<div class="text-xs text-red-500 font-mono">Network error: ' + err + '</div>';
    document.getElementById('reportModal').classList.remove('hidden');
  });
}

function generateWeeklyPDF() {
  const week = document.getElementById('weekOverviewSelect') ? document.getElementById('weekOverviewSelect').value : '1';
  if (!week) { alert('Please select a week'); return; }
  fetch('http://localhost:8001/sse', { method: 'GET' }) // ping server to verify
    .catch(() => console.warn('Server ping skipped'));
  // Call MCP server tool via REST proxy or direct endpoint
  fetch('http://localhost:8000/api/tasks')
    .then(() => {
      const url = `http://localhost:8000/Week_${week}_Report.pdf`;
      window.open(url, '_blank');
      alert('PDF generation triggered for Week ' + week);
    })
    .catch(err => console.error('PDF trigger error:', err));
}

function generateDailyReport() {
  fetch('http://localhost:8000/api/reports/daily')
    .then(r => r.json())
    .then(data => {
      const body = document.getElementById('detailModalBody');
      if (body) {
        const entries = data.entries || [];
        const listHtml = entries.length > 0 ? entries.map(e => `<li><strong>${e.task_title || 'Unknown'}</strong> — ${e.progress_notes || ''} (${e.minutes_worked || 0} min)</li>`).join('') : '<li>No progress logged for today yet.</li>';
        body.innerHTML = `<div class="text-xs font-mono text-zinc-300"><h3 class="font-bold text-white mb-2">Daily Report - ${data.date || 'Today'}</h3><p>Total Time: ${data.total_time_logged || 0} min</p><div id="dailyReportDetails" class="pt-2 border-t border-zinc-800/40 mt-2"><ul class="list-disc pl-4">${listHtml}</ul></div></div>`;
        document.getElementById('detailModal').classList.remove('hidden');
      } else {
        alert('Daily report: ' + JSON.stringify(data));
      }
    })
    .catch(err => console.error('Daily report error:', err));
}

function logDailyProgress(taskId) {
  const minutesEl = document.getElementById('progressMinutesInput');
  const notesEl = document.getElementById('progressNotesInput');
  const minutes = minutesEl ? parseInt(minutesEl.value) : 0;
  const notes = notesEl ? notesEl.value : '';
  if (isNaN(minutes) || minutes <= 0) {
    alert('Please enter a valid positive number of minutes worked'); return;
  }
  fetch('http://localhost:8000/api/tasks/' + encodeURIComponent(taskId) + '/progress', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({minutes_worked: minutes, progress_notes: notes})
  })
  .then(r => r.json())
  .then(data => {
    console.log('Daily progress saved:', data);
    if (minutesEl) minutesEl.value = '';
    if (notesEl) notesEl.value = '';
    // Refresh the progress section in the detail modal
    openDetailModal(taskId);
  })
  .catch(err => console.error('Progress log error:', err));
}

function generateWeeklyReport() {
  const week = document.getElementById('weeklyWeekInput') ? document.getElementById('weeklyWeekInput').value : '1';
  fetch('http://localhost:8000/api/weekly/generate-report', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({week_number: parseInt(week || 1)})
  })
  .then(r => r.json())
  .then(data => {
    if (data.message || data.status === 'success') {
      openReportModal(data);
    } else {
      const errMsg = data.detail ? JSON.stringify(data.detail) : (data.error ? JSON.stringify(data) : 'Unknown error');
      console.error('Report generation failed:', errMsg);
      document.getElementById('reportModalBody').innerHTML = '<div class="text-xs text-red-500 font-mono">Failed: ' + errMsg + '</div>';
      document.getElementById('reportModal').classList.remove('hidden');
    }
  })
  .catch(err => {
    console.error('Network error:', err);
    document.getElementById('reportModalBody').innerHTML = '<div class="text-xs text-red-500 font-mono">Network error: ' + err + '</div>';
    document.getElementById('reportModal').classList.remove('hidden');
  });
}

function openReportModal(data) {
  const body = document.getElementById('reportModalBody');
  if (!body) return;
  body.innerHTML = '<pre class="text-xs text-zinc-200 font-mono whitespace-pre-wrap">' + JSON.stringify(data || {}, null, 2) + '</pre>';
  document.getElementById('reportModal').classList.remove('hidden');
}

function closeReportModal() {
  document.getElementById('reportModal').classList.add('hidden');
}

function updateDiagramPreview(url) {
  const preview = document.getElementById('diagramPreview');
  if (preview && url) {
    preview.innerHTML = `<img src="${url}" alt="Mermaid diagram" class="max-w-full rounded border border-zinc-700 shadow-sm">`;
  } else if (preview) {
    preview.innerHTML = `<span class="text-zinc-500 text-xs">No diagram URL provided.</span>`;
  }
}
function saveDiagramLink() {
  const url = document.getElementById('diagramUrlInput').value;
  const modalTitleEl = document.querySelector('#detailModalBody h2');
  const currentTaskId = state.editingTaskId || (modalTitleEl ? modalTitleEl.textContent.split('#')[1] : '');
  if (!currentTaskId || !url) {
    alert('Please enter a diagram URL.');
    return;
  }
  fetch('http://localhost:8000/api/tasks/' + currentTaskId, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({diagram_url: url})
  })
  .then(r => r.json())
  .then(data => {
    if (data.message) {
      alert('Diagram link saved for task: ' + currentTaskId);
      fetchTasks();
    } else {
      alert('Failed to save diagram: ' + (data.detail || data.error || 'Unknown'));
    }
  })
  .catch(err => alert('Error saving diagram: ' + err));
}

function toggleTaskHistory() {
  const container = document.getElementById('taskHistoryContainer');
  const btn = document.getElementById('historyToggleBtn');
  
  if (!container) return;
  
  const isHidden = container.classList.contains('hidden');
  if (isHidden) {
    container.classList.remove('hidden');
    if (btn) btn.classList.add('bg-zinc-700', 'text-white');
  } else {
    container.classList.add('hidden');
    if (btn) btn.classList.remove('bg-zinc-700', 'text-white');
  }
}
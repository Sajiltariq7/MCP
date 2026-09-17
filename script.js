// Function to handle tab switching across views
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('tab-active'));

  const targetView = document.getElementById(`view-${tabName}`);
  const targetTab = document.getElementById(`tab-${tabName}`);

  if (targetView) targetView.classList.remove('hidden');
  if (targetTab) targetTab.classList.add('tab-active');
}

// Main function to fetch and populate dashboard data
async function loadDashboard() {
  try {
    // 1. Fetch tasks from live FastMCP server (fallback to static tasks.json if server is down)
    const tasks = await fetch('http://127.0.0.1:8000/api/tasks')
      .then(res => res.json())
      .catch(() => fetch('tasks.json').then(res => res.json()).catch(() => []));

    // 2. Fetch activity history log
    const history = await fetch('activity_history.json')
      .then(res => res.json())
      .catch(() => []);

    // Clear Kanban columns before rendering
    ['pending', 'in_progress', 'needs_review', 'completed'].forEach(c => {
      const el = document.getElementById(`col-${c}`);
      if (el) el.innerHTML = '';
    });

    // Clear secondary overview lists
    const pendingList = document.getElementById('pending-list');
    const completedList = document.getElementById('completed-list');
    if (pendingList) pendingList.innerHTML = '';
    if (completedList) completedList.innerHTML = '';

    // Render each task card into its respective column/list
    const taskArray = Array.isArray(tasks) ? tasks : (tasks.tasks || []);
    
    taskArray.forEach(task => {
      const cardHtml = `
        <div class="task-card">
          <div class="font-semibold text-sm text-white mb-1">${escapeHtml(task.title || 'Untitled Task')}</div>
          <div class="text-xs text-gray-400 mb-2">${escapeHtml(task.description || 'No description provided.')}</div>
          <div class="flex justify-between items-center text-[10px] text-gray-500 font-mono">
            <span class="text-red-400">${escapeHtml(task.assigned_agent || 'human')}</span>
            <span>Subtasks: ${task.subtasks ? task.subtasks.length : 0}</span>
          </div>
        </div>`;

      // Append to specific Kanban status column
      const statusKey = (task.status || 'pending').toLowerCase();
      const targetCol = document.getElementById(`col-${statusKey}`);
      if (targetCol) targetCol.innerHTML += cardHtml;

      // Append to side overview panels
      if (statusKey === 'pending' || statusKey === 'in_progress') {
        if (pendingList) pendingList.innerHTML += cardHtml;
      } else if (statusKey === 'completed') {
        if (completedList) completedList.innerHTML += cardHtml;
      }
    });

    // Render activity history log
    const historyList = document.getElementById('history-list');
    if (historyList) {
      if (!history || history.length === 0) {
        historyList.innerHTML = '<div class="text-gray-500 text-xs p-2">No activity recorded yet.</div>';
      } else {
        historyList.innerHTML = history.map(h => `
          <div class="p-2 bg-[#12121A] rounded border border-gray-800 flex justify-between items-center text-xs mb-2">
            <span class="text-red-500 font-bold">[${escapeHtml(h.timestamp || '')}]</span>
            <span class="text-yellow-400 font-semibold">${escapeHtml(h.tool_called || '')}</span>
            <span class="text-gray-300">${escapeHtml(h.details || '')}</span>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error("Error loading dashboard data:", err);
  }
}

// Utility function to sanitize HTML rendering
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Initialize setup when DOM loads
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  
  // Attach task creation form handler if present
  const taskForm = document.getElementById('taskForm');
  if (taskForm) {
    taskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titleInput = document.getElementById('taskTitle');
      const descInput = document.getElementById('taskDescription');
      
      if (!titleInput) return;

      try {
        await fetch('http://127.0.0.1:8000/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: titleInput.value,
            description: descInput ? descInput.value : '',
            status: 'pending'
          })
        });
        
        titleInput.value = '';
        if (descInput) descInput.value = '';
        loadDashboard();
      } catch (err) {
        console.error('Failed to save task:', err);
      }
    });
  }
});
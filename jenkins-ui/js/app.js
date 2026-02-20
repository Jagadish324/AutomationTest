/**
 * Jenkins UI - Application Logic
 * Handles rendering of dashboard, job management, modals, and interactions
 */

/* ================================================
   Global State
   ================================================ */
let currentFilter = 'all';
let currentSort = { field: null, asc: true };
let jobToDelete = null;
let selectedJobs = new Set();
let _autoRefreshTimer = null;

/* ================================================
   PAGE INIT  –  connect to real Jenkins if configured
   ================================================ */

async function initPage() {
  populateConnModal();
  updateConnChip();

  if (JenkinsConfig.isConfigured()) {
    setConnChip('loading', 'Connecting…');
    try {
      await JenkinsAPI.syncToLocalStorage();
      setConnChip('connected', hostLabel());
      startAutoRefresh();
    } catch (e) {
      setConnChip('error', 'Connection failed');
      showToast('Could not reach Jenkins: ' + e.message, 'error');
    }
  }
}

function hostLabel() {
  const cfg = JenkinsConfig.get();
  if (!cfg) return 'Jenkins';
  try { return new URL(cfg.url).hostname; } catch (_) { return cfg.url; }
}

/* ── Connection chip ───────────────────────────────── */

function setConnChip(state, label) {
  const chip = document.getElementById('connChip');
  const dot  = document.getElementById('connDot');
  const lbl  = document.getElementById('connLabel');
  if (!chip) return;
  chip.className = 'conn-chip ' + state;
  dot.className  = 'conn-dot '  + state;
  lbl.textContent = label;
}

function updateConnChip() {
  if (JenkinsConfig.isConfigured()) {
    setConnChip('connected', hostLabel());
  } else {
    setConnChip('demo', 'Demo Mode');
  }
}

/* ── Auto refresh ──────────────────────────────────── */

function startAutoRefresh() {
  const cfg = JenkinsConfig.get();
  if (!cfg || !cfg.autoRefresh) return;
  const secs = Math.max(5, cfg.refreshInterval || 30);
  _autoRefreshTimer = setInterval(async function () {
    try {
      await JenkinsAPI.syncToLocalStorage();
      // Re-render whichever page is visible
      if (document.getElementById('dashboardJobTable')) renderDashboard();
      if (document.getElementById('jobsTableBody'))     renderJobsPage();
    } catch (_) { /* silently ignore auto-refresh errors */ }
  }, secs * 1000);
}

function stopAutoRefresh() {
  if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
}

/* ================================================
   CONNECTION SETTINGS MODAL LOGIC
   ================================================ */

function populateConnModal() {
  const cfg = JenkinsConfig.get();
  if (!cfg) return;
  setValue('ci-url',              cfg.url              || '');
  setValue('ci-user',             cfg.username         || '');
  setValue('ci-token',            cfg.token            || '');
  setValue('ci-proxy-port',       cfg.proxyPort        || 3000);
  setValue('ci-refresh-interval', cfg.refreshInterval  || 30);
  setChecked('ci-use-proxy',      cfg.useProxy !== false);
  setChecked('ci-auto-refresh',   cfg.autoRefresh !== false);
  toggleProxyPort();
}

function toggleProxyPort() {
  const row = document.getElementById('proxyPortRow');
  if (!row) return;
  row.style.display = document.getElementById('ci-use-proxy').checked ? '' : 'none';
}

async function testJenkinsConnection() {
  const url   = (document.getElementById('ci-url')   || {}).value || '';
  const user  = (document.getElementById('ci-user')  || {}).value || '';
  const token = (document.getElementById('ci-token') || {}).value || '';
  if (!url || !user || !token) {
    setConnStatus('error', '&#10007; Fill in URL, username and token first.');
    return;
  }
  // Temporarily apply config for the test
  const prev = JenkinsConfig.get();
  JenkinsConfig.save({
    url, username: user, token,
    useProxy:        document.getElementById('ci-use-proxy').checked,
    proxyPort:       parseInt(document.getElementById('ci-proxy-port').value) || 3000,
    autoRefresh:     document.getElementById('ci-auto-refresh').checked,
    refreshInterval: parseInt(document.getElementById('ci-refresh-interval').value) || 30
  });
  setConnStatus('info', '&#9656; Testing connection…');
  try {
    const info = await JenkinsAPI.testConnection();
    setConnStatus('success',
      '&#10003; Connected!  Jenkins ' + (info.version || '') +
      (info.nodeName ? '  ·  Node: ' + info.nodeName : ''));
  } catch (e) {
    setConnStatus('error', '&#10007; ' + e.message);
    if (prev) JenkinsConfig.save(prev); else JenkinsConfig.clear();
  }
}

async function saveJenkinsConnection() {
  const url   = (document.getElementById('ci-url')   || {}).value || '';
  const user  = (document.getElementById('ci-user')  || {}).value || '';
  const token = (document.getElementById('ci-token') || {}).value || '';
  if (!url || !user || !token) {
    setConnStatus('error', '&#10007; URL, username and token are required.');
    return;
  }
  JenkinsConfig.save({
    url, username: user, token,
    useProxy:        document.getElementById('ci-use-proxy').checked,
    proxyPort:       parseInt(document.getElementById('ci-proxy-port').value) || 3000,
    autoRefresh:     document.getElementById('ci-auto-refresh').checked,
    refreshInterval: parseInt(document.getElementById('ci-refresh-interval').value) || 30
  });
  setConnStatus('info', '&#9656; Connecting…');
  try {
    await JenkinsAPI.syncToLocalStorage();
    setConnStatus('success', '&#10003; Connected and synced!');
    setConnChip('connected', hostLabel());
    stopAutoRefresh();
    startAutoRefresh();
    closeModal('connModal');
    showToast('Connected to Jenkins: ' + hostLabel(), 'success');
    // Re-render
    if (document.getElementById('dashboardJobTable')) renderDashboard();
    if (document.getElementById('jobsTableBody'))     renderJobsPage();
  } catch (e) {
    setConnStatus('error', '&#10007; ' + e.message);
  }
}

function disconnectJenkins() {
  stopAutoRefresh();
  JenkinsConfig.clear();
  JenkinsData.resetToDefaults();
  setConnChip('demo', 'Demo Mode');
  closeModal('connModal');
  showToast('Disconnected – showing demo data', 'info');
  if (document.getElementById('dashboardJobTable')) renderDashboard();
  if (document.getElementById('jobsTableBody'))     renderJobsPage();
}

function setConnStatus(type, msg) {
  const el = document.getElementById('connStatus');
  if (!el) return;
  const colors = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--info)' };
  el.style.color = colors[type] || '';
  el.innerHTML   = msg;
}

/* ── small helpers ─────────────────────────────────── */
function setValue(id, v)   { const e = document.getElementById(id); if (e) e.value   = v; }
function setChecked(id, v) { const e = document.getElementById(id); if (e) e.checked = v; }

/* ================================================
   TOAST NOTIFICATIONS
   ================================================ */

function showToast(message, type = 'info') {
  const icons = { success: '&#10003;', error: '&#10007;', info: '&#8505;', warning: '&#9888;' };
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">&#10005;</button>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

/* ================================================
   MODAL HELPERS
   ================================================ */

function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Close modal when clicking overlay background
document.addEventListener('click', function (e) {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

/* ================================================
   STATUS HELPERS
   ================================================ */

function statusBadge(status) {
  const labels = {
    success: '&#10003; Success',
    failed: '&#10007; Failed',
    running: '<span class="spinner"></span> Running',
    unstable: '&#9888; Unstable',
    aborted: '&#8856; Aborted',
    disabled: '&#128683; Disabled',
    queued: '&#8987; Queued'
  };
  return `<span class="status-badge ${status}">${labels[status] || status}</span>`;
}

function healthBar(score) {
  const color = score >= 80 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)';
  return `
    <div style="display:flex; align-items:center; gap:6px;">
      <div class="progress-bar-container">
        <div class="progress-bar" style="width:${score}%; background:${color};"></div>
      </div>
      <span style="font-size:11px; color: var(--text-muted);">${score}%</span>
    </div>`;
}

function typeIcon(type) {
  const icons = {
    'Pipeline': '&#9654;',
    'Freestyle': '&#9881;',
    'Maven': '&#9728;',
    'Multibranch': '&#128336;',
    'Folder': '&#128193;'
  };
  return icons[type] || '&#9881;';
}

/* ================================================
   DASHBOARD PAGE
   ================================================ */

function renderDashboard() {
  const jobs = JenkinsData.getJobs();

  // Update sidebar count
  const sidebarCount = document.getElementById('sidebar-job-count');
  if (sidebarCount) sidebarCount.textContent = jobs.length;

  // Compute stats
  const total = jobs.length;
  const success = jobs.filter(j => j.status === 'success').length;
  const failed = jobs.filter(j => j.status === 'failed').length;
  const running = jobs.filter(j => j.status === 'running').length;
  const queue = JenkinsData.getQueue().length;

  const passRate = total > 0 ? Math.round((success / (total - running)) * 100) : 0;
  const failRate = total > 0 ? Math.round((failed / (total - running)) * 100) : 0;

  // Set stat cards
  setText('stat-total-jobs', total);
  setText('stat-success', success);
  setText('stat-failed', failed);
  setText('stat-running', running);
  setText('stat-jobs-change', '&#8593; ' + total + ' configured');
  setText('stat-success-rate', passRate + '% pass rate');
  setText('stat-failed-rate', failRate + '% fail rate');
  setText('stat-queued', queue + ' in queue');

  // Build trend chart
  renderBuildChart();

  // Recent builds
  renderRecentBuilds(jobs);

  // Build queue
  renderBuildQueue();

  // Job health summary
  renderJobHealth(jobs);

  // Executors
  renderExecutors();

  // Dashboard job table
  renderDashboardTable(jobs);
}

function renderBuildChart() {
  const chart = document.getElementById('buildChart');
  const labels = document.getElementById('chartLabels');
  if (!chart) return;

  const trend = JenkinsData.getBuildTrend();
  chart.innerHTML = '';
  labels.innerHTML = '';

  trend.forEach(function (day) {
    const bar = document.createElement('div');
    bar.className = 'chart-bar ' + day.outcome;
    bar.style.height = day.height + 'px';
    bar.title = day.label + ': ' + day.outcome;
    chart.appendChild(bar);

    const lbl = document.createElement('span');
    lbl.textContent = day.label;
    labels.appendChild(lbl);
  });
}

function renderRecentBuilds(jobs) {
  const list = document.getElementById('recentBuilds');
  if (!list) return;

  const recent = jobs.slice().sort(() => Math.random() - 0.5).slice(0, 8);
  list.innerHTML = recent.map(function (job) {
    return `
      <li class="build-item">
        <div class="build-status-dot ${job.status}"></div>
        <div class="build-info">
          <div class="build-job-name">${job.name} #${job.buildNumber}</div>
          <div class="build-meta">${job.type} &bull; ${job.trigger} &bull; ${job.node}</div>
        </div>
        <div class="build-duration">${job.lastBuild}</div>
        ${statusBadge(job.status)}
      </li>`;
  }).join('');
}

async function renderBuildQueue() {
  const list = document.getElementById('buildQueue');
  const badge = document.getElementById('queue-count-badge');
  if (!list) return;

  let queue;
  if (JenkinsConfig.isConfigured()) {
    try { queue = await JenkinsAPI.getQueue(); } catch (_) { queue = JenkinsData.getQueue(); }
  } else {
    queue = JenkinsData.getQueue();
  }
  if (badge) badge.textContent = queue.length + ' waiting';

  if (queue.length === 0) {
    list.innerHTML = '<li style="padding:16px 0; color: var(--text-muted); font-size:13px;">Queue is empty</li>';
    return;
  }

  list.innerHTML = queue.map(function (item) {
    return `
      <li class="queue-item">
        <div>
          <div class="queue-name">${item.name}</div>
          <div class="queue-wait" style="font-size:11px; color: var(--text-muted);">${item.reason}</div>
        </div>
        <span class="status-badge queued">${item.wait}</span>
      </li>`;
  }).join('');
}

function renderJobHealth(jobs) {
  const container = document.getElementById('jobHealthSummary');
  if (!container) return;

  const sorted = jobs.slice().sort((a, b) => a.healthScore - b.healthScore).slice(0, 5);
  container.innerHTML = sorted.map(function (job) {
    return `
      <div style="margin-bottom: 14px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span style="font-size:12px; font-weight:600;">${job.name}</span>
          <span style="font-size:11px; color: var(--text-muted);">${job.healthScore}%</span>
        </div>
        ${healthBar(job.healthScore)}
      </div>`;
  }).join('');
}

async function renderExecutors() {
  const grid = document.getElementById('executorGrid');
  if (!grid) return;

  let executors;
  if (JenkinsConfig.isConfigured()) {
    try { executors = await JenkinsAPI.getExecutors(); } catch (_) { executors = JenkinsData.getExecutors(); }
  } else {
    executors = JenkinsData.getExecutors();
  }
  grid.innerHTML = executors.map(function (ex) {
    const statusColor = ex.status === 'Offline' ? 'var(--danger)' : ex.load > 0 ? 'var(--info)' : 'var(--success)';
    return `
      <div class="executor-card">
        <div class="executor-name">${ex.label}</div>
        <div class="executor-status" style="color: ${statusColor}; font-size: 11px;">
          ${ex.status === 'Idle' ? '&#9679; Idle' : ex.status === 'Offline' ? '&#9679; Offline' : '&#9679; ' + ex.status.substring(0, 28) + '...'}
        </div>
        <div class="executor-bar">
          <div class="executor-bar-fill" style="width: ${ex.load}%;"></div>
        </div>
      </div>`;
  }).join('');
}

function renderDashboardTable(jobs) {
  const tbody = document.getElementById('dashboardJobTable');
  if (!tbody) return;

  tbody.innerHTML = jobs.slice(0, 6).map(function (job) {
    return `
      <tr>
        <td>
          <div class="job-name-cell">
            <div class="job-icon">${typeIcon(job.type)}</div>
            <div>
              <div class="job-name">${job.name}</div>
              <div class="job-desc">${job.description.substring(0, 50)}${job.description.length > 50 ? '...' : ''}</div>
            </div>
          </div>
        </td>
        <td>${statusBadge(job.status)}</td>
        <td style="font-size:12px; color: var(--text-muted);">${job.lastBuild}</td>
        <td style="font-size:12px;">#${job.buildNumber}</td>
        <td style="font-size:12px; color: var(--text-muted);">${job.duration}</td>
        <td>${healthBar(job.healthScore)}</td>
        <td>
          <div class="action-buttons">
            ${job.status !== 'disabled' ? `<button class="btn-icon btn-sm" title="Build Now" onclick="quickBuild('${job.id}')">&#9654;</button>` : ''}
            <button class="btn-icon btn-sm" title="View" onclick="window.location.href='jobs.html'">&#128269;</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

async function refreshDashboard() {
  if (JenkinsConfig.isConfigured()) {
    setConnChip('loading', 'Syncing…');
    try {
      await JenkinsAPI.syncToLocalStorage();
      setConnChip('connected', hostLabel());
      showToast('Dashboard refreshed from Jenkins', 'success');
    } catch (e) {
      setConnChip('error', 'Sync failed');
      showToast('Refresh failed: ' + e.message, 'error');
    }
  } else {
    showToast('Dashboard refreshed', 'success');
  }
  renderDashboard();
}

function quickBuild(id) {
  JenkinsData.triggerBuild(id);
  showToast('Build triggered successfully!', 'success');
  setTimeout(renderDashboard, 500);
}

/* ================================================
   JOBS PAGE
   ================================================ */

function renderJobsPage() {
  const jobs = JenkinsData.getJobs();

  // Sidebar count
  const sidebarCount = document.getElementById('sidebar-job-count');
  if (sidebarCount) sidebarCount.textContent = jobs.length;

  // Update stat strip
  setText('stat-total', jobs.length);
  setText('stat-success-count', jobs.filter(j => j.status === 'success').length);
  setText('stat-failed-count', jobs.filter(j => j.status === 'failed').length);
  setText('stat-running-count', jobs.filter(j => j.status === 'running').length);
  setText('stat-disabled-count', jobs.filter(j => j.status === 'disabled').length);

  // Update filter tab counts
  updateFilterCounts(jobs);

  // Render table
  renderJobsTable();
}

function updateFilterCounts(jobs) {
  setText('count-all', jobs.length);
  setText('count-success', jobs.filter(j => j.status === 'success').length);
  setText('count-failed', jobs.filter(j => j.status === 'failed').length);
  setText('count-running', jobs.filter(j => j.status === 'running').length);
  setText('count-unstable', jobs.filter(j => j.status === 'unstable').length);
  setText('count-disabled', jobs.filter(j => j.status === 'disabled').length);
}

function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderJobsTable();
}

function renderJobsTable() {
  const tbody = document.getElementById('jobsTableBody');
  const emptyState = document.getElementById('emptyState');
  if (!tbody) return;

  let jobs = JenkinsData.getJobs();

  // Apply status filter
  if (currentFilter !== 'all') {
    jobs = jobs.filter(j => j.status === currentFilter);
  }

  // Apply search
  const searchVal = (
    (document.getElementById('tableSearch') && document.getElementById('tableSearch').value) ||
    (document.getElementById('globalSearch') && document.getElementById('globalSearch').value) ||
    ''
  ).toLowerCase().trim();

  if (searchVal) {
    jobs = jobs.filter(j =>
      j.name.toLowerCase().includes(searchVal) ||
      j.type.toLowerCase().includes(searchVal) ||
      j.description.toLowerCase().includes(searchVal)
    );
  }

  // Apply sort
  if (currentSort.field) {
    jobs = jobs.slice().sort(function (a, b) {
      let va = a[currentSort.field], vb = b[currentSort.field];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return currentSort.asc ? -1 : 1;
      if (va > vb) return currentSort.asc ? 1 : -1;
      return 0;
    });
  }

  if (jobs.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = jobs.map(function (job) {
    const isSelected = selectedJobs.has(job.id);
    return `
      <tr id="row-${job.id}" ${isSelected ? 'style="background:#e3f2fd;"' : ''}>
        <td>
          <input type="checkbox" onchange="toggleSelect('${job.id}', this)" ${isSelected ? 'checked' : ''} />
        </td>
        <td>
          <div class="job-name-cell">
            <div class="job-icon">${typeIcon(job.type)}</div>
            <div>
              <div class="job-name" onclick="viewJob('${job.id}')">${job.name}</div>
              <div class="job-desc">${job.description.substring(0, 55)}${job.description.length > 55 ? '...' : ''}</div>
            </div>
          </div>
        </td>
        <td style="font-size:12px; color: var(--text-muted);">${job.type}</td>
        <td>${statusBadge(job.status)}</td>
        <td style="font-size:12px; color: var(--text-muted);">${job.lastBuild}</td>
        <td style="font-size:12px;">#${job.buildNumber}</td>
        <td style="font-size:12px; color: var(--text-muted);">${job.duration}</td>
        <td style="font-size:12px;">${job.trigger}</td>
        <td>${healthBar(job.healthScore)}</td>
        <td>
          <div class="action-buttons">
            ${job.status !== 'disabled' && job.status !== 'running'
              ? `<button class="btn-icon btn-sm" title="Build Now" onclick="buildJob('${job.id}')">&#9654;</button>`
              : ''}
            ${job.status === 'running'
              ? `<button class="btn-icon btn-sm" title="Running..." style="color:var(--info);" disabled><span class="spinner"></span></button>`
              : ''}
            <button class="btn-icon btn-sm" title="View Details" onclick="viewJob('${job.id}')">&#128269;</button>
            <button class="btn-icon btn-sm" title="Edit Job" onclick="editJob('${job.id}')">&#9998;</button>
            <button class="btn-icon btn-sm" title="${job.status === 'disabled' ? 'Enable' : 'Disable'}" onclick="toggleDisableJob('${job.id}')">
              ${job.status === 'disabled' ? '&#9654;' : '&#128683;'}
            </button>
            <button class="btn-icon btn-sm" title="Console Log" onclick="showBuildLog('${job.id}')">&#128196;</button>
            <button class="btn-icon btn-sm" title="Delete Job" style="color:var(--danger);" onclick="promptDeleteJob('${job.id}', '${job.name}')">&#128465;</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function sortTable(field) {
  if (currentSort.field === field) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort.field = field;
    currentSort.asc = true;
  }
  renderJobsTable();
}

function filterJobsTable() {
  renderJobsTable();
}

async function refreshJobs() {
  if (JenkinsConfig.isConfigured()) {
    setConnChip('loading', 'Syncing…');
    try {
      await JenkinsAPI.syncToLocalStorage();
      setConnChip('connected', hostLabel());
      showToast('Jobs refreshed from Jenkins', 'success');
    } catch (e) {
      setConnChip('error', 'Sync failed');
      showToast('Refresh failed: ' + e.message, 'error');
    }
  } else {
    showToast('Jobs refreshed', 'success');
  }
  renderJobsPage();
}

/* ================================================
   SELECTION
   ================================================ */

function toggleSelectAll(checkbox) {
  const jobs = JenkinsData.getJobs();
  if (checkbox.checked) {
    jobs.forEach(j => selectedJobs.add(j.id));
  } else {
    selectedJobs.clear();
  }
  renderJobsTable();
  updateBulkBar();
}

function toggleSelect(id, checkbox) {
  if (checkbox.checked) {
    selectedJobs.add(id);
  } else {
    selectedJobs.delete(id);
  }
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById('bulkActionsBar');
  const count = document.getElementById('selectedCount');
  if (!bar) return;
  if (selectedJobs.size > 0) {
    bar.style.display = 'block';
    if (count) count.textContent = selectedJobs.size + ' selected';
  } else {
    bar.style.display = 'none';
  }
}

function clearSelection() {
  selectedJobs.clear();
  const selectAll = document.getElementById('selectAll');
  if (selectAll) selectAll.checked = false;
  updateBulkBar();
  renderJobsTable();
}

function bulkBuild() {
  selectedJobs.forEach(id => JenkinsData.triggerBuild(id));
  showToast('Build triggered for ' + selectedJobs.size + ' job(s)', 'success');
  clearSelection();
  setTimeout(renderJobsPage, 500);
}

function bulkDisable() {
  selectedJobs.forEach(function (id) {
    const job = JenkinsData.getJob(id);
    if (job && job.status !== 'running') JenkinsData.toggleDisable(id);
  });
  showToast('Disabled ' + selectedJobs.size + ' job(s)', 'warning');
  clearSelection();
  renderJobsPage();
}

function bulkDelete() {
  if (!confirm('Delete ' + selectedJobs.size + ' selected job(s)? This cannot be undone.')) return;
  selectedJobs.forEach(id => JenkinsData.deleteJob(id));
  showToast('Deleted ' + selectedJobs.size + ' job(s)', 'error');
  clearSelection();
  renderJobsPage();
}

/* ================================================
   CREATE / EDIT JOB
   ================================================ */

function openCreateModal() {
  clearJobForm();
  setText('modalTitle', 'Create New Job');
  document.getElementById('editJobId').value = '';
  openModal('jobModal');
}

function editJob(id) {
  const job = JenkinsData.getJob(id);
  if (!job) return;
  clearJobForm();
  setText('modalTitle', 'Edit Job: ' + job.name);
  document.getElementById('editJobId').value = id;
  document.getElementById('jobName').value = job.name;
  document.getElementById('jobType').value = job.type;
  document.getElementById('jobPriority').value = job.priority;
  document.getElementById('jobDescription').value = job.description;
  document.getElementById('jobRepo').value = job.repo;
  document.getElementById('jobBranch').value = job.branch;
  document.getElementById('jobTrigger').value = job.trigger;
  document.getElementById('jobBuildTool').value = job.buildTool;
  document.getElementById('jobNode').value = job.node;
  document.getElementById('jobNotifyEmail').checked = job.notifyEmail;
  openModal('jobModal');
}

function clearJobForm() {
  ['jobName','jobDescription','jobRepo','jobBranch','jobNode'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const el = document.getElementById('jobNotifyEmail');
  if (el) el.checked = false;
}

async function saveJob() {
  const name = (document.getElementById('jobName').value || '').trim();
  if (!name) {
    showToast('Job name is required!', 'error');
    document.getElementById('jobName').focus();
    return;
  }

  const data = {
    name: name,
    type: document.getElementById('jobType').value,
    priority: document.getElementById('jobPriority').value,
    description: document.getElementById('jobDescription').value,
    repo: document.getElementById('jobRepo').value,
    branch: document.getElementById('jobBranch').value || 'main',
    trigger: document.getElementById('jobTrigger').value,
    buildTool: document.getElementById('jobBuildTool').value,
    node: document.getElementById('jobNode').value || 'built-in',
    notifyEmail: document.getElementById('jobNotifyEmail').checked
  };

  const editId = document.getElementById('editJobId').value;

  if (JenkinsConfig.isConfigured()) {
    try {
      if (editId) {
        const existingJob = JenkinsData.getJob(editId);
        await JenkinsAPI.updateJob(existingJob ? existingJob.name : editId, data);
        showToast('Job "' + name + '" updated on Jenkins!', 'success');
      } else {
        await JenkinsAPI.createJob(data);
        showToast('Job "' + name + '" created on Jenkins!', 'success');
      }
      await JenkinsAPI.syncToLocalStorage();
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error');
    }
    closeModal('jobModal');
    renderJobsPage();
    return;
  }

  // Demo mode
  if (editId) {
    JenkinsData.updateJob(editId, data);
    showToast('Job "' + name + '" updated successfully!', 'success');
  } else {
    JenkinsData.createJob(data);
    showToast('Job "' + name + '" created successfully!', 'success');
  }

  closeModal('jobModal');
  renderJobsPage();
}

/* ================================================
   VIEW JOB
   ================================================ */

function viewJob(id) {
  const job = JenkinsData.getJob(id);
  if (!job) return;

  setText('viewModalTitle', '&#9881; ' + job.name);

  const historyDots = (job.buildHistory || []).map(function (h) {
    return `<span style="
      display:inline-block;
      width:12px; height:12px;
      border-radius:50%;
      background: ${h === 'success' ? 'var(--success)' : h === 'failed' ? 'var(--danger)' : h === 'unstable' ? 'var(--warning)' : '#9e9e9e'};
      margin: 1px;
      title="${h}
    "></span>`;
  }).join('');

  document.getElementById('viewModalBody').innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
      <div>
        <div class="form-label">Status</div>
        <div style="margin-bottom:12px;">${statusBadge(job.status)}</div>

        <div class="form-label">Type</div>
        <div style="margin-bottom:12px; font-size:13px;">${job.type}</div>

        <div class="form-label">Trigger</div>
        <div style="margin-bottom:12px; font-size:13px;">${job.trigger}</div>

        <div class="form-label">Build Tool</div>
        <div style="margin-bottom:12px; font-size:13px;">${job.buildTool}</div>

        <div class="form-label">Priority</div>
        <div style="margin-bottom:12px; font-size:13px;">${job.priority}</div>
      </div>
      <div>
        <div class="form-label">Last Build</div>
        <div style="margin-bottom:12px; font-size:13px;">${job.lastBuild}</div>

        <div class="form-label">Build Number</div>
        <div style="margin-bottom:12px; font-size:13px;">#${job.buildNumber}</div>

        <div class="form-label">Duration</div>
        <div style="margin-bottom:12px; font-size:13px;">${job.duration}</div>

        <div class="form-label">Node/Agent</div>
        <div style="margin-bottom:12px; font-size:13px;">${job.node}</div>

        <div class="form-label">Health Score</div>
        <div style="margin-bottom:12px;">${healthBar(job.healthScore)}</div>
      </div>
    </div>

    <div class="form-label">Description</div>
    <div style="margin-bottom:12px; font-size:13px; color: var(--text-muted);">${job.description || 'No description'}</div>

    <div class="form-label">Repository</div>
    <div style="margin-bottom:12px; font-size:12px; color: var(--info);">${job.repo || 'N/A'} (${job.branch})</div>

    <div class="form-label">Build History (last ${(job.buildHistory || []).length} builds)</div>
    <div style="margin-top:4px;">${historyDots || '<span style="font-size:12px; color: var(--text-muted);">No builds yet</span>'}</div>
  `;

  document.getElementById('viewModalBuildBtn').onclick = function () {
    closeModal('viewModal');
    buildJob(id);
  };
  document.getElementById('viewModalEditBtn').onclick = function () {
    closeModal('viewModal');
    editJob(id);
  };

  openModal('viewModal');
}

/* ================================================
   BUILD ACTIONS
   ================================================ */

async function buildJob(id) {
  const job = JenkinsData.getJob(id);
  if (!job) return;
  if (job.status === 'disabled') {
    showToast('Cannot build a disabled job. Enable it first.', 'warning');
    return;
  }

  if (JenkinsConfig.isConfigured()) {
    try {
      await JenkinsAPI.triggerBuild(job.name);
      showToast('&#9654; Build queued: ' + job.name, 'info');
      // Poll for status change (Jenkins can take a moment to schedule)
      setTimeout(async function () {
        try {
          await JenkinsAPI.syncToLocalStorage();
          if (document.getElementById('jobsTableBody'))     renderJobsPage();
          if (document.getElementById('dashboardJobTable')) renderDashboard();
        } catch (_) {}
      }, 3000);
    } catch (e) {
      showToast('Build trigger failed: ' + e.message, 'error');
    }
    return;
  }

  // Demo mode
  JenkinsData.triggerBuild(id);
  showToast('&#9654; Build triggered: ' + job.name + ' #' + (job.buildNumber + 1), 'info');
  setTimeout(function () {
    if (document.getElementById('jobsTableBody'))     renderJobsPage();
    if (document.getElementById('dashboardJobTable')) renderDashboard();
    showToast('Build completed for: ' + job.name, 'success');
  }, 4200);
  renderJobsPage();
}

/* ================================================
   DISABLE / ENABLE
   ================================================ */

async function toggleDisableJob(id) {
  const job = JenkinsData.getJob(id);
  if (!job) return;

  if (JenkinsConfig.isConfigured()) {
    try {
      if (job.status === 'disabled') {
        await JenkinsAPI.enableJob(job.name);
        showToast('Job "' + job.name + '" enabled', 'success');
      } else {
        await JenkinsAPI.disableJob(job.name);
        showToast('Job "' + job.name + '" disabled', 'warning');
      }
      await JenkinsAPI.syncToLocalStorage();
      renderJobsPage();
    } catch (e) {
      showToast('Action failed: ' + e.message, 'error');
    }
    return;
  }

  // Demo mode
  const result = JenkinsData.toggleDisable(id);
  if (result) {
    const msg = result.status === 'disabled'
      ? 'Job "' + result.name + '" has been disabled'
      : 'Job "' + result.name + '" has been enabled';
    showToast(msg, result.status === 'disabled' ? 'warning' : 'success');
    renderJobsPage();
  }
}

/* ================================================
   DELETE JOB
   ================================================ */

function promptDeleteJob(id, name) {
  jobToDelete = id;
  const el = document.getElementById('deleteJobName');
  if (el) el.textContent = '"' + name + '"';
  openModal('deleteModal');
}

async function confirmDelete() {
  if (!jobToDelete) return;
  const job = JenkinsData.getJob(jobToDelete);
  const name = job ? job.name : jobToDelete;

  if (JenkinsConfig.isConfigured()) {
    try {
      await JenkinsAPI.deleteJob(name);
      JenkinsData.deleteJob(jobToDelete);        // remove from local cache too
      showToast('Job "' + name + '" deleted from Jenkins', 'error');
    } catch (e) {
      showToast('Delete failed: ' + e.message, 'error');
    }
    jobToDelete = null;
    closeModal('deleteModal');
    renderJobsPage();
    return;
  }

  // Demo mode
  JenkinsData.deleteJob(jobToDelete);
  showToast('Job "' + name + '" deleted', 'error');
  jobToDelete = null;
  closeModal('deleteModal');
  renderJobsPage();
}

/* ================================================
   BUILD CONSOLE LOG
   ================================================ */

async function showBuildLog(id) {
  const job = JenkinsData.getJob(id);
  if (!job) return;

  setText('logModalTitle', 'Console Output - ' + job.name + ' #' + job.buildNumber);
  const output = document.getElementById('consoleOutput');
  output.textContent = 'Loading…';
  openModal('logModal');

  if (JenkinsConfig.isConfigured() && job.buildNumber > 0) {
    try {
      const text = await JenkinsAPI.getConsoleOutput(job.name, job.buildNumber);
      output.textContent = text;
    } catch (e) {
      output.textContent = 'Could not load log: ' + e.message + '\n\n' + generateFakeLog(job);
    }
  } else {
    output.innerHTML = generateFakeLog(job);
  }

  setTimeout(function () { output.scrollTop = output.scrollHeight; }, 100);
}

function generateFakeLog(job) {
  const lines = [];
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const isSuccess = job.status === 'success';
  const isFailed = job.status === 'failed';

  lines.push(`<span style="color:#569cd6;">[Jenkins]</span> Started by ${job.trigger.toLowerCase()} trigger`);
  lines.push(`<span style="color:#569cd6;">[Pipeline]</span> Running on ${job.node} in workspace /var/jenkins/workspace/${job.name}`);
  lines.push(`<span style="color:#9cdcfe;">[${timestamp}]</span> Fetching changes from git: ${job.repo}`);
  lines.push(` > git rev-parse --is-inside-work-tree`);
  lines.push(` > git fetch --tags --force --progress -- origin +refs/heads/${job.branch}:refs/remotes/origin/${job.branch}`);
  lines.push(` > git rev-parse refs/remotes/origin/${job.branch}^{commit}`);
  lines.push(`<span style="color:#9cdcfe;">[${timestamp}]</span> Checking out commit a3f9b21...`);
  lines.push(``);

  if (job.buildTool === 'Maven') {
    lines.push(`<span style="color:#9cdcfe;">[${timestamp}]</span> Executing: mvn clean package -DskipTests=false`);
    lines.push(`[INFO] Scanning for projects...`);
    lines.push(`[INFO] ---------------------------------------------------------`);
    lines.push(`[INFO] Building ${job.name} 1.0-SNAPSHOT`);
    lines.push(`[INFO] ---------------------------------------------------------`);
    lines.push(`[INFO] --- maven-compiler-plugin:3.11.0:compile ---`);
    lines.push(`[INFO] Compiling 47 source files`);
    lines.push(`[INFO] --- maven-surefire-plugin:3.0.0:test ---`);
    lines.push(`[INFO] Running com.example.AppTest`);
    lines.push(`[INFO] Running com.example.ServiceTest`);
    if (!isFailed) {
      lines.push(`[INFO] Tests run: 24, Failures: 0, Errors: 0, Skipped: 0`);
      lines.push(`[INFO] BUILD SUCCESS`);
    } else {
      lines.push(`[ERROR] Tests run: 24, Failures: 3, Errors: 1, Skipped: 0`);
      lines.push(`[ERROR] BUILD FAILURE`);
    }
  } else if (job.buildTool === 'npm') {
    lines.push(`<span style="color:#9cdcfe;">[${timestamp}]</span> Executing: npm install && npm test && npm run build`);
    lines.push(`npm WARN deprecated some-package@1.0.0`);
    lines.push(`added 1234 packages in 18s`);
    lines.push(``);
    lines.push(`> react-app@0.1.0 test`);
    lines.push(`> react-scripts test --watchAll=false`);
    if (!isFailed) {
      lines.push(`PASS src/App.test.js`);
      lines.push(`PASS src/components/Header.test.js`);
      lines.push(`Test Suites: 8 passed, 8 total`);
      lines.push(`Tests:       42 passed, 42 total`);
    } else {
      lines.push(`FAIL src/components/Dashboard.test.js`);
      lines.push(`  x renders correctly (102ms)`);
      lines.push(`Test Suites: 1 failed, 7 passed, 8 total`);
    }
  } else {
    lines.push(`<span style="color:#9cdcfe;">[${timestamp}]</span> Executing build script...`);
    lines.push(`$ ${job.buildTool.toLowerCase()} clean build`);
    if (!isFailed) {
      lines.push(`BUILD SUCCESSFUL in ${job.duration}`);
    } else {
      lines.push(`BUILD FAILED: see error above`);
    }
  }

  lines.push(``);
  if (isSuccess) {
    lines.push(`<span style="color:#4ec9b0;">Finished: SUCCESS</span>`);
    lines.push(`<span style="color:#9cdcfe;">Build duration: ${job.duration}</span>`);
  } else if (isFailed) {
    lines.push(`<span style="color:#f44747;">Finished: FAILURE</span>`);
    lines.push(`<span style="color:#9cdcfe;">Build duration: ${job.duration}</span>`);
  } else if (job.status === 'running') {
    lines.push(`<span style="color:#569cd6; animation: pulse 1s infinite;">Build in progress...</span>`);
  } else {
    lines.push(`Finished: ${job.status.toUpperCase()}`);
  }

  return lines.join('\n');
}

/* ================================================
   UTILITY
   ================================================ */

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

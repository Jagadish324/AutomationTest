/**
 * Jenkins UI - Real Jenkins REST API Client
 * ==========================================
 * Talks to a live Jenkins server (via the proxy or directly).
 * Translates Jenkins API responses into the same shape used by JenkinsData,
 * so the rest of the UI code needs minimal changes.
 */
const JenkinsAPI = (function () {

  /* ── Colour → status mapping ─────────────────────────── */
  const COLOR_MAP = {
    blue:             'success',
    blue_anime:       'running',
    red:              'failed',
    red_anime:        'running',
    yellow:           'unstable',
    yellow_anime:     'running',
    grey:             'aborted',
    grey_anime:       'running',
    disabled:         'disabled',
    disabled_anime:   'running',
    notbuilt:         'aborted',
    notbuilt_anime:   'running',
    aborted:          'aborted',
    aborted_anime:    'running'
  };

  function colorToStatus(color) {
    return COLOR_MAP[(color || '').toLowerCase()] || 'aborted';
  }

  /* ── Duration formatter ──────────────────────────────── */
  function fmtDuration(ms) {
    if (!ms) return 'N/A';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  /* ── Relative time formatter ─────────────────────────── */
  function fmtRelative(timestamp) {
    if (!timestamp) return 'Never';
    const diff = Date.now() - timestamp;
    const s = Math.floor(diff / 1000);
    if (s < 60)  return 'Just now';
    if (s < 3600) return `${Math.floor(s / 60)} minute(s) ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} hour(s) ago`;
    return `${Math.floor(s / 86400)} day(s) ago`;
  }

  /* ── Core fetch wrapper ──────────────────────────────── */
  let _crumb = null; // cached CSRF crumb { field, value }

  async function apiFetch(path, options = {}) {
    const base    = JenkinsConfig.apiBase();
    const hdrs    = JenkinsConfig.requestHeaders();

    if (!base) throw new Error('Jenkins not configured');

    const url = base + path;
    const headers = Object.assign({ 'Accept': 'application/json' }, hdrs, options.headers || {});

    // Inject crumb for mutating requests
    if (['POST', 'PUT', 'DELETE'].includes((options.method || 'GET').toUpperCase())) {
      if (!_crumb) await fetchCrumb();
      if (_crumb) {
        headers['X-Jenkins-Crumb-Field'] = _crumb.field;
        headers['X-Jenkins-Crumb']       = _crumb.value;
        headers[_crumb.field]            = _crumb.value;
      }
    }

    const res = await fetch(url, Object.assign({}, options, { headers }));
    return res;
  }

  /* ── CSRF crumb ──────────────────────────────────────── */
  async function fetchCrumb() {
    try {
      const res  = await apiFetch('/crumbIssuer/api/json');
      if (res.ok) {
        const data = await res.json();
        _crumb = { field: data.crumbRequestField, value: data.crumb };
      }
    } catch (_) {
      // Jenkins may have CSRF disabled – that's fine
    }
  }

  /* ── Connection test ─────────────────────────────────── */
  async function testConnection() {
    _crumb = null;
    const res = await apiFetch('/api/json?tree=nodeName,version');
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data;
  }

  /* ── Fetch + transform all jobs ──────────────────────── */
  async function getJobs() {
    const TREE = [
      'jobs[',
        'name,color,buildable,description,url,',
        'lastBuild[number,duration,timestamp,result,url],',
        'healthReport[score,description]',
      ']'
    ].join('');

    const res  = await apiFetch(`/api/json?tree=${encodeURIComponent(TREE)}`);
    if (!res.ok) throw new Error(`Failed to fetch jobs: HTTP ${res.status}`);
    const data = await res.json();

    return (data.jobs || []).map(transformJob);
  }

  function transformJob(j) {
    const lb    = j.lastBuild || {};
    const health = (j.healthReport || [])[0] || {};
    const status = colorToStatus(j.color);
    const hist  = buildHistoryFromHealth(health.score);

    return {
      id:           j.name,          // use job name as id (unique in Jenkins)
      name:         j.name,
      type:         guessType(j),
      description:  j.description || '',
      status,
      lastBuild:    lb.timestamp ? fmtRelative(lb.timestamp) : 'Never',
      buildNumber:  lb.number    || 0,
      duration:     status === 'running'
                      ? 'Running...'
                      : fmtDuration(lb.duration),
      trigger:      'Jenkins',
      repo:         '',
      branch:       'N/A',
      buildTool:    'Jenkins',
      node:         'built-in',
      priority:     'Normal',
      notifyEmail:  false,
      healthScore:  health.score != null ? health.score : 100,
      buildHistory: hist,
      _raw:         j              // keep raw for detail view
    };
  }

  function guessType(j) {
    const cls = (j._class || '').toLowerCase();
    if (cls.includes('pipeline') || cls.includes('workflow')) return 'Pipeline';
    if (cls.includes('multibranch'))                          return 'Multibranch';
    if (cls.includes('maven'))                                return 'Maven';
    if (cls.includes('folder'))                               return 'Folder';
    return 'Freestyle';
  }

  // Approximate a 10-build history from the overall health score
  function buildHistoryFromHealth(score) {
    if (score == null) return [];
    const passes = Math.round((score / 100) * 10);
    const hist = [];
    for (let i = 0; i < 10; i++) hist.push(i < passes ? 'success' : 'failed');
    return hist.sort(() => Math.random() - 0.5);
  }

  /* ── Job detail (builds list) ────────────────────────── */
  async function getJobDetail(jobName) {
    const TREE = 'builds[number,result,duration,timestamp,url]{0,20},' +
                 'description,url,color,healthReport[score,description]';
    const res  = await apiFetch(`/job/${enc(jobName)}/api/json?tree=${encodeURIComponent(TREE)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ── Console output ──────────────────────────────────── */
  async function getConsoleOutput(jobName, buildNumber) {
    const res = await apiFetch(`/job/${enc(jobName)}/${buildNumber}/consoleText`, {
      headers: { 'Accept': 'text/plain' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  /* ── Trigger build ───────────────────────────────────── */
  async function triggerBuild(jobName) {
    const res = await apiFetch(`/job/${enc(jobName)}/build`, { method: 'POST' });
    // Jenkins returns 201 on success, or 303 redirect
    if (res.status !== 201 && res.status !== 200 && res.status !== 303) {
      throw new Error(`Trigger failed: HTTP ${res.status}`);
    }
  }

  /* ── Disable / Enable ────────────────────────────────── */
  async function disableJob(jobName) {
    const res = await apiFetch(`/job/${enc(jobName)}/disable`, { method: 'POST' });
    if (!res.ok && res.status !== 302) throw new Error(`HTTP ${res.status}`);
  }

  async function enableJob(jobName) {
    const res = await apiFetch(`/job/${enc(jobName)}/enable`, { method: 'POST' });
    if (!res.ok && res.status !== 302) throw new Error(`HTTP ${res.status}`);
  }

  /* ── Delete job ──────────────────────────────────────── */
  async function deleteJob(jobName) {
    const res = await apiFetch(`/job/${enc(jobName)}/doDelete`, { method: 'POST' });
    if (!res.ok && res.status !== 302) throw new Error(`HTTP ${res.status}`);
  }

  /* ── Create job ──────────────────────────────────────── */
  async function createJob(formData) {
    const xml = buildJobConfigXML(formData);
    const res = await apiFetch(
      `/createItem?name=${encodeURIComponent(formData.name)}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/xml' },
        body:    xml
      }
    );
    if (!res.ok && res.status !== 200) throw new Error(`Create failed: HTTP ${res.status}`);
  }

  /* ── Update job (reconfigure) ────────────────────────── */
  async function updateJob(jobName, formData) {
    const xml = buildJobConfigXML(formData);
    const res = await apiFetch(
      `/job/${enc(jobName)}/config.xml`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/xml' },
        body:    xml
      }
    );
    if (!res.ok) throw new Error(`Update failed: HTTP ${res.status}`);
  }

  /* ── Job config XML generator ────────────────────────── */
  function buildJobConfigXML(d) {
    const scm = d.repo ? `
  <scm class="hudson.plugins.git.GitSCM" plugin="git@latest">
    <configVersion>2</configVersion>
    <userRemoteConfigs>
      <hudson.plugins.git.UserRemoteConfig>
        <url>${esc(d.repo)}</url>
      </hudson.plugins.git.UserRemoteConfig>
    </userRemoteConfigs>
    <branches>
      <hudson.plugins.git.BranchSpec>
        <name>*/${esc(d.branch || 'main')}</name>
      </hudson.plugins.git.BranchSpec>
    </branches>
  </scm>` : `<scm class="hudson.scm.NullSCM"/>`;

    const buildCmd = buildCommand(d.buildTool);
    const emailPublisher = d.notifyEmail ? `
    <hudson.tasks.Mailer plugin="mailer@latest">
      <recipients></recipients>
      <dontNotifyEveryUnstableBuild>true</dontNotifyEveryUnstableBuild>
      <sendToIndividuals>false</sendToIndividuals>
    </hudson.tasks.Mailer>` : '';

    const triggerBlock = buildTrigger(d.trigger);

    if (d.type === 'Pipeline' || d.type === 'Multibranch') {
      return `<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job@latest">
  <description>${esc(d.description || '')}</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps@latest">
    ${scm}
    <scriptPath>Jenkinsfile</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers>${triggerBlock}</triggers>
</flow-definition>`;
    }

    return `<?xml version='1.1' encoding='UTF-8'?>
<project>
  <description>${esc(d.description || '')}</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  ${scm}
  <triggers>${triggerBlock}</triggers>
  <builders>
    <hudson.tasks.Shell>
      <command>${esc(buildCmd)}</command>
    </hudson.tasks.Shell>
  </builders>
  <publishers>${emailPublisher}
  </publishers>
  <buildWrappers/>
</project>`;
  }

  function buildCommand(tool) {
    const cmds = {
      Maven:  'mvn clean package',
      Gradle: './gradlew clean build',
      npm:    'npm install && npm test',
      Make:   'make',
      Ant:    'ant',
      Shell:  '#!/bin/bash\necho "Running build..."'
    };
    return cmds[tool] || 'echo "Build"';
  }

  function buildTrigger(trigger) {
    if (trigger === 'SCM Poll')  return '<hudson.triggers.SCMTrigger><spec>H/5 * * * *</spec></hudson.triggers.SCMTrigger>';
    if (trigger === 'Scheduled') return '<hudson.triggers.TimerTrigger><spec>H 2 * * *</spec></hudson.triggers.TimerTrigger>';
    return '';
  }

  /* ── Build queue ─────────────────────────────────────── */
  async function getQueue() {
    const TREE = 'items[id,task[name],why,timestamp]';
    const res  = await apiFetch(`/queue/api/json?tree=${encodeURIComponent(TREE)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(item => ({
      name:   item.task ? item.task.name : 'Unknown',
      wait:   item.timestamp ? fmtRelative(item.timestamp) : '—',
      reason: item.why || 'Waiting'
    }));
  }

  /* ── Executors (nodes) ───────────────────────────────── */
  async function getExecutors() {
    const TREE = 'computer[displayName,description,offline,numExecutors,' +
                 'executors[currentExecutable[number,url,fullDisplayName]]]';
    const res  = await apiFetch(`/computer/api/json?tree=${encodeURIComponent(TREE)}`);
    if (!res.ok) return [];
    const data = await res.json();

    return (data.computer || []).map(node => {
      const busy = (node.executors || []).filter(e => e.currentExecutable).length;
      const total = node.numExecutors || 1;
      return {
        name:   node.displayName,
        label:  node.displayName,
        status: node.offline
                  ? 'Offline'
                  : busy > 0
                    ? 'Busy (' + busy + '/' + total + ')'
                    : 'Idle',
        load: Math.round((busy / total) * 100)
      };
    });
  }

  /* ── Sync to localStorage so JenkinsData stays compatible ── */
  async function syncToLocalStorage() {
    const jobs = await getJobs();
    localStorage.setItem('jenkins_ui_jobs', JSON.stringify(jobs));
    return jobs;
  }

  /* ── Helpers ─────────────────────────────────────────── */
  function enc(s) { return encodeURIComponent(s); }
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Public API ──────────────────────────────────────── */
  return {
    testConnection,
    getJobs,
    getJobDetail,
    getConsoleOutput,
    triggerBuild,
    disableJob,
    enableJob,
    deleteJob,
    createJob,
    updateJob,
    getQueue,
    getExecutors,
    syncToLocalStorage
  };
})();

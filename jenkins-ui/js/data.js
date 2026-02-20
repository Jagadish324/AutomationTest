/**
 * Jenkins UI - Data Store
 * Simulates Jenkins job/build data using localStorage for persistence
 */

const JenkinsData = (function () {

  const STORAGE_KEY = 'jenkins_ui_jobs';

  const DEFAULT_JOBS = [
    {
      id: 'job-001',
      name: 'backend-api-build',
      type: 'Maven',
      description: 'Build and test the core backend REST API service',
      status: 'success',
      lastBuild: '2 minutes ago',
      buildNumber: 142,
      duration: '3m 24s',
      trigger: 'Webhook',
      repo: 'https://github.com/org/backend-api.git',
      branch: 'main',
      buildTool: 'Maven',
      node: 'linux-agent-1',
      priority: 'High',
      notifyEmail: true,
      healthScore: 92,
      buildHistory: ['success','success','success','failed','success','success','success','success','success','success']
    },
    {
      id: 'job-002',
      name: 'frontend-react-deploy',
      type: 'Pipeline',
      description: 'Build, test and deploy React frontend to staging',
      status: 'running',
      lastBuild: 'Just now',
      buildNumber: 78,
      duration: '1m 12s (running)',
      trigger: 'Webhook',
      repo: 'https://github.com/org/frontend-app.git',
      branch: 'develop',
      buildTool: 'npm',
      node: 'linux-agent-2',
      priority: 'Normal',
      notifyEmail: true,
      healthScore: 75,
      buildHistory: ['success','success','failed','success','running','success','success','failed','success','running']
    },
    {
      id: 'job-003',
      name: 'database-migration',
      type: 'Freestyle',
      description: 'Run Flyway database migration scripts',
      status: 'failed',
      lastBuild: '1 hour ago',
      buildNumber: 31,
      duration: '0m 47s',
      trigger: 'Manual',
      repo: 'https://github.com/org/db-scripts.git',
      branch: 'main',
      buildTool: 'Shell',
      node: 'built-in',
      priority: 'Critical',
      notifyEmail: true,
      healthScore: 40,
      buildHistory: ['success','failed','failed','success','success','failed','success','failed','failed','failed']
    },
    {
      id: 'job-004',
      name: 'integration-tests',
      type: 'Pipeline',
      description: 'End-to-end integration test suite across all microservices',
      status: 'success',
      lastBuild: '15 minutes ago',
      buildNumber: 209,
      duration: '12m 05s',
      trigger: 'SCM Poll',
      repo: 'https://github.com/org/integration-tests.git',
      branch: 'main',
      buildTool: 'Maven',
      node: 'linux-agent-1',
      priority: 'High',
      notifyEmail: false,
      healthScore: 88,
      buildHistory: ['success','success','success','success','failed','success','success','success','success','success']
    },
    {
      id: 'job-005',
      name: 'docker-image-builder',
      type: 'Pipeline',
      description: 'Build and push Docker images to ECR registry',
      status: 'success',
      lastBuild: '30 minutes ago',
      buildNumber: 55,
      duration: '5m 38s',
      trigger: 'Upstream',
      repo: 'https://github.com/org/infra.git',
      branch: 'main',
      buildTool: 'Shell',
      node: 'docker-agent',
      priority: 'Normal',
      notifyEmail: false,
      healthScore: 95,
      buildHistory: ['success','success','success','success','success','success','success','success','success','success']
    },
    {
      id: 'job-006',
      name: 'nightly-regression',
      type: 'Freestyle',
      description: 'Full regression test suite, runs every night at 2 AM',
      status: 'unstable',
      lastBuild: '8 hours ago',
      buildNumber: 301,
      duration: '45m 22s',
      trigger: 'Scheduled',
      repo: 'https://github.com/org/regression.git',
      branch: 'main',
      buildTool: 'Maven',
      node: 'linux-agent-3',
      priority: 'Normal',
      notifyEmail: true,
      healthScore: 62,
      buildHistory: ['success','unstable','success','unstable','unstable','success','success','unstable','success','unstable']
    },
    {
      id: 'job-007',
      name: 'security-scan',
      type: 'Pipeline',
      description: 'OWASP dependency check and static code analysis',
      status: 'success',
      lastBuild: '3 hours ago',
      buildNumber: 19,
      duration: '8m 14s',
      trigger: 'Scheduled',
      repo: 'https://github.com/org/security.git',
      branch: 'main',
      buildTool: 'Gradle',
      node: 'linux-agent-2',
      priority: 'High',
      notifyEmail: true,
      healthScore: 90,
      buildHistory: ['success','success','success','failed','success','success','success','success','success','success']
    },
    {
      id: 'job-008',
      name: 'infra-terraform-plan',
      type: 'Freestyle',
      description: 'Terraform plan and apply for cloud infrastructure',
      status: 'disabled',
      lastBuild: '2 days ago',
      buildNumber: 7,
      duration: '2m 01s',
      trigger: 'Manual',
      repo: 'https://github.com/org/terraform.git',
      branch: 'main',
      buildTool: 'Shell',
      node: 'built-in',
      priority: 'Low',
      notifyEmail: false,
      healthScore: 100,
      buildHistory: ['success','success','success','success','success','success','success']
    }
  ];

  const BUILD_QUEUE = [
    { name: 'backend-api-build', wait: '~30s', reason: 'Waiting for executor' },
    { name: 'security-scan', wait: '~2m', reason: 'Waiting for linux-agent-2' },
    { name: 'nightly-regression', wait: '~5m', reason: 'Pending upstream job' }
  ];

  const EXECUTORS = [
    { name: 'built-in', label: 'Controller Node', status: 'Idle', load: 0 },
    { name: 'linux-agent-1', label: 'Linux Agent #1', status: 'Busy - backend-api-build #142', load: 85 },
    { name: 'linux-agent-2', label: 'Linux Agent #2', status: 'Busy - frontend-react-deploy #78', load: 60 },
    { name: 'linux-agent-3', label: 'Linux Agent #3', status: 'Idle', load: 10 },
    { name: 'docker-agent', label: 'Docker Agent', status: 'Idle', load: 0 },
    { name: 'windows-agent', label: 'Windows Agent', status: 'Offline', load: 0 }
  ];

  function loadJobs() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        return DEFAULT_JOBS.slice();
      }
    }
    return DEFAULT_JOBS.slice();
  }

  function saveJobs(jobs) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  }

  function getJobs() {
    return loadJobs();
  }

  function getJob(id) {
    return loadJobs().find(j => j.id === id);
  }

  function createJob(data) {
    const jobs = loadJobs();
    const newJob = {
      id: 'job-' + Date.now(),
      name: data.name,
      type: data.type || 'Freestyle',
      description: data.description || '',
      status: 'aborted',
      lastBuild: 'Never',
      buildNumber: 0,
      duration: 'N/A',
      trigger: data.trigger || 'Manual',
      repo: data.repo || '',
      branch: data.branch || 'main',
      buildTool: data.buildTool || 'Maven',
      node: data.node || 'built-in',
      priority: data.priority || 'Normal',
      notifyEmail: data.notifyEmail || false,
      healthScore: 100,
      buildHistory: []
    };
    jobs.unshift(newJob);
    saveJobs(jobs);
    return newJob;
  }

  function updateJob(id, data) {
    const jobs = loadJobs();
    const idx = jobs.findIndex(j => j.id === id);
    if (idx === -1) return null;
    jobs[idx] = Object.assign(jobs[idx], {
      name: data.name,
      type: data.type,
      description: data.description,
      trigger: data.trigger,
      repo: data.repo,
      branch: data.branch,
      buildTool: data.buildTool,
      node: data.node,
      priority: data.priority,
      notifyEmail: data.notifyEmail
    });
    saveJobs(jobs);
    return jobs[idx];
  }

  function deleteJob(id) {
    const jobs = loadJobs().filter(j => j.id !== id);
    saveJobs(jobs);
  }

  function triggerBuild(id) {
    const jobs = loadJobs();
    const idx = jobs.findIndex(j => j.id === id);
    if (idx === -1) return;
    if (jobs[idx].status === 'disabled') return;
    jobs[idx].status = 'running';
    jobs[idx].buildNumber += 1;
    jobs[idx].lastBuild = 'Just now';
    jobs[idx].duration = '0m 01s (running)';
    saveJobs(jobs);

    // Simulate build completion after 4 seconds
    setTimeout(function () {
      const jobs2 = loadJobs();
      const idx2 = jobs2.findIndex(j => j.id === id);
      if (idx2 === -1) return;
      const outcomes = ['success', 'success', 'success', 'failed', 'unstable'];
      const result = outcomes[Math.floor(Math.random() * outcomes.length)];
      const secs = Math.floor(Math.random() * 300) + 30;
      jobs2[idx2].status = result;
      jobs2[idx2].lastBuild = 'Just now';
      jobs2[idx2].duration = Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
      if (!jobs2[idx2].buildHistory) jobs2[idx2].buildHistory = [];
      jobs2[idx2].buildHistory.push(result);
      if (jobs2[idx2].buildHistory.length > 10) jobs2[idx2].buildHistory.shift();
      // Update health score
      const hist = jobs2[idx2].buildHistory;
      const successCount = hist.filter(h => h === 'success').length;
      jobs2[idx2].healthScore = Math.round((successCount / hist.length) * 100);
      saveJobs(jobs2);
    }, 4000);
  }

  function toggleDisable(id) {
    const jobs = loadJobs();
    const idx = jobs.findIndex(j => j.id === id);
    if (idx === -1) return;
    if (jobs[idx].status === 'disabled') {
      jobs[idx].status = 'aborted';
    } else if (jobs[idx].status !== 'running') {
      jobs[idx].status = 'disabled';
    }
    saveJobs(jobs);
    return jobs[idx];
  }

  function getQueue() {
    return BUILD_QUEUE;
  }

  function getExecutors() {
    return EXECUTORS;
  }

  function getBuildTrend() {
    const days = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const label = (d.getMonth() + 1) + '/' + d.getDate();
      const outcomes = ['success', 'success', 'success', 'failed', 'unstable'];
      const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
      const height = Math.floor(Math.random() * 70) + 30;
      days.push({ label, outcome, height });
    }
    return days;
  }

  function resetToDefaults() {
    saveJobs(DEFAULT_JOBS.slice());
  }

  return {
    getJobs,
    getJob,
    createJob,
    updateJob,
    deleteJob,
    triggerBuild,
    toggleDisable,
    getQueue,
    getExecutors,
    getBuildTrend,
    resetToDefaults
  };
})();

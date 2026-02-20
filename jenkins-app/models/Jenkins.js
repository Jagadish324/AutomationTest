'use strict';

/**
 * Jenkins Model
 * =============
 * Wraps all Jenkins REST API calls.
 * API calls run server-side → no CORS issues.
 *
 * All job-facing methods accept a `fullPath` parameter which
 * is the slash-separated job name, e.g. "TeamA/Frontend/deploy".
 * Internally this is converted to the /job/TeamA/job/Frontend/job/deploy
 * URL structure that Jenkins uses for nested folders.
 */

const axios = require('axios');
const https = require('https');
const { getConfig } = require('../config/jenkins');

/* ── Status helpers ──────────────────────────────── */
const COLOR_STATUS = {
  blue:           'success',
  blue_anime:     'running',
  red:            'failed',
  red_anime:      'running',
  yellow:         'unstable',
  yellow_anime:   'running',
  grey:           'aborted',
  grey_anime:     'running',
  disabled:       'disabled',
  disabled_anime: 'running',
  notbuilt:       'aborted',
  notbuilt_anime: 'running',
  aborted:        'aborted',
  aborted_anime:  'running'
};

function colorToStatus(color) {
  return COLOR_STATUS[(color || '').toLowerCase()] || 'unknown';
}

function fmtDuration(ms) {
  if (!ms) return 'N/A';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtRelative(ts) {
  if (!ts) return 'Never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return 'Just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function xmlEscape(s) {
  return String(s || '').replace(/[<>&"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])
  );
}

function enc(s) { return encodeURIComponent(s); }

/* ── Jenkins API client ──────────────────────────── */
class JenkinsClient {
  constructor() {
    this._crumb = null;
  }

  /* Build an axios instance with auth configured */
  _http() {
    const cfg = getConfig();
    return axios.create({
      baseURL:        cfg.url.replace(/\/$/, ''),
      auth:           { username: cfg.username, password: cfg.token },
      timeout:        15000,
      httpsAgent:     new https.Agent({ rejectUnauthorized: false }),
      maxRedirects:   0,
      validateStatus: s => s < 400 || s === 302 || s === 303
    });
  }

  /**
   * Convert a slash-separated full path to a Jenkins REST API URL segment.
   * e.g. "TeamA/Frontend/deploy" → "/job/TeamA/job/Frontend/job/deploy"
   */
  _jobUrl(fullPath) {
    if (!fullPath) return '';
    return '/' + fullPath.split('/').map(s => `job/${enc(s)}`).join('/');
  }

  /** Returns true when a Jenkins _class string represents a folder */
  _isFolder(cls) {
    const c = (cls || '').toLowerCase();
    return c.includes('folder') || c.includes('organizationfolder');
  }

  /* Fetch CSRF crumb (cached per instance restart) */
  async _crumbHeaders() {
    if (this._crumb) return { [this._crumb.field]: this._crumb.value };
    try {
      const res   = await this._http().get('/crumbIssuer/api/json');
      this._crumb = { field: res.data.crumbRequestField, value: res.data.crumb };
      return { [this._crumb.field]: this._crumb.value };
    } catch (_) {
      return {}; // CSRF may be disabled on this Jenkins
    }
  }

  /* ── Connection ─────────────────────────────── */

  async testConnection() {
    const res = await this._http().get('/api/json?tree=nodeName,version');
    return res.data;
  }

  /* ── Jobs (top-level list) ───────────────────── */

  async getJobs() {
    const tree = [
      'jobs[name,_class,color,buildable,description,url,',
      'lastBuild[number,duration,timestamp,result],',
      'healthReport[score,description]]'
    ].join('');
    const res = await this._http().get(`/api/json?tree=${encodeURIComponent(tree)}`);
    return (res.data.jobs || []).map(j => ({
      ...this._transformJob(j),
      fullPath: j.name,
      isFolder: this._isFolder(j._class)
    }));
  }

  /**
   * Fetch the contents of a folder (or root when folderPath is empty).
   * Returns { name, description, _class, isFolder, jobs: [...] }
   * Each job in the list has fullPath set (parentPath/childName).
   */
  async getFolderContents(folderPath) {
    const tree = [
      '_class,name,description,',
      'jobs[name,_class,color,buildable,description,url,',
      'lastBuild[number,duration,timestamp,result],',
      'healthReport[score,description]]'
    ].join('');
    const base = folderPath ? this._jobUrl(folderPath) : '';
    const res  = await this._http().get(`${base}/api/json?tree=${encodeURIComponent(tree)}`);
    const d    = res.data;
    return {
      name:        d.name        || 'Jenkins',
      description: d.description || '',
      _class:      d._class      || '',
      isFolder:    this._isFolder(d._class),
      jobs: (d.jobs || []).map(j => ({
        ...this._transformJob(j),
        fullPath: folderPath ? `${folderPath}/${j.name}` : j.name,
        isFolder: this._isFolder(j._class)
      }))
    };
  }

  /** Fetch a single job's full detail, including build history */
  async getJob(fullPath) {
    const tree = [
      'name,_class,color,buildable,description,url,',
      'builds[number,result,duration,timestamp]{0,15},',
      'healthReport[score,description],',
      'lastBuild[number,duration,timestamp,result]'
    ].join('');
    const res  = await this._http().get(
      `${this._jobUrl(fullPath)}/api/json?tree=${encodeURIComponent(tree)}`
    );
    const j    = res.data;
    const base = this._transformJob(j);
    return {
      ...base,
      fullPath,
      healthDesc: (j.healthReport || []).map(h => h.description).join('; ') || '—',
      builds: (j.builds || []).map(b => ({
        number:    b.number,
        result:    (b.result || 'RUNNING').toLowerCase(),
        duration:  fmtDuration(b.duration),
        timestamp: fmtRelative(b.timestamp)
      }))
    };
  }

  _transformJob(j) {
    const lb     = j.lastBuild || {};
    const health = (j.healthReport || [])[0] || {};
    const status = colorToStatus(j.color);
    return {
      name:        j.name,
      type:        this._guessType(j),
      description: j.description || '',
      status,
      lastBuild:   fmtRelative(lb.timestamp),
      buildNumber: lb.number   || 0,
      duration:    status === 'running' ? 'Running…' : fmtDuration(lb.duration),
      healthScore: health.score != null ? health.score : 100,
      buildable:   j.buildable !== false
    };
  }

  _guessType(j) {
    const cls = (j._class || '').toLowerCase();
    if (cls.includes('multibranch'))                          return 'Multibranch';
    if (cls.includes('pipeline') || cls.includes('workflow')) return 'Pipeline';
    if (cls.includes('maven'))                                return 'Maven';
    if (cls.includes('folder'))                               return 'Folder';
    return 'Freestyle';
  }

  /* ── Console output ─────────────────────────── */

  async getConsoleOutput(fullPath, buildNumber) {
    const res = await this._http().get(
      `${this._jobUrl(fullPath)}/${buildNumber}/consoleText`,
      { headers: { Accept: 'text/plain' }, responseType: 'text' }
    );
    return res.data;
  }

  /* ── Build actions ──────────────────────────── */

  async triggerBuild(fullPath) {
    const crumb = await this._crumbHeaders();
    await this._http().post(`${this._jobUrl(fullPath)}/build`, null, { headers: crumb });
  }

  async disableJob(fullPath) {
    const crumb = await this._crumbHeaders();
    await this._http().post(`${this._jobUrl(fullPath)}/disable`, null, { headers: crumb });
  }

  async enableJob(fullPath) {
    const crumb = await this._crumbHeaders();
    await this._http().post(`${this._jobUrl(fullPath)}/enable`, null, { headers: crumb });
  }

  async deleteJob(fullPath) {
    const crumb = await this._crumbHeaders();
    await this._http().post(`${this._jobUrl(fullPath)}/doDelete`, null, { headers: crumb });
  }

  /* ── Create / Update jobs ───────────────────── */

  /**
   * Create a new job.
   * @param {string} name       - Job name (single segment, no slashes)
   * @param {object} formData   - Form fields including optional `folder` (parent path)
   */
  async createJob(name, formData) {
    const crumb      = await this._crumbHeaders();
    const xml        = this.buildConfigXML(formData);
    const parentPath = (formData.folder || '').trim();
    const base       = parentPath ? this._jobUrl(parentPath) : '';
    await this._http().post(
      `${base}/createItem?name=${enc(name)}`,
      xml,
      { headers: { ...crumb, 'Content-Type': 'application/xml' } }
    );
  }

  async updateJob(fullPath, formData) {
    const crumb = await this._crumbHeaders();
    const xml   = this.buildConfigXML(formData);
    await this._http().post(
      `${this._jobUrl(fullPath)}/config.xml`,
      xml,
      { headers: { ...crumb, 'Content-Type': 'application/xml' } }
    );
  }

  buildConfigXML(d) {
    const desc   = xmlEscape(d.description || '');
    const repo   = xmlEscape(d.repo || '');
    const branch = xmlEscape(d.branch || 'main');

    const scmBlock = repo
      ? `<scm class="hudson.plugins.git.GitSCM" plugin="git@latest">
    <configVersion>2</configVersion>
    <userRemoteConfigs>
      <hudson.plugins.git.UserRemoteConfig><url>${repo}</url></hudson.plugins.git.UserRemoteConfig>
    </userRemoteConfigs>
    <branches>
      <hudson.plugins.git.BranchSpec><name>*/${branch}</name></hudson.plugins.git.BranchSpec>
    </branches>
  </scm>`
      : '<scm class="hudson.scm.NullSCM"/>';

    const triggerMap = {
      'SCM Poll':  '<hudson.triggers.SCMTrigger><spec>H/5 * * * *</spec></hudson.triggers.SCMTrigger>',
      'Scheduled': '<hudson.triggers.TimerTrigger><spec>H 2 * * *</spec></hudson.triggers.TimerTrigger>'
    };
    const triggerBlock = triggerMap[d.trigger] || '';

    const buildCmd = { Maven: 'mvn clean package', Gradle: './gradlew clean build',
      npm: 'npm install && npm test', Make: 'make', Ant: 'ant',
      Shell: '#!/bin/bash\necho "Build"' }[d.buildTool] || 'echo "Build"';

    if (d.type === 'Pipeline') {
      return `<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job@latest">
  <description>${desc}</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps@latest">
    ${scmBlock}
    <scriptPath>Jenkinsfile</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers>${triggerBlock}</triggers>
</flow-definition>`;
    }

    if (d.type === 'Folder') {
      return `<?xml version='1.1' encoding='UTF-8'?>
<com.cloudbees.hudson.plugins.folder.Folder plugin="cloudbees-folder@latest">
  <description>${desc}</description>
  <views>
    <hudson.model.AllView><owner class="com.cloudbees.hudson.plugins.folder.Folder" reference="../../.."/><name>All</name><filterExecutors>false</filterExecutors><filterQueue>false</filterQueue><properties class="hudson.model.View$PropertyList"/></hudson.model.AllView>
  </views>
  <viewsTabBar class="hudson.views.DefaultViewsTabBar"/>
</com.cloudbees.hudson.plugins.folder.Folder>`;
    }

    return `<?xml version='1.1' encoding='UTF-8'?>
<project>
  <description>${desc}</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  ${scmBlock}
  <triggers>${triggerBlock}</triggers>
  <builders>
    <hudson.tasks.Shell><command>${xmlEscape(buildCmd)}</command></hudson.tasks.Shell>
  </builders>
  <publishers/>
  <buildWrappers/>
</project>`;
  }

  /* ── Queue & Executors ──────────────────────── */

  async getQueue() {
    const res = await this._http().get(
      `/queue/api/json?tree=${encodeURIComponent('items[id,task[name],why,timestamp]')}`
    );
    return (res.data.items || []).map(i => ({
      name:  i.task ? i.task.name : 'Unknown',
      why:   i.why || 'Waiting',
      since: fmtRelative(i.timestamp)
    }));
  }

  async getExecutors() {
    const tree = 'computer[displayName,description,offline,offlineCauseReason,numExecutors,' +
                 'executors[currentExecutable[fullDisplayName,number,url]],assignedLabels[name]]';
    const res  = await this._http().get(`/computer/api/json?tree=${encodeURIComponent(tree)}`);
    return (res.data.computer || []).map(node => {
      const busy  = (node.executors || []).filter(e => e.currentExecutable).length;
      const total = node.numExecutors || 1;
      return {
        name:         node.displayName,
        description:  node.description || '',
        offline:      node.offline,
        offlineCause: node.offlineCauseReason || '',
        busy, total,
        load:    Math.round((busy / total) * 100),
        status:  node.offline ? 'Offline' : busy > 0 ? `Building (${busy}/${total})` : 'Idle',
        labels:  (node.assignedLabels || []).map(l => l.name).filter(n => n && n !== node.displayName),
        currentBuilds: (node.executors || [])
          .filter(e => e.currentExecutable)
          .map(e => ({ name: e.currentExecutable.fullDisplayName, url: e.currentExecutable.url }))
      };
    });
  }

  async getNode(nodeName) {
    const apiName = (nodeName === 'master' || nodeName === 'Built-In Node') ? '(master)' : nodeName;
    const tree    = 'displayName,description,offline,offlineCauseReason,numExecutors,' +
                    'executors[currentExecutable[fullDisplayName,number,url,timestamp,estimatedDuration]],' +
                    'assignedLabels[name]';
    const res  = await this._http().get(`/computer/${enc(apiName)}/api/json?tree=${encodeURIComponent(tree)}`);
    const n    = res.data;
    const busy  = (n.executors || []).filter(e => e.currentExecutable).length;
    const total = n.numExecutors || 1;
    return {
      name:         n.displayName,
      description:  n.description || '',
      offline:      n.offline,
      offlineCause: n.offlineCauseReason || '',
      busy, total,
      load:    Math.round((busy / total) * 100),
      status:  n.offline ? 'Offline' : busy > 0 ? `Building (${busy}/${total})` : 'Idle',
      labels:  (n.assignedLabels || []).map(l => l.name).filter(nm => nm && nm !== n.displayName),
      currentBuilds: (n.executors || [])
        .filter(e => e.currentExecutable)
        .map(e => ({
          name:  e.currentExecutable.fullDisplayName,
          url:   e.currentExecutable.url,
          since: fmtRelative(e.currentExecutable.timestamp),
          eta:   fmtDuration(e.currentExecutable.estimatedDuration)
        }))
    };
  }
}

module.exports = new JenkinsClient();

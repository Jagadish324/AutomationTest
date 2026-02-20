'use strict';

/**
 * Jenkins Model
 * =============
 * Wraps all Jenkins REST API calls.
 * API calls run server-side → no CORS issues.
 */

const axios = require('axios');
const https = require('https');
const { getConfig } = require('../config/jenkins');

/* ── Status helpers ──────────────────────────────── */
const COLOR_STATUS = {
  blue:          'success',
  blue_anime:    'running',
  red:           'failed',
  red_anime:     'running',
  yellow:        'unstable',
  yellow_anime:  'running',
  grey:          'aborted',
  grey_anime:    'running',
  disabled:      'disabled',
  disabled_anime:'running',
  notbuilt:      'aborted',
  notbuilt_anime:'running',
  aborted:       'aborted',
  aborted_anime: 'running'
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

/* ── Jenkins API client ──────────────────────────── */
class JenkinsClient {
  constructor() {
    this._crumb = null;
  }

  /* Build an axios instance with auth configured */
  _http() {
    const cfg = getConfig();
    return axios.create({
      baseURL:      cfg.url.replace(/\/$/, ''),
      auth:         { username: cfg.username, password: cfg.token },
      timeout:      15000,
      httpsAgent:   new https.Agent({ rejectUnauthorized: false }),
      maxRedirects: 0,
      validateStatus: s => s < 400 || s === 302 || s === 303
    });
  }

  /* Fetch CSRF crumb (cached per instance restart) */
  async _crumbHeaders() {
    if (this._crumb) return { [this._crumb.field]: this._crumb.value };
    try {
      const res  = await this._http().get('/crumbIssuer/api/json');
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

  /* ── Jobs ───────────────────────────────────── */

  async getJobs() {
    const tree = [
      'jobs[name,_class,color,buildable,description,url,',
      'lastBuild[number,duration,timestamp,result],',
      'healthReport[score,description]]'
    ].join('');
    const res = await this._http().get(`/api/json?tree=${encodeURIComponent(tree)}`);
    return (res.data.jobs || []).map(j => this._transformJob(j));
  }

  async getJob(name) {
    const tree = [
      'name,_class,color,buildable,description,url,',
      'builds[number,result,duration,timestamp]{0,15},',
      'healthReport[score,description],',
      'lastBuild[number,duration,timestamp,result]'
    ].join('');
    const res = await this._http().get(
      `/job/${enc(name)}/api/json?tree=${encodeURIComponent(tree)}`
    );
    const j   = res.data;
    const base = this._transformJob(j);
    return {
      ...base,
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

  async getConsoleOutput(name, buildNumber) {
    const res = await this._http().get(
      `/job/${enc(name)}/${buildNumber}/consoleText`,
      { headers: { Accept: 'text/plain' }, responseType: 'text' }
    );
    return res.data;
  }

  /* ── Build actions ──────────────────────────── */

  async triggerBuild(name) {
    const crumb = await this._crumbHeaders();
    await this._http().post(`/job/${enc(name)}/build`, null, { headers: crumb });
  }

  async disableJob(name) {
    const crumb = await this._crumbHeaders();
    await this._http().post(`/job/${enc(name)}/disable`, null, { headers: crumb });
  }

  async enableJob(name) {
    const crumb = await this._crumbHeaders();
    await this._http().post(`/job/${enc(name)}/enable`, null, { headers: crumb });
  }

  async deleteJob(name) {
    const crumb = await this._crumbHeaders();
    await this._http().post(`/job/${enc(name)}/doDelete`, null, { headers: crumb });
  }

  /* ── Create / Update jobs ───────────────────── */

  async createJob(name, formData) {
    const crumb = await this._crumbHeaders();
    const xml   = this.buildConfigXML(formData);
    await this._http().post(
      `/createItem?name=${encodeURIComponent(name)}`,
      xml,
      { headers: { ...crumb, 'Content-Type': 'application/xml' } }
    );
  }

  async updateJob(name, formData) {
    const crumb = await this._crumbHeaders();
    const xml   = this.buildConfigXML(formData);
    await this._http().post(
      `/job/${enc(name)}/config.xml`,
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
    const tree = 'computer[displayName,offline,numExecutors,executors[currentExecutable[fullDisplayName]]]';
    const res  = await this._http().get(`/computer/api/json?tree=${encodeURIComponent(tree)}`);
    return (res.data.computer || []).map(node => {
      const busy  = (node.executors || []).filter(e => e.currentExecutable).length;
      const total = node.numExecutors || 1;
      return {
        name:    node.displayName,
        offline: node.offline,
        busy, total,
        load:    Math.round((busy / total) * 100),
        status:  node.offline ? 'Offline' : busy > 0 ? `Building (${busy}/${total})` : 'Idle'
      };
    });
  }
}

function enc(s) { return encodeURIComponent(s); }

module.exports = new JenkinsClient();

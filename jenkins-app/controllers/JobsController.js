'use strict';

const Jenkins       = require('../models/Jenkins');
const JenkinsConfig = require('../config/jenkins');

/* ── Helpers ────────────────────────────────────── */

/**
 * Build a breadcrumb array from a slash-separated full path.
 * e.g. "TeamA/Frontend/deploy" →
 *   [ { name:'TeamA', path:'TeamA' },
 *     { name:'Frontend', path:'TeamA/Frontend' },
 *     { name:'deploy', path:'TeamA/Frontend/deploy' } ]
 */
function buildBreadcrumb(fullPath) {
  return fullPath.split('/').map((name, i, parts) => ({
    name,
    path: parts.slice(0, i + 1).join('/')
  }));
}

/**
 * Encode each path segment for use in a URL, preserving slashes.
 * e.g. "TeamA/My Job" → "TeamA/My%20Job"
 */
function urlPath(fullPath) {
  return fullPath.split('/').map(encodeURIComponent).join('/');
}

/** Extract the full job path from regex route params (req.params[0]) */
function jobPath(req) {
  return req.params[0] || req.params.name || '';
}

/* ── Controller ─────────────────────────────────── */

const JobsController = {

  /* GET /jobs */
  async index(req, res) {
    if (!JenkinsConfig.isConfigured()) {
      req.flash('warning', 'Jenkins is not configured. Please set up connection settings.');
      return res.redirect('/settings');
    }

    let jobs = [];
    try {
      jobs = await Jenkins.getJobs();
    } catch (err) {
      req.flash('error', `Could not load jobs: ${err.message}`);
    }

    // Filter by status
    const { status, q } = req.query;
    if (status && status !== 'all') jobs = jobs.filter(j => j.status === status);
    if (q) {
      const lq = q.toLowerCase();
      jobs = jobs.filter(j =>
        j.name.toLowerCase().includes(lq) || j.description.toLowerCase().includes(lq)
      );
    }

    const allJobs = await Jenkins.getJobs().catch(() => []);
    const counts  = {
      all:      allJobs.length,
      success:  allJobs.filter(j => j.status === 'success').length,
      failed:   allJobs.filter(j => j.status === 'failed').length,
      running:  allJobs.filter(j => j.status === 'running').length,
      unstable: allJobs.filter(j => j.status === 'unstable').length,
      disabled: allJobs.filter(j => j.status === 'disabled').length
    };

    res.render('jobs/index', {
      title:         'Jobs',
      jobs,
      counts,
      currentStatus: status || 'all',
      currentQ:      q || '',
      urlPath
    });
  },

  /* GET /jobs/new  (accepts ?folder=ParentPath) */
  new(req, res) {
    if (!JenkinsConfig.isConfigured()) return res.redirect('/settings');
    const folder = req.query.folder || '';
    const breadcrumb = folder ? buildBreadcrumb(folder) : [];
    res.render('jobs/form', {
      title:     'New Job',
      job:       null,
      folder,
      breadcrumb,
      action:    '/jobs',
      method:    'POST'
    });
  },

  /* POST /jobs */
  async create(req, res) {
    const { name, folder, ...rest } = req.body;
    if (!name || !name.trim()) {
      req.flash('error', 'Job name is required.');
      return res.render('jobs/form', {
        title:  'New Job',
        job:    req.body,
        folder: folder || '',
        breadcrumb: folder ? buildBreadcrumb(folder) : [],
        action: '/jobs',
        method: 'POST'
      });
    }
    try {
      await Jenkins.createJob(name.trim(), req.body);
      req.flash('success', `Job "${name}" created successfully.`);
      // Redirect back to the parent folder or the top-level list
      const dest = folder ? `/jobs/${urlPath(folder)}` : '/jobs';
      res.redirect(dest);
    } catch (err) {
      req.flash('error', `Failed to create job: ${err.message}`);
      res.render('jobs/form', {
        title:  'New Job',
        job:    req.body,
        folder: folder || '',
        breadcrumb: folder ? buildBreadcrumb(folder) : [],
        action: '/jobs',
        method: 'POST'
      });
    }
  },

  /**
   * GET /jobs/*
   * Detects whether the path points to a Folder or a Job and renders accordingly.
   */
  async show(req, res) {
    const fullPath = jobPath(req);
    try {
      // Fetch item + its children (works for both jobs and folders)
      const info = await Jenkins.getFolderContents(fullPath);

      if (info.isFolder) {
        // ── Folder view ──────────────────────────────
        const breadcrumb = buildBreadcrumb(fullPath);
        return res.render('jobs/folder', {
          title:     info.name,
          folder:    info,
          fullPath,
          urlPath:   urlPath(fullPath),
          breadcrumb,
          urlPathFn: urlPath
        });
      }

      // ── Job detail view ──────────────────────────
      const job        = await Jenkins.getJob(fullPath);
      const breadcrumb = buildBreadcrumb(fullPath);
      res.render('jobs/show', {
        title:     job.name,
        job,
        fullPath,
        urlPath:   urlPath(fullPath),
        breadcrumb
      });
    } catch (err) {
      req.flash('error', `Could not load: ${err.message}`);
      res.redirect('/jobs');
    }
  },

  /* GET /jobs/*/edit */
  async edit(req, res) {
    const fullPath = jobPath(req);
    try {
      const job        = await Jenkins.getJob(fullPath);
      const breadcrumb = buildBreadcrumb(fullPath);
      // Parent folder = everything except the last segment
      const parts  = fullPath.split('/');
      const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      res.render('jobs/form', {
        title:     `Edit: ${job.name}`,
        job,
        folder,
        breadcrumb,
        action:    `/jobs/${urlPath(fullPath)}?_method=PUT`,
        method:    'POST'
      });
    } catch (err) {
      req.flash('error', `Could not load job: ${err.message}`);
      res.redirect('/jobs');
    }
  },

  /* PUT /jobs/* */
  async update(req, res) {
    const fullPath = jobPath(req);
    try {
      await Jenkins.updateJob(fullPath, req.body);
      req.flash('success', `Job "${fullPath}" updated.`);
      res.redirect(`/jobs/${urlPath(fullPath)}`);
    } catch (err) {
      const parts  = fullPath.split('/');
      const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      req.flash('error', `Update failed: ${err.message}`);
      res.render('jobs/form', {
        title:  `Edit: ${parts[parts.length - 1]}`,
        job:    { name: parts[parts.length - 1], ...req.body },
        folder,
        breadcrumb: buildBreadcrumb(fullPath),
        action: `/jobs/${urlPath(fullPath)}?_method=PUT`,
        method: 'POST'
      });
    }
  },

  /* DELETE /jobs/* */
  async destroy(req, res) {
    const fullPath = jobPath(req);
    // Parent folder to redirect back to after deletion
    const parts    = fullPath.split('/');
    const parent   = parts.length > 1 ? `/jobs/${urlPath(parts.slice(0, -1).join('/'))}` : '/jobs';
    try {
      await Jenkins.deleteJob(fullPath);
      req.flash('success', `"${fullPath}" deleted.`);
    } catch (err) {
      req.flash('error', `Delete failed: ${err.message}`);
    }
    res.redirect(parent);
  },

  /* POST /jobs/*/build */
  async build(req, res) {
    const fullPath = jobPath(req);
    try {
      await Jenkins.triggerBuild(fullPath);
      req.flash('success', `Build triggered for "${fullPath}".`);
    } catch (err) {
      req.flash('error', `Build trigger failed: ${err.message}`);
    }
    res.redirect(req.get('Referer') || `/jobs/${urlPath(fullPath)}`);
  },

  /* POST /jobs/*/disable */
  async disable(req, res) {
    const fullPath = jobPath(req);
    try {
      await Jenkins.disableJob(fullPath);
      req.flash('info', `Job "${fullPath}" disabled.`);
    } catch (err) {
      req.flash('error', `Disable failed: ${err.message}`);
    }
    res.redirect(req.get('Referer') || '/jobs');
  },

  /* POST /jobs/*/enable */
  async enable(req, res) {
    const fullPath = jobPath(req);
    try {
      await Jenkins.enableJob(fullPath);
      req.flash('success', `Job "${fullPath}" enabled.`);
    } catch (err) {
      req.flash('error', `Enable failed: ${err.message}`);
    }
    res.redirect(req.get('Referer') || '/jobs');
  },

  /* GET /jobs/*/builds/:num/console */
  async console(req, res) {
    const fullPath = jobPath(req);
    const num      = req.params[1];
    try {
      const output = await Jenkins.getConsoleOutput(fullPath, num);
      res.render('jobs/console', {
        title:  `Console: ${fullPath} #${num}`,
        name:   fullPath,
        num,
        output
      });
    } catch (err) {
      req.flash('error', `Could not fetch console: ${err.message}`);
      res.redirect(`/jobs/${urlPath(fullPath)}`);
    }
  }
};

module.exports = JobsController;

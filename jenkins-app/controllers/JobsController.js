'use strict';

const Jenkins       = require('../models/Jenkins');
const JenkinsConfig = require('../config/jenkins');

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
      title: 'Jobs',
      jobs,
      counts,
      currentStatus: status || 'all',
      currentQ:      q || ''
    });
  },

  /* GET /jobs/new */
  new(req, res) {
    if (!JenkinsConfig.isConfigured()) return res.redirect('/settings');
    res.render('jobs/form', { title: 'New Job', job: null, action: '/jobs', method: 'POST' });
  },

  /* POST /jobs */
  async create(req, res) {
    const { name, ...rest } = req.body;
    if (!name || !name.trim()) {
      req.flash('error', 'Job name is required.');
      return res.render('jobs/form', {
        title: 'New Job', job: req.body, action: '/jobs', method: 'POST'
      });
    }
    try {
      await Jenkins.createJob(name.trim(), req.body);
      req.flash('success', `Job "${name}" created successfully.`);
      res.redirect('/jobs');
    } catch (err) {
      req.flash('error', `Failed to create job: ${err.message}`);
      res.render('jobs/form', { title: 'New Job', job: req.body, action: '/jobs', method: 'POST' });
    }
  },

  /* GET /jobs/:name */
  async show(req, res) {
    try {
      const job = await Jenkins.getJob(req.params.name);
      res.render('jobs/show', { title: job.name, job });
    } catch (err) {
      req.flash('error', `Could not load job: ${err.message}`);
      res.redirect('/jobs');
    }
  },

  /* GET /jobs/:name/edit */
  async edit(req, res) {
    try {
      const job = await Jenkins.getJob(req.params.name);
      res.render('jobs/form', {
        title:  `Edit: ${job.name}`,
        job,
        action: `/jobs/${encodeURIComponent(job.name)}?_method=PUT`,
        method: 'POST'
      });
    } catch (err) {
      req.flash('error', `Could not load job: ${err.message}`);
      res.redirect('/jobs');
    }
  },

  /* PUT /jobs/:name  (via _method=PUT) */
  async update(req, res) {
    const { name } = req.params;
    try {
      await Jenkins.updateJob(name, req.body);
      req.flash('success', `Job "${name}" updated.`);
      res.redirect(`/jobs/${encodeURIComponent(name)}`);
    } catch (err) {
      req.flash('error', `Update failed: ${err.message}`);
      res.render('jobs/form', {
        title: `Edit: ${name}`, job: { name, ...req.body },
        action: `/jobs/${encodeURIComponent(name)}?_method=PUT`, method: 'POST'
      });
    }
  },

  /* DELETE /jobs/:name  (via _method=DELETE) */
  async destroy(req, res) {
    const { name } = req.params;
    try {
      await Jenkins.deleteJob(name);
      req.flash('success', `Job "${name}" deleted.`);
    } catch (err) {
      req.flash('error', `Delete failed: ${err.message}`);
    }
    res.redirect('/jobs');
  },

  /* POST /jobs/:name/build */
  async build(req, res) {
    const { name } = req.params;
    try {
      await Jenkins.triggerBuild(name);
      req.flash('success', `Build triggered for "${name}".`);
    } catch (err) {
      req.flash('error', `Build trigger failed: ${err.message}`);
    }
    res.redirect(req.get('Referer') || `/jobs/${encodeURIComponent(name)}`);
  },

  /* POST /jobs/:name/disable */
  async disable(req, res) {
    const { name } = req.params;
    try {
      await Jenkins.disableJob(name);
      req.flash('info', `Job "${name}" disabled.`);
    } catch (err) {
      req.flash('error', `Disable failed: ${err.message}`);
    }
    res.redirect(req.get('Referer') || '/jobs');
  },

  /* POST /jobs/:name/enable */
  async enable(req, res) {
    const { name } = req.params;
    try {
      await Jenkins.enableJob(name);
      req.flash('success', `Job "${name}" enabled.`);
    } catch (err) {
      req.flash('error', `Enable failed: ${err.message}`);
    }
    res.redirect(req.get('Referer') || '/jobs');
  },

  /* GET /jobs/:name/builds/:num/console */
  async console(req, res) {
    const { name, num } = req.params;
    try {
      const output = await Jenkins.getConsoleOutput(name, num);
      res.render('jobs/console', { title: `Console: ${name} #${num}`, name, num, output });
    } catch (err) {
      req.flash('error', `Could not fetch console: ${err.message}`);
      res.redirect(`/jobs/${encodeURIComponent(name)}`);
    }
  }
};

module.exports = JobsController;

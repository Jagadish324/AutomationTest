'use strict';

const Jenkins       = require('../models/Jenkins');
const JenkinsConfig = require('../config/jenkins');

const DashboardController = {

  async index(req, res) {
    const configured = JenkinsConfig.isConfigured();
    let jobs = [], queue = [], executors = [], error = null;

    if (configured) {
      try {
        [jobs, queue, executors] = await Promise.all([
          Jenkins.getJobs(),
          Jenkins.getQueue(),
          Jenkins.getExecutors()
        ]);
      } catch (err) {
        error = err.message;
        req.flash('error', `Jenkins connection failed: ${err.message}`);
      }
    }

    const running  = jobs.filter(j => j.status === 'running').length;
    const success  = jobs.filter(j => j.status === 'success').length;
    const failed   = jobs.filter(j => j.status === 'failed').length;
    const unstable = jobs.filter(j => j.status === 'unstable').length;
    const disabled = jobs.filter(j => j.status === 'disabled').length;
    const built    = jobs.filter(j => j.buildNumber > 0).length;
    const passRate = built > 0 ? Math.round((success / built) * 100) : 0;

    res.render('dashboard/index', {
      title:      'Dashboard',
      configured,
      error,
      jobs:       jobs.slice(0, 10),
      queue,
      executors,
      stats: { total: jobs.length, running, success, failed, unstable, disabled, passRate }
    });
  }
};

module.exports = DashboardController;

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
          Jenkins.getAllJobsFlat(),
          Jenkins.getQueue(),
          Jenkins.getExecutors()
        ]);
      } catch (err) {
        error = err.message;
        req.flash('error', `Jenkins connection failed: ${err.message}`);
      }
    }

    // Separate actual buildable jobs from folder containers for stats
    const buildableJobs = jobs.filter(j => !j.isFolder);
    const folderCount   = jobs.filter(j =>  j.isFolder).length;

    const running  = buildableJobs.filter(j => j.status === 'running').length;
    const success  = buildableJobs.filter(j => j.status === 'success').length;
    const failed   = buildableJobs.filter(j => j.status === 'failed').length;
    const unstable = buildableJobs.filter(j => j.status === 'unstable').length;
    const disabled = buildableJobs.filter(j => j.status === 'disabled').length;
    const built    = buildableJobs.filter(j => j.buildNumber > 0).length;
    const passRate = built > 0 ? Math.round((success / built) * 100) : 0;

    const nodesOnline  = executors.filter(n => !n.offline).length;
    const nodesOffline = executors.filter(n =>  n.offline).length;

    res.render('dashboard/index', {
      title:      'Dashboard',
      configured,
      error,
      jobs,
      queue,
      executors,
      stats: {
        total: buildableJobs.length, folders: folderCount, buildable: buildableJobs.length,
        running, success, failed, unstable, disabled, passRate,
        nodes: executors.length, nodesOnline, nodesOffline
      }
    });
  }
};

module.exports = DashboardController;

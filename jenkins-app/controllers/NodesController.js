'use strict';

const Jenkins       = require('../models/Jenkins');
const JenkinsConfig = require('../config/jenkins');

const NodesController = {

  async index(req, res) {
    const configured = JenkinsConfig.isConfigured();
    let nodes = [], error = null;

    if (configured) {
      try {
        nodes = await Jenkins.getExecutors();
      } catch (err) {
        error = err.message;
        req.flash('error', `Jenkins connection failed: ${err.message}`);
      }
    }

    const online         = nodes.filter(n => !n.offline).length;
    const offline        = nodes.filter(n =>  n.offline).length;
    const busyTotal      = nodes.reduce((s, n) => s + n.busy,  0);
    const executorTotal  = nodes.reduce((s, n) => s + n.total, 0);

    res.render('nodes/index', {
      title:      'Nodes',
      configured,
      error,
      nodes,
      stats: { total: nodes.length, online, offline, busy: busyTotal, executorTotal }
    });
  },

  async show(req, res) {
    const nodeName   = req.params[0];
    const configured = JenkinsConfig.isConfigured();
    let node = null, error = null;

    if (configured) {
      try {
        node = await Jenkins.getNode(nodeName);
      } catch (err) {
        error = err.message;
        req.flash('error', `Failed to load node: ${err.message}`);
      }
    }

    res.render('nodes/show', {
      title:     node ? `Node: ${node.name}` : 'Node',
      configured,
      error,
      node,
      nodeName
    });
  }
};

module.exports = NodesController;

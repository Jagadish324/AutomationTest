'use strict';

const Jenkins       = require('../models/Jenkins');
const JenkinsConfig = require('../config/jenkins');

const SettingsController = {

  /* GET /settings */
  index(req, res) {
    res.render('settings/index', {
      title:      'Connection Settings',
      config:     JenkinsConfig.getConfig(),
      configured: JenkinsConfig.isConfigured()
    });
  },

  /* POST /settings */
  async save(req, res) {
    const { url, username, token } = req.body;
    if (!url || !username || !token) {
      req.flash('error', 'All fields (URL, Username, Token) are required.');
      return res.redirect('/settings');
    }
    JenkinsConfig.saveConfig({ url: url.trim(), username: username.trim(), token: token.trim() });
    req.flash('success', 'Connection settings saved. Testing connection…');
    try {
      await Jenkins.testConnection();
      req.flash('success', 'Connected to Jenkins successfully!');
    } catch (err) {
      req.flash('warning', `Settings saved but connection test failed: ${err.message}`);
    }
    res.redirect('/settings');
  },

  /* POST /settings/test  → returns JSON (called via fetch from browser) */
  async test(req, res) {
    const { url, username, token } = req.body;
    if (!url || !username || !token) {
      return res.json({ ok: false, message: 'URL, username and token are required.' });
    }
    // Temporarily override config for test only
    const prev = JenkinsConfig.getConfig();
    JenkinsConfig.saveConfig({ url, username, token });
    try {
      const info = await Jenkins.testConnection();
      res.json({ ok: true, message: `Connected! Jenkins ${info.version || ''} · Node: ${info.nodeName || '—'}` });
    } catch (err) {
      res.json({ ok: false, message: err.message });
    } finally {
      JenkinsConfig.saveConfig(prev); // restore original
    }
  },

  /* POST /settings/disconnect */
  disconnect(req, res) {
    const fs   = require('fs');
    const path = require('path');
    const cfg  = path.join(__dirname, '..', 'jenkins.config.json');
    if (fs.existsSync(cfg)) fs.unlinkSync(cfg);
    req.flash('info', 'Disconnected from Jenkins.');
    res.redirect('/settings');
  }
};

module.exports = SettingsController;

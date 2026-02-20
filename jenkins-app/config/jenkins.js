'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'jenkins.config.json');

function getConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) {}
  }
  return {
    url:      process.env.JENKINS_URL      || '',
    username: process.env.JENKINS_USERNAME || '',
    token:    process.env.JENKINS_TOKEN    || ''
  };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function isConfigured() {
  const c = getConfig();
  return !!(c.url && c.username && c.token);
}

module.exports = { getConfig, saveConfig, isConfigured };

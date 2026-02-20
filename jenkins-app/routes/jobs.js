'use strict';

const express = require('express');
const router  = express.Router();
const c       = require('../controllers/JobsController');
const { requireLogin, requireDeveloper, requireAdmin } = require('../middleware/auth');

// Role matrix:
//  Viewer    — GET /jobs, GET /jobs/:path, console
//  Developer — + new, create, edit, update, build, disable, enable
//  Admin     — + delete

// ── Static / top-level routes ────────────────────────
router.get( '/',    requireLogin,                   c.index);
router.get( '/new', requireLogin, requireDeveloper, c.new);
router.post('/',    requireLogin, requireDeveloper, c.create);

// ── Multi-segment action routes (regex) ──────────────
router.get( /^\/(.+)\/edit$/,                    requireLogin, requireDeveloper, c.edit);
router.get( /^\/(.+)\/builds\/(\d+)\/console$/,  requireLogin,                  c.console);

router.post(/^\/(.+)\/build$/,                   requireLogin, requireDeveloper, c.build);
router.post(/^\/(.+)\/disable$/,                 requireLogin, requireDeveloper, c.disable);
router.post(/^\/(.+)\/enable$/,                  requireLogin, requireDeveloper, c.enable);

router.put(   /^\/(.+)$/,                        requireLogin, requireDeveloper, c.update);
router.delete(/^\/(.+)$/,                        requireLogin, requireAdmin,     c.destroy);

// ── Catch-all: show job detail OR browse folder ──────
router.get(/^\/(.+)$/, requireLogin, c.show);

module.exports = router;

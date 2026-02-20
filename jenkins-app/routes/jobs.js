'use strict';

const express = require('express');
const router  = express.Router();
const c       = require('../controllers/JobsController');

/*
 * Multi-level folder routing
 * ──────────────────────────
 * Job paths can span multiple segments, e.g. TeamA/Frontend/deploy.
 * Express string routes like /:name only capture one segment, so we use
 * regex routes that capture everything between /jobs/ and the action suffix.
 *
 * Route order matters — specific actions are declared before the catch-all show.
 */

// ── Static / top-level routes ────────────────────────
router.get( '/',     c.index);
router.get( '/new',  c.new);
router.post('/',     c.create);

// ── Multi-segment action routes (regex) ──────────────
// Capture group 0 = full job path,  group 1 = build number (console route)

router.get(/^\/(.+)\/edit$/,                    c.edit);
router.get(/^\/(.+)\/builds\/(\d+)\/console$/,  c.console);

router.post(/^\/(.+)\/build$/,                  c.build);
router.post(/^\/(.+)\/disable$/,                c.disable);
router.post(/^\/(.+)\/enable$/,                 c.enable);

router.put(   /^\/(.+)$/,                       c.update);
router.delete(/^\/(.+)$/,                       c.destroy);

// ── Catch-all: show job detail OR browse folder contents ──
router.get(/^\/(.+)$/, c.show);

module.exports = router;

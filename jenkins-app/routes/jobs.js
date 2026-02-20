'use strict';

const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/JobsController');

router.get('/',               controller.index);
router.get('/new',            controller.new);
router.post('/',              controller.create);

// Job detail / edit — must come before /:name/action routes
router.get('/:name',          controller.show);
router.get('/:name/edit',     controller.edit);
router.put('/:name',          controller.update);
router.delete('/:name',       controller.destroy);

// Build actions
router.post('/:name/build',   controller.build);
router.post('/:name/disable', controller.disable);
router.post('/:name/enable',  controller.enable);

// Console output
router.get('/:name/builds/:num/console', controller.console);

module.exports = router;

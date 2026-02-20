'use strict';

const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/SettingsController');

router.get('/',           controller.index);
router.post('/',          controller.save);
router.post('/test',      controller.test);
router.post('/disconnect', controller.disconnect);

module.exports = router;

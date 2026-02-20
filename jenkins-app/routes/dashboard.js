'use strict';

const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/DashboardController');

router.get('/', controller.index);

module.exports = router;

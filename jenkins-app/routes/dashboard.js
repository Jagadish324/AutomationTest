'use strict';

const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/DashboardController');
const { requireLogin } = require('../middleware/auth');

router.get('/', requireLogin, controller.index);

module.exports = router;

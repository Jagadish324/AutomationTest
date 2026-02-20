'use strict';

const express = require('express');
const router  = express.Router();
const c       = require('../controllers/NodesController');
const { requireLogin } = require('../middleware/auth');

router.get('/',         requireLogin, c.index);
router.get(/^\/(.+)$/, requireLogin, c.show);

module.exports = router;

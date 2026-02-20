'use strict';

const express = require('express');
const router  = express.Router();
const c       = require('../controllers/NodesController');

router.get('/',         c.index);
router.get(/^\/(.+)$/, c.show);

module.exports = router;

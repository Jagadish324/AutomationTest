'use strict';

const express = require('express');
const router  = express.Router();
const c       = require('../controllers/AuthController');

router.get( '/login',  c.showLogin);
router.post('/login',  c.login);
router.post('/logout', c.logout);

module.exports = router;

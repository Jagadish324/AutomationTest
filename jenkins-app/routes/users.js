'use strict';

const express = require('express');
const router  = express.Router();
const c       = require('../controllers/UsersController');
const { requireLogin, requireAdmin } = require('../middleware/auth');

// All user-management routes require login + admin role
router.use(requireLogin, requireAdmin);

router.get('/',          c.index);
router.get('/new',       c.newForm);
router.post('/',         c.create);
router.get('/:id/edit',  c.editForm);
router.put('/:id',       c.update);
router.delete('/:id',    c.destroy);

module.exports = router;

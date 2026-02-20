'use strict';

const UserStore = require('../config/users');

const ROLES = ['admin', 'developer', 'viewer'];

const UsersController = {

  // GET /users
  index(req, res) {
    const users = UserStore.loadUsers().map(u => ({ ...u, password: undefined }));
    res.render('users/index', { title: 'User Management', users, roles: ROLES });
  },

  // GET /users/new
  newForm(req, res) {
    res.render('users/form', { title: 'New User', user: null, roles: ROLES });
  },

  // POST /users
  create(req, res) {
    const { username, name, email, password, role } = req.body;
    if (!username || !password) {
      req.flash('error', 'Username and password are required.');
      return res.redirect('/users/new');
    }
    if (!ROLES.includes(role)) {
      req.flash('error', 'Invalid role selected.');
      return res.redirect('/users/new');
    }
    try {
      UserStore.createUser({ username, name, email, password, role });
      req.flash('success', `User "${username}" created successfully.`);
      res.redirect('/users');
    } catch (err) {
      req.flash('error', err.message);
      res.redirect('/users/new');
    }
  },

  // GET /users/:id/edit
  editForm(req, res) {
    const user = UserStore.findById(req.params.id);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/users'); }
    res.render('users/form', {
      title: `Edit User: ${user.name}`,
      user:  { ...user, password: '' },
      roles: ROLES
    });
  },

  // PUT /users/:id
  update(req, res) {
    const { name, email, password, role } = req.body;
    const user = UserStore.findById(req.params.id);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/users'); }

    // Guard: cannot demote the last admin
    if (user.role === 'admin' && role !== 'admin') {
      const adminCount = UserStore.loadUsers().filter(u => u.role === 'admin').length;
      if (adminCount === 1) {
        req.flash('error', 'Cannot change the role of the only admin account.');
        return res.redirect(`/users/${req.params.id}/edit`);
      }
    }
    try {
      UserStore.updateUser(req.params.id, {
        name,
        email,
        role,
        password: password || undefined
      });
      // Refresh session if the logged-in user edited themselves
      if (req.session.userId === req.params.id) {
        const updated = UserStore.findById(req.params.id);
        req.session.user = { id: updated.id, username: updated.username, name: updated.name, role: updated.role };
      }
      req.flash('success', 'User updated successfully.');
      res.redirect('/users');
    } catch (err) {
      req.flash('error', err.message);
      res.redirect(`/users/${req.params.id}/edit`);
    }
  },

  // DELETE /users/:id
  destroy(req, res) {
    const user = UserStore.findById(req.params.id);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/users'); }

    // Guard: cannot delete yourself
    if (user.id === req.session.userId) {
      req.flash('error', 'You cannot delete your own account.');
      return res.redirect('/users');
    }
    // Guard: cannot delete the last admin
    if (user.role === 'admin') {
      const adminCount = UserStore.loadUsers().filter(u => u.role === 'admin').length;
      if (adminCount === 1) {
        req.flash('error', 'Cannot delete the only admin account.');
        return res.redirect('/users');
      }
    }
    UserStore.deleteUser(req.params.id);
    req.flash('success', `User "${user.username}" deleted.`);
    res.redirect('/users');
  }
};

module.exports = UsersController;

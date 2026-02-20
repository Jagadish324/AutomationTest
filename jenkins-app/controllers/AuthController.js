'use strict';

const { findByUsername, verifyPassword } = require('../config/users');

const AuthController = {

  // GET /login
  showLogin(req, res) {
    if (req.session && req.session.userId) return res.redirect('/');
    res.render('auth/login', { title: 'Sign In', layout: 'auth/login-layout' });
  },

  // POST /login
  async login(req, res) {
    const { username, password } = req.body;
    if (!username || !password) {
      req.flash('error', 'Username and password are required.');
      return res.redirect('/login');
    }
    const user = findByUsername(username.trim());
    if (!user || !verifyPassword(password, user.password)) {
      req.flash('error', 'Invalid username or password.');
      return res.redirect('/login');
    }
    // Store minimal user info in session (not password)
    req.session.userId = user.id;
    req.session.user   = { id: user.id, username: user.username, name: user.name, role: user.role };
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(returnTo);
  },

  // POST /logout
  logout(req, res) {
    req.session.destroy(() => res.redirect('/login'));
  }
};

module.exports = AuthController;

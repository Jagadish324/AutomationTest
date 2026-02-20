'use strict';

const { findById } = require('../config/users');

/**
 * Require the request to have an authenticated session.
 * Attaches the fresh user record to res.locals.currentUser.
 */
function requireLogin(req, res, next) {
  if (req.session && req.session.userId) {
    const user = findById(req.session.userId);
    if (user) {
      res.locals.currentUser = user;
      return next();
    }
  }
  req.flash('error', 'Please sign in to continue.');
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

/**
 * Require the current user to have one of the given roles.
 * Must be used AFTER requireLogin (relies on res.locals.currentUser).
 */
function requireRole(...roles) {
  return (req, res, next) => {
    const user = res.locals.currentUser;
    if (user && roles.includes(user.role)) return next();
    res.status(403).render('errors/403', { title: 'Access Denied', layout: 'layout' });
  };
}

const requireAdmin     = requireRole('admin');
const requireDeveloper = requireRole('admin', 'developer');

module.exports = { requireLogin, requireRole, requireAdmin, requireDeveloper };

'use strict';

require('dotenv').config();

const express        = require('express');
const session        = require('express-session');
const flash          = require('connect-flash');
const methodOverride = require('method-override');
const ejsLayouts     = require('express-ejs-layouts');
const path           = require('path');

const app = express();

/* ── View engine ────────────────────────────────── */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set('layout', 'layout');

/* ── Middleware ─────────────────────────────────── */
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'jenkins-ui-dev-secret',
  resave:            false,
  saveUninitialized: true,
  cookie:            { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(flash());

/* ── Global template locals ─────────────────────── */
app.use((req, res, next) => {
  res.locals.flash   = {
    success: req.flash('success'),
    error:   req.flash('error'),
    info:    req.flash('info'),
    warning: req.flash('warning')
  };
  res.locals.currentPath = req.path;
  next();
});

/* ── Routes ─────────────────────────────────────── */
app.use('/',         require('./routes/dashboard'));
app.use('/jobs',     require('./routes/jobs'));
app.use('/settings', require('./routes/settings'));

/* ── 404 handler ────────────────────────────────── */
app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Page Not Found', layout: 'layout' });
});

/* ── Error handler ──────────────────────────────── */
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).render('errors/500', {
    title:   'Server Error',
    message: err.message,
    layout:  'layout'
  });
});

/* ── Start ──────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('  Jenkins UI (MVC)');
  console.log('  ─────────────────────────────────');
  console.log(`  http://localhost:${PORT}             Dashboard`);
  console.log(`  http://localhost:${PORT}/jobs        Job Management`);
  console.log(`  http://localhost:${PORT}/settings    Connection Settings`);
  console.log('');
});

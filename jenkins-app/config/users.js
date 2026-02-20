'use strict';

/**
 * User store — JSON file backed, no external DB required.
 * Passwords hashed with PBKDF2-SHA512 (Node built-in crypto, no extra deps).
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, '..', 'users.json');

/* ── Password helpers ─────────────────────────────── */

function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const derived = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  // timingSafeEqual prevents timing attacks
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

/* ── Persistence ──────────────────────────────────── */

function loadUsers() {
  if (fs.existsSync(USERS_FILE)) {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (_) {}
  }
  return [];
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

/* ── Queries ──────────────────────────────────────── */

function findById(id) {
  return loadUsers().find(u => u.id === id) || null;
}

function findByUsername(username) {
  return loadUsers().find(u => u.username === username) || null;
}

/* ── Mutations ────────────────────────────────────── */

function createUser({ username, name, email, password, role }) {
  const users = loadUsers();
  if (users.find(u => u.username === username.trim())) {
    throw new Error(`Username "${username}" is already taken.`);
  }
  const user = {
    id:        crypto.randomUUID(),
    username:  username.trim(),
    name:      (name || username).trim(),
    email:     (email || '').trim().toLowerCase(),
    password:  hashPassword(password),
    role:      role || 'viewer',
    createdAt: new Date().toISOString()
  };
  users.push(user);
  saveUsers(users);
  return user;
}

function updateUser(id, fields) {
  const users = loadUsers();
  const idx   = users.findIndex(u => u.id === id);
  if (idx === -1) throw new Error('User not found.');
  const updated = { ...users[idx] };
  if (fields.name  !== undefined) updated.name  = fields.name.trim();
  if (fields.email !== undefined) updated.email = fields.email.trim().toLowerCase();
  if (fields.role  !== undefined) updated.role  = fields.role;
  if (fields.password) updated.password = hashPassword(fields.password);
  users[idx] = updated;
  saveUsers(users);
  return updated;
}

function deleteUser(id) {
  saveUsers(loadUsers().filter(u => u.id !== id));
}

/* ── Seed ─────────────────────────────────────────── */

/**
 * Creates a default admin account if no users exist yet.
 * Called once at app startup.
 */
function seedAdmin() {
  if (loadUsers().length === 0) {
    const admin = {
      id:        crypto.randomUUID(),
      username:  'admin',
      name:      'Administrator',
      email:     'admin@example.com',
      password:  hashPassword('admin123'),
      role:      'admin',
      createdAt: new Date().toISOString()
    };
    saveUsers([admin]);
    console.log('  Default admin created  →  username: admin  /  password: admin123');
    console.log('  Change the password after first login!');
  }
}

module.exports = {
  loadUsers, findById, findByUsername,
  createUser, updateUser, deleteUser,
  verifyPassword, seedAdmin
};

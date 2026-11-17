'use strict';

const bcrypt = require('bcryptjs');
const { db, logActivity } = require('./db');

function hasAnyUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

function toPublicUser(row) {
  return { id: row.id, username: row.username, role: row.role, mustChangePassword: Boolean(row.must_change_password) };
}

function createFirstAdmin(username, password) {
  if (hasAnyUsers()) throw new Error('Setup has already been completed');
  if (!username || !password || password.length < 8) {
    throw new Error('Username and a password of at least 8 characters are required');
  }
  const hash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, 'admin');
  logActivity(username, 'first-run-setup');
  return { id: info.lastInsertRowid, username, role: 'admin' };
}

function verifyLogin(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    throw new Error('Invalid username or password');
  }
  logActivity(user.username, 'login');
  return toPublicUser(user);
}

function changePassword(userId, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    throw new Error('Current password is incorrect');
  }
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, userId);
  logActivity(user.username, 'change-password');
  return toPublicUser({ ...user, must_change_password: 0 });
}

// Which properties a front-desk account can see/manage on a shared
// workstation. Admins are always unrestricted — `listUsers()` reports that
// as `venueIds: null`, distinct from a front-desk account that genuinely
// has zero assigned yet (`venueIds: []`).
function getUserVenueIds(userId) {
  return db.prepare('SELECT venue_id FROM user_venues WHERE user_id = ?').all(userId).map((r) => r.venue_id);
}

function setUserVenues(userId, venueIds) {
  const ids = Array.isArray(venueIds) ? [...new Set(venueIds)] : [];
  const tx = db.transaction((ids) => {
    db.prepare('DELETE FROM user_venues WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT INTO user_venues (user_id, venue_id) VALUES (?, ?)');
    ids.forEach((venueId) => insert.run(userId, venueId));
  });
  tx(ids);
}

// Admin-only, and never targets an admin account (they're unrestricted by
// definition — assigning them specific venues would silently do nothing,
// so reject it rather than pretend it worked).
function updateUserVenues(actorUser, id, venueIds) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new Error('No such user');
  if (user.role === 'admin') throw new Error('Property managers already have access to every property');
  const ids = Array.isArray(venueIds) ? venueIds : [];
  setUserVenues(id, ids);
  logActivity(actorUser.username, 'set-user-venues', { username: user.username, venueIds: ids });
}

function listUsers() {
  const rows = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();
  return rows.map((r) => ({ ...r, venueIds: r.role === 'admin' ? null : getUserVenueIds(r.id) }));
}

// Admin-initiated reset — unlike changePassword, doesn't require knowing
// the old password. Deliberately can't target the actor's own account
// (they already have Settings → Change your password for that, which does
// require the current password — this path shouldn't be a way around it).
function resetPassword(actorUser, id, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters');
  }
  if (id === actorUser.id) {
    throw new Error('Use "Change your password" in Settings to change your own password.');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new Error('No such user');
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hash, id);
  logActivity(actorUser.username, 'reset-password', { username: user.username });
}

function createUser(actorUsername, { username, password, role, venueIds }) {
  if (!username || !password || password.length < 8) {
    throw new Error('Username and a password of at least 8 characters are required');
  }
  if (!['admin', 'frontdesk'].includes(role)) {
    throw new Error("Role must be 'admin' or 'frontdesk'");
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) throw new Error('That username already exists');

  const hash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, role);
  if (role === 'frontdesk' && Array.isArray(venueIds) && venueIds.length) {
    setUserVenues(info.lastInsertRowid, venueIds);
  }
  logActivity(actorUsername, 'create-user', { username, role });
  return { id: info.lastInsertRowid, username, role };
}

function deleteUser(actorUser, id) {
  if (id === actorUser.id) throw new Error('You cannot delete your own account while signed in');
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  db.prepare('DELETE FROM user_venues WHERE user_id = ?').run(id);
  if (user) logActivity(actorUser.username, 'delete-user', { username: user.username });
}

module.exports = {
  hasAnyUsers,
  createFirstAdmin,
  verifyLogin,
  changePassword,
  listUsers,
  createUser,
  deleteUser,
  resetPassword,
  getUserVenueIds,
  updateUserVenues
};

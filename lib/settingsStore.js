'use strict';

const { safeStorage } = require('electron');
const { db, getSetting, setSetting } = require('./db');

const DEFAULTS = {
  oauthBaseUrl: 'https://ruckus.cloud',
  apiBaseUrl: 'https://api.ruckus.cloud'
};

// The RUCKUS client secret used to be stored as plain text in the local
// sqlite settings table — anyone with filesystem/backup access to the
// machine could read it straight out. Encrypt it at rest via Electron's
// safeStorage (macOS Keychain / Windows DPAPI-backed) instead. Falls back to
// storing it as-is only if the OS has no encryption backend available
// (e.g. a Linux box with no keyring) — degraded but still functional.
const ENC_PREFIX = 'enc:v1:';

function encryptSecret(plain) {
  if (!plain) return '';
  if (!safeStorage.isEncryptionAvailable()) return plain;
  return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
}

function decryptSecret(stored) {
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plain-text value
  if (!safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return '';
  }
}

// A malicious or typo'd config-backup file (or a bad manual edit) pointing
// oauthBaseUrl/apiBaseUrl somewhere else would silently send the RUCKUS
// client_id/client_secret to that host on the next token exchange —
// effectively phishing the API credentials through a trusted-looking
// restore flow. Require https + an actual ruckus.cloud host.
function assertRuckusHost(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use https`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'ruckus.cloud' && !host.endsWith('.ruckus.cloud')) {
    throw new Error(`${label} must be a ruckus.cloud address (got "${host}")`);
  }
}

// Multiple properties ("venues" in RUCKUS's own terms) share this one local
// install — one row per venue, plus an `activeVenueId` setting pointing at
// whichever one the app is currently operating on. Every unit/resident/
// Wi-Fi handler elsewhere in the app is scoped by venueId already (it's a
// URL path segment on every RUCKUS Property Management call), so switching
// the active venue is enough to make the whole app "become" that property —
// nothing else needed to change to support this.
function mapVenueRow(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, dpskPoolId: row.dpsk_pool_id, networkSsid: row.network_ssid, createdAt: row.created_at };
}

function listVenues() {
  return db.prepare('SELECT * FROM venues ORDER BY name').all().map(mapVenueRow);
}

function getVenue(id) {
  return mapVenueRow(db.prepare('SELECT * FROM venues WHERE id = ?').get(id));
}

function addVenue({ id, name, dpskPoolId, networkSsid }) {
  if (!id || !name) throw new Error('A venue id and name are required');
  if (getVenue(id)) throw new Error('That venue has already been added');
  db.prepare('INSERT INTO venues (id, name, dpsk_pool_id, network_ssid) VALUES (?, ?, ?, ?)').run(
    id,
    name.trim(),
    (dpskPoolId || '').trim(),
    (networkSsid || '').trim()
  );
  // First venue added to a fresh install becomes the active one automatically.
  if (!getActiveVenueId()) setActiveVenueId(id);
}

function updateVenue(id, { name, dpskPoolId, networkSsid } = {}) {
  const venue = getVenue(id);
  if (!venue) throw new Error('No such venue');
  db.prepare('UPDATE venues SET name = ?, dpsk_pool_id = ?, network_ssid = ? WHERE id = ?').run(
    name !== undefined ? name.trim() : venue.name,
    dpskPoolId !== undefined ? dpskPoolId.trim() : venue.dpskPoolId,
    networkSsid !== undefined ? networkSsid.trim() : venue.networkSsid,
    id
  );
}

function removeVenue(id) {
  db.prepare('DELETE FROM venues WHERE id = ?').run(id);
  db.prepare('DELETE FROM user_venues WHERE venue_id = ?').run(id);
  if (getActiveVenueId() === id) {
    const remaining = listVenues();
    setSetting('activeVenueId', remaining.length ? remaining[0].id : '');
  }
}

function getActiveVenueId() {
  return getSetting('activeVenueId', '') || '';
}

function setActiveVenueId(id) {
  if (!getVenue(id)) throw new Error('No such venue');
  setSetting('activeVenueId', id);
}

function getActiveVenue() {
  const id = getActiveVenueId();
  return id ? getVenue(id) : null;
}

// The DPSK pool backing the active venue's Property Management Identity
// Group, and the Wi-Fi network name residents connect to — needed to
// create/edit passphrases and to build a Wi-Fi QR code. Not reliably
// discoverable via API from public docs, so the property manager sets these
// once per venue.
function getDpskPoolId() {
  const venue = getActiveVenue();
  return venue ? venue.dpskPoolId : '';
}

function setDpskPoolId(poolId) {
  const venue = getActiveVenue();
  if (venue) updateVenue(venue.id, { dpskPoolId: poolId });
}

function getNetworkSsid() {
  const venue = getActiveVenue();
  return venue ? venue.networkSsid : '';
}

function setNetworkSsid(ssid) {
  const venue = getActiveVenue();
  if (venue) updateVenue(venue.id, { networkSsid: ssid });
}

// Shared front-desk terminals stay signed in indefinitely otherwise. Default
// 10 minutes; 0 disables auto sign-out entirely.
const DEFAULT_IDLE_TIMEOUT_MINUTES = 10;

function getIdleTimeoutMinutes() {
  const raw = getSetting('idleTimeoutMinutes', null);
  if (raw === null || raw === '') return DEFAULT_IDLE_TIMEOUT_MINUTES;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_IDLE_TIMEOUT_MINUTES;
}

function setIdleTimeoutMinutes(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n < 0 || n > 480) {
    throw new Error('Idle sign-out must be between 0 (disabled) and 480 minutes');
  }
  setSetting('idleTimeoutMinutes', String(Math.round(n)));
}

function getRuckusConfig() {
  const rawSecret = getSetting('ruckusClientSecret', '') || '';
  const clientSecret = decryptSecret(rawSecret);
  // Transparently upgrade a pre-existing plain-text secret to encrypted
  // storage the first time it's read, so nothing has to be re-typed.
  if (clientSecret && rawSecret && !rawSecret.startsWith(ENC_PREFIX) && safeStorage.isEncryptionAvailable()) {
    setSetting('ruckusClientSecret', encryptSecret(clientSecret));
  }
  return {
    tenantId: cleanId(getSetting('ruckusTenantId', '')),
    clientId: cleanId(getSetting('ruckusClientId', '')),
    clientSecret,
    oauthBaseUrl: getSetting('ruckusOauthBaseUrl', DEFAULTS.oauthBaseUrl) || DEFAULTS.oauthBaseUrl,
    apiBaseUrl: getSetting('ruckusApiBaseUrl', DEFAULTS.apiBaseUrl) || DEFAULTS.apiBaseUrl
  };
}

function isRuckusConfigured() {
  const c = getRuckusConfig();
  return Boolean(c.tenantId && c.clientId && c.clientSecret);
}

// Tenant/client IDs are bare hex strings. Pasted values often carry a
// trailing "/" or whitespace (copied from a URL), which turns the OAuth URL
// into .../oauth2/token/<id>/ and yields a "token response did not include
// access_token" error — so normalize on the way in and out.
function cleanId(v) {
  return String(v || '').trim().replace(/^\/+|\/+$/g, '').trim();
}

function setRuckusConfig({ tenantId, clientId, clientSecret, oauthBaseUrl, apiBaseUrl }) {
  if (tenantId !== undefined) setSetting('ruckusTenantId', cleanId(tenantId));
  if (clientId !== undefined) setSetting('ruckusClientId', cleanId(clientId));
  // Only overwrite the secret if a new one was actually provided — lets the
  // Settings screen redisplay "configured" without round-tripping the secret.
  if (clientSecret !== undefined && clientSecret !== '') {
    setSetting('ruckusClientSecret', encryptSecret(clientSecret.trim()));
  }
  if (oauthBaseUrl !== undefined) {
    const url = (oauthBaseUrl || DEFAULTS.oauthBaseUrl).trim();
    assertRuckusHost(url, 'OAuth base URL');
    setSetting('ruckusOauthBaseUrl', url);
  }
  if (apiBaseUrl !== undefined) {
    const url = (apiBaseUrl || DEFAULTS.apiBaseUrl).trim();
    assertRuckusHost(url, 'API base URL');
    setSetting('ruckusApiBaseUrl', url);
  }
}

// App look-and-feel — app name, logo, and accent colors, purely cosmetic and
// local to this install (not a RUCKUS resource). Logo is stored as a data
// URI so it round-trips through the same local sqlite settings table as
// everything else, with no filesystem path/protocol handling needed.
const BRANDING_DEFAULTS = {
  appName: 'DwellLink',
  primaryColor: '#365d6c', // dark teal sampled from the shipped logo's icon — pairs with the RUCKUS-orange accent below (was a leftover unrelated green default before the rebrand)
  accentColor: '#fa8500', // RUCKUS orange
  logoDataUri: '',
  loginMessage: ''
};

const LOGIN_MESSAGE_MAX_LENGTH = 500;

function getBranding() {
  return {
    appName: getSetting('brandAppName', BRANDING_DEFAULTS.appName) || BRANDING_DEFAULTS.appName,
    primaryColor: getSetting('brandPrimaryColor', BRANDING_DEFAULTS.primaryColor) || BRANDING_DEFAULTS.primaryColor,
    accentColor: getSetting('brandAccentColor', BRANDING_DEFAULTS.accentColor) || BRANDING_DEFAULTS.accentColor,
    logoDataUri: getSetting('brandLogoDataUri', '') || '',
    loginMessage: getSetting('brandLoginMessage', '') || ''
  };
}

function setBranding({ appName, primaryColor, accentColor, logoDataUri, loginMessage } = {}) {
  if (appName !== undefined) setSetting('brandAppName', (appName || '').trim());
  if (primaryColor !== undefined) setSetting('brandPrimaryColor', (primaryColor || '').trim());
  if (accentColor !== undefined) setSetting('brandAccentColor', (accentColor || '').trim());
  // '' explicitly clears the logo (back to the default text-only brand).
  if (logoDataUri !== undefined) setSetting('brandLogoDataUri', logoDataUri || '');
  if (loginMessage !== undefined) {
    const trimmed = (loginMessage || '').trim();
    if (trimmed.length > LOGIN_MESSAGE_MAX_LENGTH) {
      throw new Error(`Login message must be ${LOGIN_MESSAGE_MAX_LENGTH} characters or fewer`);
    }
    setSetting('brandLoginMessage', trimmed);
  }
}

function resetBranding() {
  setSetting('brandAppName', '');
  setSetting('brandPrimaryColor', '');
  setSetting('brandAccentColor', '');
  setSetting('brandLogoDataUri', '');
  setSetting('brandLoginMessage', '');
}

// Which app version this local install last showed a "what's new" notice
// for — lets the app detect "I was just upgraded" on the next launch
// without comparing against anything remote. Shared across every staff
// account on this install (it describes the binary, not a user).
function getLastSeenAppVersion() {
  return getSetting('lastSeenAppVersion', '') || '';
}

function setLastSeenAppVersion(version) {
  setSetting('lastSeenAppVersion', version || '');
}

module.exports = {
  listVenues,
  getVenue,
  addVenue,
  updateVenue,
  removeVenue,
  getActiveVenueId,
  setActiveVenueId,
  getActiveVenue,
  getDpskPoolId,
  setDpskPoolId,
  getNetworkSsid,
  setNetworkSsid,
  getIdleTimeoutMinutes,
  setIdleTimeoutMinutes,
  getRuckusConfig,
  isRuckusConfigured,
  setRuckusConfig,
  getBranding,
  setBranding,
  resetBranding,
  getLastSeenAppVersion,
  setLastSeenAppVersion
};

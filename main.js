'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let currentUser = null; // single active session per running app instance

// This app was previously named "RUCKUS Property Portal" — Electron derives
// the local data folder (~/Library/Application Support/<productName>) from
// the product name, so renaming it to DwellLink would otherwise make the app
// look in a new, empty folder and silently orphan every real staff account,
// RUCKUS credential, and setting already on disk. One-time, idempotent: only
// copies over if the new location doesn't already have a database (so it
// never overwrites real DwellLink data on a second launch), and copies the
// WAL/SHM sidecar files too so no committed-but-not-yet-checkpointed writes
// are lost.
function migrateLegacyUserData() {
  const newDbPath = path.join(app.getPath('userData'), 'portal.sqlite3');
  if (fs.existsSync(newDbPath)) return;
  const oldDbPath = path.join(app.getPath('appData'), 'RUCKUS Property Portal', 'portal.sqlite3');
  if (!fs.existsSync(oldDbPath)) return;
  fs.mkdirSync(path.dirname(newDbPath), { recursive: true });
  fs.copyFileSync(oldDbPath, newDbPath);
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(oldDbPath + ext)) fs.copyFileSync(oldDbPath + ext, newDbPath + ext);
  }
  // The migrated settings still say the old product name (branding is a
  // stored setting, not just a default) — this migration IS the rebrand, so
  // carry the new name over too rather than leaving the old one behind.
  // Only touches it if it's still exactly the old literal default, so a
  // deliberately-different custom name someone set isn't clobbered.
  try {
    const Database = require('better-sqlite3');
    const db = new Database(newDbPath);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'brandAppName'").get();
    if (!row || row.value === 'RUCKUS Property Portal') {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('brandAppName', 'DwellLink') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run();
    }
    db.close();
  } catch {
    // best-effort — worst case the old name just needs to be changed once from Settings -> Appearance
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'DwellLink',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Defense in depth (electronjs.org/docs/latest/tutorial/security#13 / #14):
  // the app never legitimately navigates its main window away from its own
  // bundled index.html, or opens new browser windows — every external link
  // already goes through the vetted shell.openExternal IPC handlers above,
  // each of which validates the URL first. Blocking in-window navigation
  // and window.open() outright closes off what a renderer-side bug could
  // otherwise do with a URL (navigate to/open arbitrary content) without
  // costing any real functionality.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      console.log('[renderer]', message);
    });
  }
}

function requireAuth() {
  if (!currentUser) throw new Error('Not signed in');
  return currentUser;
}

function requireAdmin() {
  const user = requireAuth();
  if (user.role !== 'admin') throw new Error('Property manager access required');
  return user;
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      // Re-throw as a plain Error so the message survives the IPC boundary cleanly.
      throw new Error(err && err.message ? err.message : 'Something went wrong');
    }
  });
}

// A few audit-log entries log a whole request body/patch object for
// traceability (who created/changed what) — useful right up until that
// object happens to carry a Wi-Fi passphrase (CSV import's ownerPassphrase/
// guestPassphrase fields, or the Additional-Resident form's "raw JSON"
// advanced-override box, which can inject an arbitrary dpskPassphrase).
// Redact known passphrase-shaped fields before anything gets written to the
// local activity_log table, which any admin can read (and export) from the
// Audit Log tab — the log should show *that* a passphrase was set, not what
// it was.
const PASSPHRASE_LOG_FIELDS = ['ownerPassphrase', 'guestPassphrase', 'dpskPassphrase', 'passphrase'];
function redactPassphrases(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const key of PASSPHRASE_LOG_FIELDS) {
    if (out[key] !== undefined) out[key] = '[redacted]';
  }
  return out;
}

// This app was single-venue until multi-venue support was added — one
// global venueId/dpskPoolId/networkSsid setting instead of a `venues` table.
// Migrate that into a proper first venue row (rather than starting the user
// back at "no venue configured") the first time this runs post-upgrade.
// Best-effort name resolution via a live RUCKUS lookup; falls back to the
// bare id (renameable afterward from Settings) if RUCKUS isn't reachable/
// configured yet at this exact moment.
async function migrateLegacySingleVenue(settingsStore, discovery, getSettingFn) {
  if (settingsStore.listVenues().length > 0) return;
  const oldVenueId = getSettingFn('venueId', '');
  if (!oldVenueId) return;
  const oldDpskPoolId = getSettingFn('dpskPoolId', '') || '';
  const oldNetworkSsid = getSettingFn('networkSsid', '') || '';
  let name = oldVenueId;
  try {
    const venues = await discovery.listVenues();
    const match = Array.isArray(venues) ? venues.find((v) => v.id === oldVenueId) : null;
    if (match && match.name) name = match.name;
  } catch {
    // RUCKUS not reachable/configured right now — keep the bare id as a placeholder name
  }
  settingsStore.addVenue({ id: oldVenueId, name, dpskPoolId: oldDpskPoolId, networkSsid: oldNetworkSsid });
}

app.whenReady().then(async () => {
  migrateLegacyUserData();

  // Required after app is ready (uses app.getPath under the hood).
  const auth = require('./lib/auth');
  const settingsStore = require('./lib/settingsStore');
  const { logActivity, listActivity, getSetting } = require('./lib/db');
  const pm = require('./lib/ruckus/propertyManagement');
  const dpsk = require('./lib/ruckus/dpsk');
  const identityGroups = require('./lib/ruckus/identityGroups');
  const discovery = require('./lib/ruckus/discovery');
  const rClients = require('./lib/ruckus/clients');

  await migrateLegacySingleVenue(settingsStore, discovery, getSetting);

  function venueIdOrThrow() {
    const venueId = settingsStore.getActiveVenueId();
    if (!venueId) {
      throw new Error('No venue is configured yet. Add one from Settings (property manager) before managing units.');
    }
    // Defense in depth beyond the UI filtering — even if a front-desk
    // session's active venue somehow ends up outside their assigned set
    // (e.g. an admin edited their access mid-session), every unit/resident/
    // Wi-Fi call in the app funnels through this one function, so enforcing
    // it here alone is enough to block real data access.
    if (currentUser && currentUser.role === 'frontdesk') {
      const allowed = auth.getUserVenueIds(currentUser.id);
      if (!allowed.includes(venueId)) {
        throw new Error('You do not have access to the currently active property. Ask your property manager to switch to one of your assigned properties.');
      }
    }
    return venueId;
  }

  function dpskPoolIdOrThrow() {
    const poolId = settingsStore.getDpskPoolId();
    if (!poolId) {
      throw new Error('No DPSK Pool ID is configured yet. Set it from Settings (property manager) before managing residents/passphrases.');
    }
    return poolId;
  }

  // ---- Auth ----
  handle('auth:needsSetup', () => !auth.hasAnyUsers());
  handle('auth:setup', ({ username, password }) => {
    currentUser = auth.createFirstAdmin(username, password);
    return currentUser;
  });
  handle('auth:login', ({ username, password }) => {
    currentUser = auth.verifyLogin(username, password);
    // A shared workstation's globally "active" venue can be left pointed at
    // a property this front-desk account isn't assigned to (e.g. the
    // previous shift worked a different building). Auto-correct to one of
    // their own on sign-in rather than greeting them with an access error.
    if (currentUser.role === 'frontdesk') {
      const allowed = auth.getUserVenueIds(currentUser.id);
      if (allowed.length && !allowed.includes(settingsStore.getActiveVenueId())) {
        settingsStore.setActiveVenueId(allowed[0]);
      }
    }
    return currentUser;
  });
  handle('auth:logout', () => {
    if (currentUser) logActivity(currentUser.username, 'logout');
    currentUser = null;
    return true;
  });
  handle('auth:me', () => currentUser);
  handle('auth:changePassword', ({ currentPassword, newPassword }) => {
    const user = requireAuth();
    currentUser = auth.changePassword(user.id, currentPassword, newPassword);
    return currentUser;
  });

  // ---- Staff accounts (admin only) ----
  handle('users:list', () => {
    requireAdmin();
    return auth.listUsers();
  });
  handle('users:create', (payload) => {
    const admin = requireAdmin();
    return auth.createUser(admin.username, payload);
  });
  handle('users:delete', (id) => {
    const admin = requireAdmin();
    auth.deleteUser(admin, id);
    return true;
  });
  handle('users:resetPassword', ({ id, newPassword }) => {
    const admin = requireAdmin();
    auth.resetPassword(admin, id, newPassword);
    return true;
  });
  handle('users:setVenues', ({ id, venueIds }) => {
    const admin = requireAdmin();
    auth.updateUserVenues(admin, id, venueIds);
    return true;
  });

  // ---- Audit log (admin only — the detail column can include resident PII) ----
  handle('audit:list', () => {
    requireAdmin();
    return listActivity();
  });

  // ---- Settings ----
  handle('settings:get', () => {
    const user = requireAuth();
    const ruckus = settingsStore.getRuckusConfig();
    const allVenues = settingsStore.listVenues();
    // Front desk shouldn't even learn other properties exist, not just be
    // blocked from switching to them — filter the list itself, not just the
    // switcher UI. `null` from getUserVenueIds would mean "unrestricted" but
    // that's only ever returned for admins, who skip this filter entirely.
    const allowedIds = user.role === 'admin' ? null : auth.getUserVenueIds(user.id);
    const venues = allowedIds ? allVenues.filter((v) => allowedIds.includes(v.id)) : allVenues;
    let activeVenueId = settingsStore.getActiveVenueId();
    if (allowedIds && !allowedIds.includes(activeVenueId)) activeVenueId = '';
    return {
      activeVenueId,
      venues,
      idleTimeoutMinutes: settingsStore.getIdleTimeoutMinutes(),
      apiConfigured: settingsStore.isRuckusConfigured(),
      ruckus: {
        tenantId: ruckus.tenantId,
        clientId: ruckus.clientId,
        oauthBaseUrl: ruckus.oauthBaseUrl,
        apiBaseUrl: ruckus.apiBaseUrl,
        hasSecret: Boolean(ruckus.clientSecret)
      }
    };
  });

  // ---- Venues (multi-property support) — admin-only, since switching or
  // reconfiguring which property the whole app operates on is a significant
  // action, same tier as the rest of Settings. ----
  handle('venues:add', ({ id, name, dpskPoolId, networkSsid }) => {
    const admin = requireAdmin();
    settingsStore.addVenue({ id, name, dpskPoolId, networkSsid });
    logActivity(admin.username, 'add-venue', { id, name });
    return true;
  });
  handle('venues:update', ({ id, name, dpskPoolId, networkSsid }) => {
    const admin = requireAdmin();
    settingsStore.updateVenue(id, { name, dpskPoolId, networkSsid });
    logActivity(admin.username, 'update-venue', { id, name, dpskPoolId, networkSsid });
    return true;
  });
  handle('venues:remove', (id) => {
    const admin = requireAdmin();
    settingsStore.removeVenue(id);
    logActivity(admin.username, 'remove-venue', { id });
    return true;
  });
  handle('venues:setActive', (id) => {
    // Unlike add/update/remove (still admin-only — reconfiguring what a
    // property IS stays a Settings-tier action), switching which of your OWN
    // assigned properties is active is exactly what a front-desk account
    // managing more than one building needs to do day to day.
    const user = requireAuth();
    if (user.role !== 'admin' && !auth.getUserVenueIds(user.id).includes(id)) {
      throw new Error('You do not have access to that property');
    }
    settingsStore.setActiveVenueId(id);
    logActivity(user.username, 'set-active-venue', { id });
    return true;
  });
  handle('app:getVersion', () => app.getVersion());

  // "What's new" notice shown once per upgrade, right after sign-in. Purely
  // local version-comparison (settingsStore.lastSeenAppVersion vs.
  // app.getVersion()) so it fires exactly once per install per version,
  // regardless of which staff account signs in first. The release notes
  // text itself is best-effort — fetched from the same public GitHub
  // releases feed app:openUpdatePage points at (owner/repo read from the
  // packaged app-update.yml, not hardcoded) — and its absence never blocks
  // showing the notice; a fetch failure just means a blank body.
  handle('app:checkWhatsNew', async () => {
    const currentVersion = app.getVersion();
    if (!app.isPackaged) return { show: false, version: currentVersion };
    const lastSeen = settingsStore.getLastSeenAppVersion();
    if (!lastSeen || lastSeen === currentVersion) {
      settingsStore.setLastSeenAppVersion(currentVersion);
      return { show: false, version: currentVersion };
    }
    settingsStore.setLastSeenAppVersion(currentVersion);
    let notes = null;
    try {
      const yamlPath = path.join(process.resourcesPath, 'app-update.yml');
      const text = fs.readFileSync(yamlPath, 'utf8');
      const owner = (text.match(/^owner:\s*(.+)$/m) || [])[1];
      const repo = (text.match(/^repo:\s*(.+)$/m) || [])[1];
      if (owner && repo) {
        const res = await fetch(`https://api.github.com/repos/${owner.trim()}/${repo.trim()}/releases/tags/v${currentVersion}`, {
          headers: { Accept: 'application/vnd.github+json' }
        });
        if (res.ok) {
          const json = await res.json();
          notes = json.body || null;
        }
      }
    } catch {
      notes = null;
    }
    return { show: true, version: currentVersion, notes };
  });

  // Checks the configured update feed (package.json's build.publish — a
  // public GitHub Releases feed: electron-updater's GitHub provider reads
  // latest-mac.yml/latest.yml from whichever release is tagged "latest")
  // and reports back whether a newer version exists. Deliberately never
  // auto-downloads or
  // auto-installs: Squirrel.Mac's install step verifies the old and new
  // builds were signed with a consistent identity, which this app's current
  // ad-hoc/unsigned build can't satisfy — attempting a silent self-install
  // would likely just fail. Reporting "here's a newer version" and letting
  // the admin download/run it by hand (same as today) is what's actually
  // reliable without paying for real code signing.
  handle('app:checkForUpdates', async () => {
    requireAdmin();
    const currentVersion = app.getVersion();
    if (!app.isPackaged) {
      return { currentVersion, updateAvailable: false, error: 'Update checks only run in a packaged build, not in dev mode.' };
    }
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.autoDownload = false;
      const result = await autoUpdater.checkForUpdates();
      const latestVersion = result && result.updateInfo && result.updateInfo.version;
      return {
        currentVersion,
        updateAvailable: Boolean(latestVersion && latestVersion !== currentVersion),
        latestVersion: latestVersion || currentVersion
      };
    } catch (err) {
      return { currentVersion, updateAvailable: false, error: err.message };
    }
  });
  // Re-derives the URL to open itself rather than taking one from the
  // renderer — same "never open a URL the renderer hands us" discipline as
  // units:openResidentPortal above.
  //
  // Two wrong approaches tried before landing here, for the record:
  // (1) reading package.json's `build.publish` at runtime — doesn't work in
  //     a packaged app because electron-builder strips the `build` field
  //     (along with `scripts`/`devDependencies`) from the package.json it
  //     bundles, so this was always undefined in the real app.
  // (2) autoUpdater.getFeedURL() — confirmed live (hit on Windows:
  //     clicking "download update" just opened File Explorer) that this
  //     method is deprecated in the installed electron-updater version and
  //     literally returns the string "Deprecated. Do not use it." — handing
  //     that to shell.openExternal() is what opened Explorer, since Windows'
  //     ShellExecute falls back to a file-browser view for a string that
  //     isn't a recognizable URI.
  //
  // The actual reliable source: electron-builder generates app-update.yml
  // (owner/repo/provider) into the packaged app's resources directory at
  // build time from this same build.publish config — it's the file
  // electron-updater itself reads internally, so parsing it here keeps one
  // real source of truth instead of duplicating owner/repo as a second
  // hardcoded constant in this file.
  handle('app:openUpdatePage', async () => {
    requireAdmin();
    if (!app.isPackaged) throw new Error('Update checks only run in a packaged build, not in dev mode.');
    const yamlPath = path.join(process.resourcesPath, 'app-update.yml');
    let owner;
    let repo;
    try {
      const text = fs.readFileSync(yamlPath, 'utf8');
      owner = (text.match(/^owner:\s*(.+)$/m) || [])[1];
      repo = (text.match(/^repo:\s*(.+)$/m) || [])[1];
    } catch {
      throw new Error('No update feed is configured.');
    }
    if (!owner || !repo) throw new Error('No update feed is configured.');
    await shell.openExternal(`https://github.com/${owner.trim()}/${repo.trim()}/releases/latest`);
    return true;
  });
  handle('settings:setIdleTimeout', (minutes) => {
    const admin = requireAdmin();
    settingsStore.setIdleTimeoutMinutes(minutes);
    logActivity(admin.username, 'set-idle-timeout', { minutes });
    return true;
  });
  handle('settings:setRuckusConfig', (cfg) => {
    const admin = requireAdmin();
    settingsStore.setRuckusConfig(cfg || {});
    logActivity(admin.username, 'set-ruckus-config', { tenantId: cfg && cfg.tenantId });
    return true;
  });
  // No requireAuth() — branding (app name/logo/colors) has to apply on the
  // pre-login Setup/Sign-in screens too, and it isn't sensitive data.
  handle('settings:getBranding', () => {
    return settingsStore.getBranding();
  });
  handle('settings:setBranding', (branding) => {
    const admin = requireAdmin();
    // A logo is a data URI read client-side via FileReader; cap it here so a
    // huge image can't bloat the local sqlite db unbounded.
    if (branding && branding.logoDataUri && branding.logoDataUri.length > 2_000_000) {
      throw new Error('Logo image is too large — please use a smaller file (under ~1.5MB).');
    }
    settingsStore.setBranding(branding || {});
    logActivity(admin.username, 'set-branding', { appName: branding && branding.appName });
    return true;
  });
  handle('settings:resetBranding', () => {
    const admin = requireAdmin();
    settingsStore.resetBranding();
    logActivity(admin.username, 'reset-branding', {});
    return true;
  });
  // Unlike settings:get, this deliberately includes the real RUCKUS client
  // secret — the whole point of a config backup is a working restore, and a
  // secret-less file would just mean re-typing it by hand later. Admin-only,
  // and the renderer warns the file contains a credential before saving it.
  handle('settings:exportConfig', () => {
    const admin = requireAdmin();
    logActivity(admin.username, 'export-config', {});
    return {
      exportedAt: new Date().toISOString(),
      activeVenueId: settingsStore.getActiveVenueId(),
      venues: settingsStore.listVenues(),
      ruckus: settingsStore.getRuckusConfig(),
      branding: settingsStore.getBranding()
    };
  });
  handle('settings:importConfig', (config) => {
    const admin = requireAdmin();
    if (!config || typeof config !== 'object') throw new Error('That file doesn’t look like a valid config backup.');
    if (Array.isArray(config.venues)) {
      for (const v of config.venues) {
        if (!v || !v.id) continue;
        if (settingsStore.getVenue(v.id)) settingsStore.updateVenue(v.id, v);
        else settingsStore.addVenue(v);
      }
      if (config.activeVenueId && settingsStore.getVenue(config.activeVenueId)) {
        settingsStore.setActiveVenueId(config.activeVenueId);
      }
    } else if (config.venueId) {
      // Backup from before multi-venue support — a single flat venueId/
      // dpskPoolId/networkSsid instead of a venues array. Migrate it into
      // one venue entry (name unknown from the backup alone, so fall back
      // to the id — can be renamed afterward from Settings).
      const id = config.venueId;
      const venueConfig = { id, name: id, dpskPoolId: config.dpskPoolId, networkSsid: config.networkSsid };
      if (settingsStore.getVenue(id)) settingsStore.updateVenue(id, venueConfig);
      else settingsStore.addVenue(venueConfig);
    }
    if (config.ruckus) settingsStore.setRuckusConfig(config.ruckus);
    if (config.branding) settingsStore.setBranding(config.branding);
    logActivity(admin.username, 'import-config', {});
    return true;
  });

  // ---- Settings lookups (populate dropdowns instead of manual ID entry) ----
  handle('discovery:venues', async () => {
    requireAdmin();
    return discovery.listVenues();
  });
  handle('discovery:dpskPools', async () => {
    requireAdmin();
    return discovery.listDpskPools();
  });
  handle('discovery:wifiNetworks', async (venueId) => {
    requireAdmin();
    const all = await discovery.listWifiNetworks();
    if (!venueId) return all;
    return all.filter(
      (n) => Array.isArray(n.venueApGroups) && n.venueApGroups.some((g) => g.venueId === venueId)
    );
  });
  // Used to figure out which DPSK pool is actually linked to a given venue
  // (the venue's Identity Group -> its dpskPoolId), so Settings can mark the
  // right one "recommended" instead of the manager having to know which of
  // several tenant-wide pools belongs to this venue. Best-effort: returns
  // null if Property Management isn't set up or the lookup fails.
  handle('discovery:recommendedDpskPool', async (venueId) => {
    requireAdmin();
    if (!venueId) return null;
    try {
      const propertyConfig = await pm.getPropertyConfig(venueId);
      return await discovery.getRecommendedDpskPoolId(propertyConfig && propertyConfig.personaGroupId);
    } catch {
      return null;
    }
  });

  // ---- Units ----
  handle('units:list', async () => {
    requireAuth();
    return pm.listAllUnits(venueIdOrThrow());
  });
  handle('units:get', async (unitId) => {
    requireAuth();
    return pm.getUnit(venueIdOrThrow(), unitId);
  });
  // CONFIRMED live (captured from RUCKUS One's own "View Portal" button):
  // a unit's GET response already carries the resident's self-service portal
  // URL at `_links.residentPortal.href` (residence.ruckus.cloud, with a
  // signed `auth` token unique per unit — RUCKUS generates it server-side,
  // nothing to construct on our end). Only ever open that confirmed host.
  handle('units:openResidentPortal', async (url) => {
    requireAuth();
    if (typeof url !== 'string' || !url.startsWith('https://residence.ruckus.cloud/')) {
      throw new Error('Refusing to open an unrecognized URL.');
    }
    await shell.openExternal(url);
    return true;
  });
  // RUCKUS never syncs Unit.resident into the owner Identity's own
  // email/phoneNumber/displayName — confirmed live these are two genuinely
  // separate copies (a unit's resident info was correct and complete, but
  // the same identity's fields as seen on RUCKUS One's own Identity detail
  // page were still null). Best-effort keep the owner identity in step
  // whenever resident info is set, so that page shows the same contact info
  // property managers enter here.
  async function patchIdentityBestEffort(venueId, personaId, patch) {
    if (!personaId || !patch || !Object.keys(patch).length) return;
    try {
      const propertyConfig = await pm.getPropertyConfig(venueId);
      const identityGroupId = propertyConfig && propertyConfig.personaGroupId;
      if (!identityGroupId) return;
      await identityGroups.patchIdentity(identityGroupId, personaId, patch);
    } catch {
      // best-effort — the unit itself already saved fine either way
    }
  }

  async function syncOwnerIdentityContact(venueId, personaId, resident, extra) {
    if (!personaId) return;
    const patch = {};
    if (resident) {
      if (resident.name) patch.displayName = resident.name;
      if (resident.email) patch.email = resident.email;
      if (resident.phoneNumber) patch.phoneNumber = resident.phoneNumber;
    }
    if (extra) {
      if (extra.vlan !== undefined) patch.vlan = extra.vlan;
      if (extra.description !== undefined) patch.description = extra.description;
      if (extra.dpskPassphrase !== undefined) patch.dpskPassphrase = extra.dpskPassphrase;
    }
    await patchIdentityBestEffort(venueId, personaId, patch);
  }

  handle('units:create', async (body) => {
    const user = requireAuth();
    const venueId = venueIdOrThrow();
    const result = await pm.createUnit(venueId, body || {});
    logActivity(user.username, 'create-unit', { venueId, body: redactPassphrases(body) });
    // Unit creation is asynchronous (confirmed live: POST returns 202 with
    // only a requestId + a fetch link, not the full unit — no personaId yet)
    // — unlike most of this API's other synchronous PATCH/PUT calls. Poll
    // for it to resolve, then sync the owner (and, if configured, guest)
    // identity's contact/VLAN/description/passphrase, in the background so
    // "Create unit" doesn't hang waiting on it. A guest Wi-Fi slot may not
    // exist for every venue, so the guest sync only fires if the unit
    // actually has a guestPersonaId once it resolves.
    const fetchHref = result && result._links && result._links.fetch && result._links.fetch.href;
    const unitId = fetchHref ? fetchHref.split('/').pop() : result && result.id;
    if (unitId && body && body.resident) {
      (async () => {
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const unit = await pm.getUnit(venueId, unitId);
            if (unit && unit.personaId) {
              await syncOwnerIdentityContact(venueId, unit.personaId, body.resident, {
                vlan: body.ownerVlan,
                description: body.ownerDescription,
                dpskPassphrase: body.ownerPassphrase
              });
              if (unit.guestPersonaId) {
                await patchIdentityBestEffort(venueId, unit.guestPersonaId, {
                  vlan: body.guestVlan,
                  dpskPassphrase: body.guestPassphrase
                });
              }
              return;
            }
          } catch {
            // not resolved yet, keep polling
          }
        }
      })().catch(() => {});
    }
    return result;
  });
  handle('units:update', async ({ unitId, patch }) => {
    const user = requireAuth();
    const venueId = venueIdOrThrow();
    const result = await pm.updateUnit(venueId, unitId, patch || {});
    logActivity(user.username, 'update-unit', { venueId, unitId, patch });
    if (patch && patch.resident) {
      const unit = result && result.personaId ? result : await pm.getUnit(venueId, unitId);
      await syncOwnerIdentityContact(venueId, unit.personaId, patch.resident);
    }
    return result;
  });
  handle('units:delete', async (unitId) => {
    const admin = requireAdmin();
    const venueId = venueIdOrThrow();
    await pm.deleteUnit(venueId, unitId);
    logActivity(admin.username, 'delete-unit', { venueId, unitId });
    return true;
  });
  handle('units:setStatus', async ({ unitId, status }) => {
    const user = requireAuth();
    const venueId = venueIdOrThrow();
    if (!['ENABLED', 'DISABLED'].includes(status)) throw new Error("status must be 'ENABLED' or 'DISABLED'");
    const result = await pm.updateUnit(venueId, unitId, { status });
    logActivity(user.username, 'set-unit-status', { venueId, unitId, status });
    return result;
  });
  // Turnover in one action instead of several manual steps across two
  // screens: revoke the built-in owner+guest Wi-Fi (cuts off the departing
  // resident immediately, but keeps those slots intact/reversible for the
  // next tenant, same as identities:setRevoked elsewhere), fully remove+
  // delete every Additional Resident (those are genuinely gone, unlike the
  // owner/guest slots which are permanent structure reused by whoever moves
  // in next), and clear the resident-of-record so the unit is ready for new
  // contact info. Deliberately does NOT touch the unit's ENABLED/DISABLED
  // status — that's a separate concept (a vacant unit between tenants isn't
  // "suspended"); an admin can still suspend separately if actually needed.
  // Admin-only given the scope (revokes Wi-Fi, deletes residents, clears PII).
  handle('units:moveOut', async (unitId) => {
    const admin = requireAdmin();
    const venueId = venueIdOrThrow();
    const unit = await pm.getUnit(venueId, unitId);
    const propertyConfig = await pm.getPropertyConfig(venueId);
    const identityGroupId = propertyConfig && propertyConfig.personaGroupId;

    const result = { revoked: 0, removed: 0, errors: [] };

    for (const personaId of [unit.personaId, unit.guestPersonaId].filter(Boolean)) {
      try {
        await identityGroups.patchIdentity(identityGroupId, personaId, { revoked: true });
        result.revoked++;
      } catch (err) {
        result.errors.push(err.message);
      }
    }

    const linkedResult = await pm.queryUnitIdentities(venueId, {
      filters: { unitId },
      page: 1,
      pageSize: 100,
      sortOrder: 'ASC'
    });
    const linked = Array.isArray(linkedResult) ? linkedResult : linkedResult.data || linkedResult.content || [];
    for (const p of linked) {
      const personaId = p.personaId || p.id;
      try {
        await pm.removeIdentity(venueId, unitId, personaId);
        await identityGroups.deleteIdentity(identityGroupId, personaId).catch(() => {});
        result.removed++;
      } catch (err) {
        result.errors.push(err.message);
      }
    }

    await pm.updateUnit(venueId, unitId, { resident: { name: 'Vacant', email: '', phoneNumber: '' } });

    logActivity(admin.username, 'move-out', { venueId, unitId, ...result });
    return result;
  });
  handle('units:resendNotifications', async (unitIds) => {
    const user = requireAuth();
    const venueId = venueIdOrThrow();
    if (!Array.isArray(unitIds) || unitIds.length === 0) throw new Error('unitIds (array) is required');
    const result = await pm.resendUnitNotifications(venueId, unitIds);
    logActivity(user.username, 'resend-unit-notifications', { venueId, unitIds });
    return result || { ok: true };
  });
  handle('units:associateIdentity', async ({ unitId, identityId }) => {
    const user = requireAuth();
    const venueId = venueIdOrThrow();
    const result = await pm.associateIdentity(venueId, unitId, identityId);
    logActivity(user.username, 'associate-identity', { venueId, unitId, identityId });
    return result || { ok: true };
  });
  handle('units:removeIdentity', async ({ unitId, identityId }) => {
    const user = requireAuth();
    const venueId = venueIdOrThrow();
    await pm.removeIdentity(venueId, unitId, identityId);
    logActivity(user.username, 'remove-identity', { venueId, unitId, identityId });
    return true;
  });
  // "Additional Residents" (LINKED personas) live in the same place as the
  // unit's own owner persona: /identityGroups/{groupId}/identities/{id}, NOT
  // the DPSK API — confirmed live (see lib/ruckus/identityGroups.js). The
  // built-in owner/guest passphrase VALUE is still not directly viewable
  // (only VLAN + a few other fields), but for LINKED residents this endpoint
  // returns the full record, including the actual `dpskPassphrase` value.
  handle('units:residents', async (unitId) => {
    requireAuth();
    const venueId = venueIdOrThrow();
    const propertyConfig = await pm.getPropertyConfig(venueId);
    const identityGroupId = propertyConfig && propertyConfig.personaGroupId;

    // Confirmed live (captured from RUCKUS One's own web UI): `filters.unitId`
    // is a bare string, NOT an array — sending it as an array silently
    // matches nothing (no error, just an empty result) rather than failing.
    const linkedResult = await pm.queryUnitIdentities(venueId, {
      filters: { unitId },
      page: 1, // this endpoint is 1-indexed (confirmed: page:0 -> "Page must be positive")
      pageSize: 100,
      sortOrder: 'ASC'
    });
    const linked = Array.isArray(linkedResult) ? linkedResult : linkedResult.data || linkedResult.content || [];

    return Promise.all(
      linked.map(async (p) => {
        const personaId = p.personaId || p.id;
        try {
          const details = await identityGroups.getIdentity(identityGroupId, personaId);
          return { ...details, id: details.id || personaId };
        } catch (err) {
          return { id: personaId, error: err.message };
        }
      })
    );
  });

  // Venue-wide version of units:residents above — omitting the `unitId`
  // filter returns every LINKED (Additional Resident) association across the
  // whole property in one call (confirmed live), not just one unit's. Powers
  // the Directory tab's cross-unit search and expiring-soon list, so front
  // desk doesn't have to open each unit one by one to find a resident or
  // device. Capped at 500 like the audit log is capped at 1000 — a scope
  // decision for a single-property tool, not true pagination.
  handle('identities:listAll', async () => {
    requireAuth();
    const venueId = venueIdOrThrow();
    const propertyConfig = await pm.getPropertyConfig(venueId);
    const identityGroupId = propertyConfig && propertyConfig.personaGroupId;

    const linkedResult = await pm.queryUnitIdentities(venueId, {
      filters: {},
      page: 1,
      pageSize: 500,
      sortOrder: 'ASC'
    });
    const linked = Array.isArray(linkedResult) ? linkedResult : linkedResult.data || linkedResult.content || [];

    return Promise.all(
      linked.map(async (p) => {
        const personaId = p.personaId || p.id;
        try {
          const details = await identityGroups.getIdentity(identityGroupId, personaId);
          return { ...details, id: details.id || personaId, unitId: p.unitId };
        } catch (err) {
          return { id: personaId, unitId: p.unitId, error: err.message };
        }
      })
    );
  });

  // Directory, extended across every configured property instead of just the
  // active one — admin-only, since it's an N-times-the-API-calls operation
  // (one units list + one identities list per property) and the results are
  // only actionable by someone who can also switch the active venue to jump
  // to a result. Each property's own failure (e.g. RUCKUS transiently
  // unreachable) is isolated to that property's entry rather than failing
  // the whole request.
  handle('directory:listAllVenues', async () => {
    requireAdmin();
    const venues = settingsStore.listVenues();
    return Promise.all(
      venues.map(async (venue) => {
        try {
          const [units, propertyConfig] = await Promise.all([pm.listAllUnits(venue.id), pm.getPropertyConfig(venue.id)]);
          const identityGroupId = propertyConfig && propertyConfig.personaGroupId;

          const linkedResult = await pm.queryUnitIdentities(venue.id, {
            filters: {},
            page: 1,
            pageSize: 500,
            sortOrder: 'ASC'
          });
          const linked = Array.isArray(linkedResult) ? linkedResult : linkedResult.data || linkedResult.content || [];
          const residents = await Promise.all(
            linked.map(async (p) => {
              const personaId = p.personaId || p.id;
              try {
                const details = await identityGroups.getIdentity(identityGroupId, personaId);
                return { ...details, id: details.id || personaId, unitId: p.unitId };
              } catch (err) {
                return { id: personaId, unitId: p.unitId, error: err.message };
              }
            })
          );
          return { venueId: venue.id, venueName: venue.name, units, residents };
        } catch (err) {
          return { venueId: venue.id, venueName: venue.name, units: [], residents: [], error: err.message };
        }
      })
    );
  });

  // Exports the move-in Wi-Fi sheet the renderer just populated into
  // #print-wifi-sheet (same @media print CSS that isolates it for physical
  // printing) as an actual PDF file, using Electron's built-in headless-print
  // pipeline rather than asking the resident to use their OS print dialog's
  // own "Save as PDF" option.
  handle('print:wifiSheetPdf', async () => {
    requireAuth();
    if (!mainWindow) throw new Error('No window available to print');
    const buffer = await mainWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    return buffer;
  });

  // The unit's built-in owner + guest Wi-Fi slots ARE fully readable (and,
  // via identities:update/regenerate below, writable) — `personaId`/
  // `guestPersonaId` are Identity ids under /identityGroups/{groupId}/identities,
  // NOT DPSK passphrase ids (confirmed live). Returns the full identity
  // record for each slot present (including the real `dpskPassphrase` value),
  // failing soft per-slot rather than blocking the whole unit detail view.
  handle('units:builtinIdentities', async (unitId) => {
    requireAuth();
    const venueId = venueIdOrThrow();
    const unit = await pm.getUnit(venueId, unitId);
    const propertyConfig = await pm.getPropertyConfig(venueId);
    const identityGroupId = propertyConfig && propertyConfig.personaGroupId;

    async function resolve(personaId) {
      if (!personaId) return null;
      try {
        const details = await identityGroups.getIdentity(identityGroupId, personaId);
        return { ...details, id: details.id || personaId };
      } catch (err) {
        return { id: personaId, error: err.message };
      }
    }

    const [owner, guest] = await Promise.all([resolve(unit.personaId), resolve(unit.guestPersonaId)]);
    return { owner, guest };
  });

  // ---- Additional residents (beyond the unit's built-in owner+guest slots) ----
  // A "resident" here is an Identity under the venue's Identity Group
  // (lib/ruckus/identityGroups.js — confirmed live via RUCKUS One's own web
  // UI network traffic), linked to the unit via the Property Management
  // identities endpoint (lib/ruckus/propertyManagement.js). Creating a DPSK
  // passphrase directly (lib/ruckus/dpsk.js) was the original design but
  // turned out to be the wrong resource — property-management never
  // recognized it for association, no matter how it was created.
  handle('identities:create', async ({ unitId, body }) => {
    const user = requireAuth();
    const venueId = venueIdOrThrow();
    const name = body && body.username;
    if (!name) throw new Error('A name is required to create a resident.');

    const propertyConfig = await pm.getPropertyConfig(venueId);
    const identityGroupId = propertyConfig && propertyConfig.personaGroupId;
    if (!identityGroupId) {
      throw new Error("This venue's Property Management configuration has no Identity Group set yet.");
    }

    let created;
    try {
      created = await identityGroups.createIdentity(identityGroupId, name);
    } catch (err) {
      throw new Error(`Step 1/2 (create identity) failed: ${err.message}`);
    }
    if (!created || !created.id) {
      throw new Error('Identity was created but no id was returned in the response.');
    }

    // A freshly created identity is sometimes not yet visible to the
    // association endpoint ("Identity selected for association does not
    // exist") even though the create call itself already returned 200/202 —
    // a read-after-write propagation lag on RUCKUS's side, seen repeatedly
    // against the real tenant. Retry a few times with a short delay before
    // giving up.
    let linkErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await pm.associateIdentity(venueId, unitId, created.id);
        linkErr = null;
        break;
      } catch (err) {
        linkErr = err;
        if (!/does not exist/i.test(err.message) || attempt === 4) break;
        await new Promise((r) => setTimeout(r, attempt * 750));
      }
    }
    if (linkErr) {
      throw new Error(`Step 2/2 (link ${created.id} to the unit) failed: ${linkErr.message}`);
    }

    // Best-effort: try to set contact info/VLAN beyond the bare name RUCKUS's
    // own "create" call accepts. Unconfirmed endpoint/fields — don't fail the
    // whole operation if this part doesn't work, the resident is already
    // created and linked at this point.
    const followUp = {};
    if (body.email) followUp.email = body.email;
    if (body.phoneNumber) followUp.phoneNumber = body.phoneNumber;
    if (body.vlanId !== undefined) followUp.vlan = body.vlanId;
    if (body.description) followUp.description = body.description;
    if (body.expirationDate) followUp.expirationDate = body.expirationDate;
    let updated = created;
    if (Object.keys(followUp).length) {
      try {
        updated = await identityGroups.patchIdentity(identityGroupId, created.id, followUp);
      } catch {
        // swallow — resident exists and is linked; contact info just didn't take
      }
    }

    logActivity(user.username, 'create-identity', { venueId, unitId, identityGroupId, body: redactPassphrases(body) });
    return { ...created, ...updated };
  });
  handle('identities:update', async ({ identityId, patch }) => {
    const user = requireAuth();
    const venueId = venueIdOrThrow();
    const propertyConfig = await pm.getPropertyConfig(venueId);
    const identityGroupId = propertyConfig && propertyConfig.personaGroupId;
    const body = { ...patch };
    if (body.username !== undefined) { body.name = body.username; delete body.username; }
    if (body.vlanId !== undefined) { body.vlan = body.vlanId; delete body.vlanId; }
    const result = await identityGroups.patchIdentity(identityGroupId, identityId, body);
    logActivity(user.username, 'update-identity', { identityGroupId, identityId, patch: redactPassphrases(patch) });
    return result;
  });
  handle('identities:regenerate', async (identityId) => {
    const user = requireAuth();
    const venueId = venueIdOrThrow();
    const propertyConfig = await pm.getPropertyConfig(venueId);
    const identityGroupId = propertyConfig && propertyConfig.personaGroupId;
    // Match whatever passphrase format/length the DPSK pool is actually
    // configured for (DpskPoolDto.passphraseFormat etc.) rather than always
    // generating the same fixed-length keyboard-friendly string regardless
    // of the pool's real settings — best-effort: if the pool lookup fails
    // for any reason, still fall back to generating *something* rather than
    // blocking the regenerate action entirely.
    let pool = null;
    try {
      pool = await dpsk.getPool(dpskPoolIdOrThrow());
    } catch {
      // fall through to the default generator below
    }
    const passphrase = dpsk.generateFormattedPassphrase(pool);
    const result = await identityGroups.patchIdentity(identityGroupId, identityId, { dpskPassphrase: passphrase });
    logActivity(user.username, 'regenerate-passphrase', { identityGroupId, identityId });
    return { ...result, passphrase };
  });
  handle('identities:setRevoked', async ({ identityId, revoked }) => {
    const user = requireAuth();
    const venueId = venueIdOrThrow();
    const propertyConfig = await pm.getPropertyConfig(venueId);
    const identityGroupId = propertyConfig && propertyConfig.personaGroupId;
    const result = await identityGroups.patchIdentity(identityGroupId, identityId, { revoked: Boolean(revoked) });
    logActivity(user.username, revoked ? 'revoke-identity' : 'unrevoke-identity', { identityGroupId, identityId });
    return result;
  });
  // Admin-only: permanently deleting a resident's Wi-Fi identity is a bigger,
  // less reversible action than revoke/regenerate/disconnect (all of which
  // front desk can still do day to day) — matches unit deletion's admin gate.
  handle('identities:delete', async (identityId) => {
    const admin = requireAdmin();
    const venueId = venueIdOrThrow();
    const propertyConfig = await pm.getPropertyConfig(venueId);
    const identityGroupId = propertyConfig && propertyConfig.personaGroupId;
    await identityGroups.deleteIdentity(identityGroupId, identityId);
    logActivity(admin.username, 'delete-identity', { identityGroupId, identityId });
    return true;
  });
  // Confirmed live: connected clients are queried by a list of identity ids
  // (owner + guest + any Additional Residents), not by unit id or a venue-wide
  // search — the earlier venue-wide-search-and-string-match approach was an
  // unconfirmed guess and never actually found anything real.
  handle('units:clients', async (unitId) => {
    requireAuth();
    const venueId = venueIdOrThrow();
    const unit = await pm.getUnit(venueId, unitId);

    const linkedResult = await pm.queryUnitIdentities(venueId, {
      filters: { unitId },
      page: 1,
      pageSize: 100,
      sortOrder: 'ASC'
    });
    const linked = Array.isArray(linkedResult) ? linkedResult : linkedResult.data || linkedResult.content || [];

    const identityIds = [unit.personaId, unit.guestPersonaId, ...linked.map((p) => p.personaId || p.id)].filter(
      Boolean
    );
    if (!identityIds.length) return { clients: [] };

    const result = await identityGroups.queryClients(identityIds);
    const clients = (result && (result.data || result.content)) || [];
    return { clients };
  });

  // Rich per-client detail (hostname, OS, IPv4/IPv6, AP name, network,
  // signal/health, connected time) — a different RUCKUS API surface again,
  // the "viewmodel" spec's AP-clients query, confirmed live to return
  // exactly the fields RUCKUS One's own "Devices" tab shows for an
  // identity's currently-connected client. See identityGroups.queryApClients.
  handle('identities:clientDetail', async (identityId) => {
    requireAuth();
    venueIdOrThrow();
    const result = await identityGroups.queryApClients([identityId]);
    const rows = (result && result.data) || [];
    return rows[0] || null;
  });
  // Kicks a currently-connected client off the network right now. Does NOT
  // prevent it from reconnecting — RUCKUS has no device-level blocklist API;
  // to actually keep a resident off Wi-Fi going forward, revoke their
  // identity instead (identities:setRevoked, already exposed).
  handle('units:disconnectClient', async ({ serialNumber, clientMac }) => {
    const user = requireAuth();
    const venueId = venueIdOrThrow();
    if (!serialNumber || !clientMac) throw new Error('serialNumber and clientMac are required');
    const result = await rClients.disconnectApClient(venueId, serialNumber, clientMac);
    logActivity(user.username, 'disconnect-client', { venueId, serialNumber, clientMac });
    return result;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

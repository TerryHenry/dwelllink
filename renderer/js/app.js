'use strict';

const state = { user: null, units: [], activeUnitId: null, activeUnit: null, networkSsid: '', venues: [], activeVenueId: '' };

// Shipped default logo lockup (name + tagline + "Powered by RUCKUS One"),
// shown on the login screen and Help page until an admin uploads a custom
// one via Settings -> Appearance.
const DEFAULT_LOGO_SRC = 'assets/dwelllink-logo.png';

// Electron's ipcRenderer.invoke rejects with an Error whose message is
// prefixed like "Error invoking remote method 'x': Error: <message>".
// Strip that down to just what main.js actually threw.
function cleanErrorMessage(err) {
  const raw = (err && err.message) || String(err);
  const match = raw.match(/Error:\s*([^]*)$/);
  return match ? match[1].trim() : raw;
}

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function setError(el, msg) { if (msg) { el.textContent = msg; show(el); } else hide(el); }
function setOk(el, msg) { if (msg) { el.textContent = msg; show(el); } else hide(el); }

// ---------- Toasts ----------
// Non-blocking notifications for things the user doesn't need to
// acknowledge before continuing (errors from a background action, bulk
// results, confirmations). A one-time secret the admin needs time to copy
// (e.g. a generated temporary password) stays a blocking alert() instead —
// see the password-reset handler below.
function showToast(message, type = 'info', duration = 5000) {
  const container = $('#toast-container');
  if (!container) { console.error(message); return; }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

// ---------- Theme (dark mode) ----------
// Per-device preference, not a shared/synced setting — localStorage is the
// right fit here rather than the sqlite settings store.

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('#theme-toggle-btn');
  if (btn) btn.setAttribute('aria-checked', String(theme === 'dark'));
  const label = $('#theme-switch-label');
  if (label) label.textContent = theme === 'dark' ? 'Dark mode' : 'Light mode';
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch {}
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('theme', next); } catch {}
}

initTheme();
document.addEventListener('DOMContentLoaded', () => {
  const btn = $('#theme-toggle-btn');
  if (btn) btn.addEventListener('click', toggleTheme);
});

// ---------- Branding ----------

// Simple RGB darken for the button-hover shade, so picking one "Primary
// color" is enough — matches how --primary/--primary-dark are already used
// as a light/hover pair throughout style.css.
function darkenHex(hex, amount = 0.18) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const channel = (shift) => {
    const c = (num >> shift) & 0xff;
    return Math.max(0, Math.round(c * (1 - amount)));
  };
  const r = channel(16), g = channel(8), b = channel(0);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

async function applyBranding() {
  try {
    const branding = await window.api.settings.getBranding();
    const root = document.documentElement.style;
    if (branding.primaryColor) {
      root.setProperty('--primary', branding.primaryColor);
      root.setProperty('--primary-dark', darkenHex(branding.primaryColor));
    }
    if (branding.accentColor) root.setProperty('--accent', branding.accentColor);
    const name = branding.appName || 'DwellLink';
    $('#brand-name').textContent = name;
    $('#login-brand-name').textContent = name;
    $('#setup-brand-name').textContent = name;
    document.title = name;
    // Sidebar keeps its existing behavior — hidden unless an admin uploads a
    // custom logo, since a wide lockup image doesn't fit well next to the
    // brand-name text in the narrow sidebar.
    if (branding.logoDataUri) {
      $('#brand-logo').src = branding.logoDataUri;
      show($('#brand-logo'));
    } else {
      hide($('#brand-logo'));
      $('#brand-logo').removeAttribute('src');
    }
    // Login screen and Help page default to the shipped DwellLink logo
    // lockup when no custom logo has been uploaded, rather than nothing.
    // The login screen's separate name/tagline text is hidden (the logo
    // already carries that), so this alt text is this image's only
    // accessible name there — keep it meaningful, not decorative-empty.
    [$('#login-logo'), $('#help-logo')].forEach((logo) => {
      logo.src = branding.logoDataUri || DEFAULT_LOGO_SRC;
      logo.alt = name;
      show(logo);
    });
    if (branding.loginMessage) {
      $('#login-message').textContent = branding.loginMessage;
      show($('#login-message'));
    } else {
      hide($('#login-message'));
    }
    state.branding = branding;
  } catch {
    // Branding is cosmetic — never block the app over it.
  }
}

// ---------- Boot / auth ----------

async function boot() {
  await applyBranding();
  const needsSetup = await window.api.auth.needsSetup();
  if (needsSetup) {
    show($('#setup-view'));
    return;
  }
  const user = await window.api.auth.me();
  if (user) {
    afterLogin(user);
  } else {
    show($('#login-view'));
  }
}

// Shared by setup/login/boot: an admin-initiated password reset sets
// mustChangePassword, which blocks entry into the app until the person picks
// their own password — reusing their temp password to keep using the app
// indefinitely would defeat the point of forcing a reset.
function afterLogin(user) {
  state.user = user;
  hide($('#setup-view'));
  hide($('#login-view'));
  hide($('#app-view'));
  if (user.mustChangePassword) {
    $('#fcp-current').value = '';
    $('#fcp-new').value = '';
    setError($('#fcp-error'), null);
    show($('#force-change-password-view'));
    return;
  }
  hide($('#force-change-password-view'));
  enterApp();
}

$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('#setup-error'), null);
  try {
    const user = await window.api.auth.setup({
      username: $('#setup-username').value.trim(),
      password: $('#setup-password').value
    });
    afterLogin(user);
  } catch (err) {
    setError($('#setup-error'), cleanErrorMessage(err));
  }
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('#login-error'), null);
  try {
    const user = await window.api.auth.login({
      username: $('#login-username').value.trim(),
      password: $('#login-password').value
    });
    afterLogin(user);
  } catch (err) {
    setError($('#login-error'), cleanErrorMessage(err));
  }
});

$('#force-change-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('#fcp-error'), null);
  try {
    const user = await window.api.auth.changePassword({
      currentPassword: $('#fcp-current').value,
      newPassword: $('#fcp-new').value
    });
    state.user = user;
    hide($('#force-change-password-view'));
    enterApp();
  } catch (err) {
    setError($('#fcp-error'), cleanErrorMessage(err));
  }
});

async function signOut({ idle = false } = {}) {
  stopIdleTimer();
  await window.api.auth.logout();
  state.user = null;
  hide($('#app-view'));
  show($('#login-view'));
  $('#login-password').value = '';
  if (idle) {
    $('#login-info').textContent = 'You were signed out after a period of inactivity.';
    show($('#login-info'));
  } else {
    hide($('#login-info'));
  }
}

$('#logout-btn').addEventListener('click', () => signOut());

// ---------- Idle auto sign-out ----------
// Shared front-desk terminals otherwise stay signed in indefinitely. Admin
// sets the timeout (minutes) in Settings; 0 disables it. Applies to every
// role, including admin — this is a workstation-level policy, not per-user.

let idleTimeoutMs = 0;
let idleLastActivity = 0;
let idleIntervalId = null;
const IDLE_CHECK_INTERVAL_MS = 15000;
const IDLE_ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];

function markIdleActivity() {
  idleLastActivity = Date.now();
}

function idleTick() {
  if (!idleTimeoutMs) return;
  if (Date.now() - idleLastActivity >= idleTimeoutMs) {
    signOut({ idle: true });
  }
}

function startIdleTimer(minutes) {
  stopIdleTimer();
  idleTimeoutMs = Number(minutes) > 0 ? Number(minutes) * 60 * 1000 : 0;
  if (!idleTimeoutMs) return;
  markIdleActivity();
  IDLE_ACTIVITY_EVENTS.forEach((evt) => document.addEventListener(evt, markIdleActivity, { passive: true }));
  idleIntervalId = setInterval(idleTick, IDLE_CHECK_INTERVAL_MS);
}

function stopIdleTimer() {
  if (idleIntervalId) clearInterval(idleIntervalId);
  idleIntervalId = null;
  IDLE_ACTIVITY_EVENTS.forEach((evt) => document.removeEventListener(evt, markIdleActivity));
}

function enterApp() {
  $('#who-username').textContent = `${state.user.username} (${state.user.role})`;
  $all('.admin-only').forEach((el) => (state.user.role === 'admin' ? show(el) : hide(el)));
  show($('#app-view'));
  switchTab('units');
  // Eagerly (and quietly — Directory tab isn't showing yet) load the
  // directory once units/settings are ready, purely so the sidebar's
  // expiring-soon badge reflects reality without having to visit the tab.
  Promise.all([loadUnits(), loadSettings()])
    .then(() => loadDirectory())
    .catch(() => {});
  checkWhatsNew();
}

// ---------- "What's new" (shown once per upgrade, after sign-in) ----------

async function checkWhatsNew() {
  try {
    const result = await window.api.updates.checkWhatsNew();
    if (!result || !result.show) return;
    $('#whats-new-version').textContent = `v${result.version}`;
    $('#whats-new-body').innerHTML = result.notes
      ? marked.parse(result.notes)
      : '<p class="muted">DwellLink was updated. See the release notes on GitHub for details.</p>';
    show($('#whats-new-modal'));
  } catch {
    // Best-effort only — never blocks sign-in over a notice.
  }
}

$('#whats-new-close-btn').addEventListener('click', () => hide($('#whats-new-modal')));

// ---------- Tabs ----------

const TAB_SECTIONS = ['tab-units', 'tab-directory', 'unit-detail', 'tab-add-unit', 'tab-users', 'tab-audit', 'tab-settings', 'tab-help'];

function switchTab(name) {
  TAB_SECTIONS.forEach((id) => hide($('#' + id)));
  show($('#tab-' + name));
  $all('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'directory') loadDirectory();
  if (name === 'users') loadUsers();
  if (name === 'audit') loadAudit();
  if (name === 'help') loadHelp();
}

$all('.tab-btn').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// ---------- Help (renders USER_GUIDE.md in-app) ----------

// Matches GitHub's heading-slug algorithm so the guide's own internal
// Table-of-Contents links (written assuming that algorithm) resolve
// correctly once rendered here: lowercase, strip anything that isn't a
// word char/space/hyphen, then turn each space into a hyphen (no collapsing
// — "Backup & Restore" -> "backup--restore", matching two hyphens for the
// removed "&").
function slugifyHeading(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s/g, '-');
}

state.helpLoaded = false;

async function loadHelp() {
  if (state.helpLoaded) return;
  try {
    const res = await fetch('../USER_GUIDE.md');
    if (!res.ok) throw new Error(`Could not load the guide (${res.status}).`);
    const markdown = await res.text();
    const renderer = new marked.Renderer();
    renderer.heading = ({ tokens, depth }) => {
      const text = tokens.map((t) => t.text || t.raw || '').join('');
      const id = slugifyHeading(text);
      const inner = marked.Parser.parseInline(tokens);
      return `<h${depth} id="${id}">${inner}</h${depth}>`;
    };
    $('#help-content').innerHTML = marked.parse(markdown, { renderer });
    hide($('#help-loading'));
    state.helpLoaded = true;
  } catch (err) {
    hide($('#help-loading'));
    setError($('#help-error'), cleanErrorMessage(err));
  }
}

// ---------- Units list ----------

function unitDisplayName(u) {
  return u.name || u.unitName || u.unitNumber || u.number || u.identifier || u.id || u.unitId || '(unnamed)';
}
function unitId(u) {
  return u.id || u.unitId;
}
function unitStatus(u) {
  return u.status || ''; // confirmed enum: ENABLED | DISABLED
}
function unitStatusLabel(status) {
  return (status || '').toUpperCase() === 'DISABLED' ? 'suspended' : 'active';
}
function unitResident(u) {
  return u.resident || {};
}
// Move-out (see units:moveOut in main.js) clears the resident name to the
// literal string 'Vacant' — reusing that as the vacancy signal is free
// (resident.name is already loaded with every unit) rather than requiring a
// separate per-unit identity lookup just to tell occupied from empty.
function unitIsVacant(u) {
  return unitResident(u).name === 'Vacant';
}

async function loadUnits() {
  setError($('#units-error'), null);
  // This is a live round-trip to RUCKUS One (not cached), and it's the very
  // first thing that loads right after signing in — without some visible
  // "working on it" cue, a slow RUCKUS response looks like the app hung
  // rather than just being slow to fetch. Matches the same loading-row
  // pattern already used on Directory/Staff/Audit; Units was the one tab
  // missing it.
  hide($('#units-empty'));
  $('#units-table tbody').innerHTML =
    `<tr><td colspan="4" class="muted small"><span class="loading-row"><span class="spinner"></span>Loading units from RUCKUS One… this can take a few seconds.</span></td></tr>`;
  try {
    const data = await window.api.units.list();
    state.units = Array.isArray(data) ? data : data.data || data.units || data.content || [];
    renderUnits();
  } catch (err) {
    $('#units-table tbody').innerHTML = '';
    setError($('#units-error'), cleanErrorMessage(err));
  }
}

function unitSearchHaystack(u) {
  const resident = unitResident(u);
  return [unitDisplayName(u), u.pmsUnitId, resident.name, resident.email, resident.phoneNumber]
    .filter(Boolean)
    .join(' \0 ')
    .toLowerCase();
}

state.unitFilter = 'all';
state.selectedUnitIds = new Set();

// Alphabetical (by unit name) by default, and re-applied every time
// renderUnits() runs — which already happens after every loadUnits() call,
// so a newly added/imported unit lands in sorted position automatically
// without any special-casing for "just created" vs "existing." Numeric
// collation (Intl.Collator's `numeric` option) so unit numbers sort the way
// a person expects (2 < 10 < 100), not as plain strings (where "10" would
// otherwise sort before "2").
state.unitSort = { column: 'name', direction: 'asc' };
const unitSortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortUnitRows(rows) {
  const { column, direction } = state.unitSort;
  const mult = direction === 'desc' ? -1 : 1;
  const valueFor = {
    name: (u) => unitDisplayName(u),
    status: (u) => unitStatusLabel(unitStatus(u)),
    id: (u) => String(unitId(u) ?? '')
  }[column] || ((u) => unitDisplayName(u));
  return [...rows].sort((a, b) => unitSortCollator.compare(valueFor(a), valueFor(b)) * mult);
}

function updateUnitSortIndicators() {
  $all('#units-table th.sortable').forEach((th) => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.sort === state.unitSort.column) {
      arrow.textContent = state.unitSort.direction === 'asc' ? '▲' : '▼';
    } else {
      arrow.textContent = '';
    }
  });
}

$all('#units-table th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const column = th.dataset.sort;
    if (state.unitSort.column === column) {
      state.unitSort.direction = state.unitSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      state.unitSort = { column, direction: 'asc' };
    }
    renderUnits();
  });
});

function renderUnitStats() {
  const total = state.units.length;
  const suspended = state.units.filter((u) => unitStatusLabel(unitStatus(u)) === 'suspended').length;
  const rooms = state.units.filter((u) => u.category === 'CONFERENCEROOM').length;
  const vacant = state.units.filter((u) => u.category !== 'CONFERENCEROOM' && unitIsVacant(u)).length;
  $('#stat-total').textContent = total;
  $('#stat-active').textContent = total - suspended;
  $('#stat-suspended').textContent = suspended;
  $('#stat-rooms').textContent = rooms;
  $('#stat-vacant').textContent = vacant;
}

function renderBulkBar() {
  const count = state.selectedUnitIds.size;
  $('#bulk-selected-count').textContent = `${count} selected`;
  (count > 0 ? show : hide)($('#bulk-actions-bar'));
  if (count === 0) hide($('#bulk-movein-menu'));
}

// "Move-in sheets" dropdown (Print / Save as one PDF / Save as separate
// PDFs) — a plain click-toggle menu, closed by clicking any item in it or
// anywhere outside the dropdown.
$('#bulk-movein-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#bulk-movein-menu').classList.toggle('hidden');
});
$('#bulk-movein-menu').addEventListener('click', (e) => {
  if (e.target.classList.contains('dropdown-item')) hide($('#bulk-movein-menu'));
});
document.addEventListener('click', (e) => {
  if (!$('#bulk-movein-dropdown').contains(e.target)) hide($('#bulk-movein-menu'));
});

function renderUnits() {
  renderUnitStats();
  const filter = $('#unit-search').value.trim().toLowerCase();
  const rows = sortUnitRows(
    state.units
      .filter((u) => !filter || unitSearchHaystack(u).includes(filter))
      .filter((u) => {
        if (state.unitFilter === 'unit') return u.category !== 'CONFERENCEROOM';
        if (state.unitFilter === 'room') return u.category === 'CONFERENCEROOM';
        if (state.unitFilter === 'vacant') return u.category !== 'CONFERENCEROOM' && unitIsVacant(u);
        return true;
      })
  );
  updateUnitSortIndicators();
  const tbody = $('#units-table tbody');
  tbody.innerHTML = '';
  rows.forEach((u) => {
    const id = unitId(u);
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    const label = unitStatusLabel(unitStatus(u));
    const isConferenceRoom = u.category === 'CONFERENCEROOM';
    const isVacant = !isConferenceRoom && unitIsVacant(u);
    tr.innerHTML = `
      <td class="checkbox-col"><input type="checkbox" class="unit-row-checkbox" ${state.selectedUnitIds.has(id) ? 'checked' : ''} /></td>
      <td>${escapeHtml(unitDisplayName(u))}${isConferenceRoom ? '<span class="status-pill room">Conference room</span>' : ''}${isVacant ? '<span class="status-pill vacant">Vacant</span>' : ''}</td>
      <td><span class="status-pill ${label === 'suspended' ? 'suspended' : 'active'}">${label}</span></td>
      <td class="muted small">${escapeHtml(String(id ?? ''))}</td>`;
    const checkbox = tr.querySelector('.unit-row-checkbox');
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      if (checkbox.checked) state.selectedUnitIds.add(id);
      else state.selectedUnitIds.delete(id);
      $('#units-select-all').checked = rows.length > 0 && rows.every((r) => state.selectedUnitIds.has(unitId(r)));
      renderBulkBar();
    });
    tr.addEventListener('click', () => openUnitDetail(id));
    tbody.appendChild(tr);
  });
  $('#units-select-all').checked = rows.length > 0 && rows.every((u) => state.selectedUnitIds.has(unitId(u)));
  renderBulkBar();
  (rows.length ? hide : show)($('#units-empty'));
}

$('#unit-search').addEventListener('input', renderUnits);
$('#refresh-units-btn').addEventListener('click', loadUnits);
$all('#unit-filter-chips .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    state.unitFilter = chip.dataset.filter;
    $all('#unit-filter-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderUnits();
  });
});

$('#units-select-all').addEventListener('click', () => {
  const checked = $('#units-select-all').checked;
  $all('#units-table tbody .unit-row-checkbox').forEach((cb) => { cb.checked = checked; });
  // Recompute which units are currently visible (same filter as renderUnits) to select/deselect exactly those.
  const filter = $('#unit-search').value.trim().toLowerCase();
  const visible = state.units
    .filter((u) => !filter || unitSearchHaystack(u).includes(filter))
    .filter((u) => {
      if (state.unitFilter === 'unit') return u.category !== 'CONFERENCEROOM';
      if (state.unitFilter === 'room') return u.category === 'CONFERENCEROOM';
      if (state.unitFilter === 'vacant') return u.category !== 'CONFERENCEROOM' && unitIsVacant(u);
      return true;
    });
  visible.forEach((u) => {
    if (checked) state.selectedUnitIds.add(unitId(u));
    else state.selectedUnitIds.delete(unitId(u));
  });
  renderBulkBar();
});

$('#bulk-clear-btn').addEventListener('click', () => {
  state.selectedUnitIds.clear();
  renderUnits();
});

// Generic bulk-action runner, shared by the Units list and the Additional
// Residents table: sequential + paced (300ms between calls — this API has
// repeatedly shown fragility under rapid/concurrent writes, same discipline
// as the CSV importer), tracks per-item success/failure so one bad item
// doesn't hide whether the rest of the batch succeeded.
async function runBulkAction(ids, actionFn, { confirmMessage, errorTarget, onDone } = {}) {
  if (!ids.length) return;
  if (confirmMessage && !confirm(confirmMessage.replace('{n}', ids.length))) return;
  setError(errorTarget, null);
  let ok = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await actionFn(id);
      ok++;
    } catch (err) {
      failed++;
      console.error(cleanErrorMessage(err));
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  await onDone();
  if (failed) setError(errorTarget, `${ok} succeeded, ${failed} failed. Check individual items for details.`);
}

$('#bulk-resend-btn').addEventListener('click', async () => {
  const ids = Array.from(state.selectedUnitIds);
  if (!ids.length) return;
  setError($('#units-error'), null);
  try {
    await window.api.units.resendNotifications(ids);
    state.selectedUnitIds.clear();
    await loadUnits();
  } catch (err) {
    setError($('#units-error'), cleanErrorMessage(err));
  }
});

// Sheet data for one unit's OWNER Wi-Fi, for a bulk print/PDF from the Units
// tab's multi-select — regenerates the QR code fresh (qrcode.js, same
// technique as showWifiQr()) rather than reusing a modal, since there's no
// modal open for a batch of units. Paced 300ms apart, matching this app's
// established discipline elsewhere for this API's fragility under rapid
// calls (see runBulkAction above). Units missing a passphrase (never set up)
// or with no network SSID configured are skipped rather than failing the
// whole batch, and reported back so the caller can tell the user which ones.
async function collectBulkPrintSheets(ids) {
  const sheets = [];
  const skipped = [];
  const ssid = state.networkSsid || '';
  for (const id of ids) {
    const unit = state.units.find((u) => unitId(u) === id);
    const label = unit ? unitDisplayName(unit) : id;
    if (!ssid) { skipped.push(`${label} (no Wi-Fi network configured)`); continue; }
    try {
      const { owner } = await window.api.units.builtinIdentities(id);
      const passphrase = owner && owner.dpskPassphrase;
      if (!passphrase) {
        skipped.push(`${label} (no Wi-Fi passphrase set)`);
      } else {
        const qr = qrcode(0, 'M');
        qr.addData(`WIFI:T:WPA;S:${escapeWifiField(ssid)};P:${escapeWifiField(passphrase)};;`);
        qr.make();
        sheets.push({
          logoSrc: state.branding && state.branding.logoDataUri ? state.branding.logoDataUri : DEFAULT_LOGO_SRC,
          appName: (state.branding && state.branding.appName) || 'DwellLink',
          unitLabel: `Unit: ${label}`,
          residentLabel: `Resident: ${(unit && unit.resident && unit.resident.name) || 'Unit (owner) Wi-Fi'}`,
          qrSvgHtml: qr.createSvgTag(6, 4),
          ssid,
          passphrase
        });
      }
    } catch (err) {
      skipped.push(`${label} (${cleanErrorMessage(err)})`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { sheets, skipped };
}

function reportSkippedPrintSheets(skipped) {
  if (skipped.length) {
    showToast(`Skipped ${skipped.length} unit(s):\n${skipped.join('\n')}`, 'warning', 8000);
  }
}

$('#bulk-print-btn').addEventListener('click', async () => {
  const ids = Array.from(state.selectedUnitIds);
  if (!ids.length) return;
  const btn = $('#bulk-print-btn');
  btn.disabled = true;
  try {
    const { sheets, skipped } = await collectBulkPrintSheets(ids);
    if (populatePrintSheet(sheets)) window.print();
    reportSkippedPrintSheets(skipped);
  } finally {
    btn.disabled = false;
  }
});

// One combined PDF, one page per unit — good for a single file to file away
// or hand to whoever's doing the printing.
$('#bulk-pdf-btn').addEventListener('click', async () => {
  const ids = Array.from(state.selectedUnitIds);
  if (!ids.length) return;
  const btn = $('#bulk-pdf-btn');
  btn.disabled = true;
  try {
    const { sheets, skipped } = await collectBulkPrintSheets(ids);
    if (populatePrintSheet(sheets)) {
      const stamp = new Date().toISOString().slice(0, 10);
      await downloadPrintSheetPdf(`wifi-move-in-${sheets.length}-units-${stamp}.pdf`);
    }
    reportSkippedPrintSheets(skipped);
  } catch (err) {
    showToast(cleanErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

// One separate PDF per unit — good for emailing each resident their own
// sheet, or filing per-unit paperwork, instead of one shared multi-page
// file. Regenerates the print sheet with a single page each time (reusing
// the same populatePrintSheet()/downloadPrintSheetPdf() building blocks as
// everything else) and paces the printToPDF calls, since it's the heaviest
// single operation this app does and this API family has repeatedly shown
// fragility under rapid back-to-back calls elsewhere in the app.
$('#bulk-pdf-individual-btn').addEventListener('click', async () => {
  const ids = Array.from(state.selectedUnitIds);
  if (!ids.length) return;
  const btn = $('#bulk-pdf-individual-btn');
  btn.disabled = true;
  try {
    const { sheets, skipped } = await collectBulkPrintSheets(ids);
    for (const sheet of sheets) {
      populatePrintSheet([sheet]);
      const slug = sheet.unitLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      await downloadPrintSheetPdf(`wifi-move-in-${slug}.pdf`);
      await new Promise((r) => setTimeout(r, 300));
    }
    reportSkippedPrintSheets(skipped);
  } catch (err) {
    showToast(cleanErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

$('#bulk-suspend-btn').addEventListener('click', () => runBulkAction(
  Array.from(state.selectedUnitIds),
  (id) => window.api.units.setStatus({ unitId: id, status: 'DISABLED' }),
  { confirmMessage: 'Suspend {n} unit(s)?', errorTarget: $('#units-error'), onDone: async () => { state.selectedUnitIds.clear(); await loadUnits(); } }
));

$('#bulk-reactivate-btn').addEventListener('click', () => runBulkAction(
  Array.from(state.selectedUnitIds),
  (id) => window.api.units.setStatus({ unitId: id, status: 'ENABLED' }),
  { confirmMessage: 'Reactivate {n} unit(s)?', errorTarget: $('#units-error'), onDone: async () => { state.selectedUnitIds.clear(); await loadUnits(); } }
));

$('#bulk-delete-btn').addEventListener('click', () => runBulkAction(
  Array.from(state.selectedUnitIds),
  (id) => window.api.units.delete(id),
  { confirmMessage: 'Permanently delete {n} unit(s)? This cannot be undone in RUCKUS One.', errorTarget: $('#units-error'), onDone: async () => { state.selectedUnitIds.clear(); await loadUnits(); } }
));

$('#bulk-move-out-btn').addEventListener('click', () => runBulkAction(
  Array.from(state.selectedUnitIds),
  (id) => window.api.units.moveOut(id),
  {
    confirmMessage: 'Move out {n} unit(s)? This revokes each unit\'s owner and guest Wi-Fi, removes and deletes every Additional Resident, and clears the resident of record. This cannot be undone.',
    errorTarget: $('#units-error'),
    onDone: async () => { state.selectedUnitIds.clear(); await loadUnits(); }
  }
));
function openAddUnitForm(category) {
  $('#add-unit-form').reset();
  setError($('#add-unit-error'), null);
  state.newUnitCategory = category;
  const isConferenceRoom = category === 'CONFERENCEROOM';
  $('#add-unit-title').textContent = isConferenceRoom ? 'Add a Conference Room' : 'Add a Property Unit';
  $('#new-unit-name-label').firstChild.textContent = isConferenceRoom ? 'Room name / number *' : 'Unit name / number *';
  $('#new-unit-resident-name-label').firstChild.textContent = isConferenceRoom ? 'Contact name *' : 'Resident name *';
  switchTab('add-unit');
}
$('#add-unit-btn').addEventListener('click', () => openAddUnitForm('UNIT'));
$('#add-conference-room-btn').addEventListener('click', () => openAddUnitForm('CONFERENCEROOM'));
$('#cancel-add-unit').addEventListener('click', () => switchTab('units'));

// ---------- Import units from CSV ----------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // ignore — paired \n handles the line break
    } else {
      field += c;
    }
  }
  if (field.length || row.length) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const CSV_IMPORT_TEMPLATE =
  'name,category,resident_name,resident_email,resident_phone,pms_unit_id,vlan,description,passphrase,guest_vlan,guest_passphrase\n' +
  'unit101,UNIT,Jane Doe,jane@example.com,+15551234567,,10,,,20,\n' +
  'Conference A,CONFERENCEROOM,Front Desk,,,,,,,,\n';

$('#download-csv-template-btn').addEventListener('click', () => {
  const blob = new Blob([CSV_IMPORT_TEMPLATE], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'units-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
});

// Same column order/names as the import template (plus status/id appended)
// so an exported file can be trimmed and re-imported unchanged — the
// importer looks columns up by header name, so the extra trailing columns
// are safely ignored on re-import.
$('#export-units-csv-btn').addEventListener('click', () => {
  const header = ['name', 'category', 'resident_name', 'resident_email', 'resident_phone', 'pms_unit_id', 'status', 'id'];
  const lines = [header.map(csvEscape).join(',')];
  state.units.forEach((u) => {
    const resident = unitResident(u);
    lines.push(
      [
        unitDisplayName(u),
        u.category === 'CONFERENCEROOM' ? 'CONFERENCEROOM' : 'UNIT',
        resident.name || '',
        resident.email || '',
        resident.phoneNumber || '',
        u.pmsUnitId || '',
        unitStatusLabel(unitStatus(u)),
        unitId(u)
      ]
        .map(csvEscape)
        .join(',')
    );
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `units-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

function resetCsvImportModal() {
  state.csvImportRows = [];
  $('#import-csv-file').value = '';
  $('#import-csv-file').disabled = false;
  setError($('#import-csv-error'), null);
  hide($('#import-csv-preview'));
  hide($('#import-csv-progress'));
  hide($('#import-csv-start-btn'));
  $('#import-csv-start-btn').disabled = false;
  $('#import-csv-preview-table tbody').innerHTML = '';
  $('#import-csv-results').innerHTML = '';
}

$('#import-csv-btn').addEventListener('click', () => {
  resetCsvImportModal();
  show($('#import-csv-modal'));
});
$('#import-csv-close-btn').addEventListener('click', async () => {
  hide($('#import-csv-modal'));
  await loadUnits();
});
$('#import-csv-modal').addEventListener('click', async (e) => {
  if (e.target.id === 'import-csv-modal') {
    hide($('#import-csv-modal'));
    await loadUnits();
  }
});

$('#import-csv-file').addEventListener('change', () => {
  const file = $('#import-csv-file').files[0];
  setError($('#import-csv-error'), null);
  hide($('#import-csv-preview'));
  hide($('#import-csv-start-btn'));
  hide($('#import-csv-progress'));
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const rows = parseCsv(String(reader.result));
      if (!rows.length) throw new Error('CSV file is empty.');
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const nameIdx = header.indexOf('name');
      const categoryIdx = header.indexOf('category');
      const residentNameIdx = header.indexOf('resident_name');
      const emailIdx = header.indexOf('resident_email');
      const phoneIdx = header.indexOf('resident_phone');
      const pmsIdx = header.indexOf('pms_unit_id');
      const vlanIdx = header.indexOf('vlan');
      const descriptionIdx = header.indexOf('description');
      const passphraseIdx = header.indexOf('passphrase');
      const guestVlanIdx = header.indexOf('guest_vlan');
      const guestPassphraseIdx = header.indexOf('guest_passphrase');
      if (nameIdx === -1 || residentNameIdx === -1) {
        throw new Error('CSV must have "name" and "resident_name" columns — see the template.');
      }

      // VLAN must be 1-4094 (same range the Unit & Guest Wi-Fi form enforces);
      // passphrase must be 8-63 chars (RUCKUS's own DPSK passphrase field
      // constraint). An invalid value doesn't fail the whole row — the unit
      // and resident are still perfectly good without it — it's just dropped
      // and called out so it's not silently missing.
      function checkVlan(raw, label, warnings) {
        const trimmed = (raw || '').trim();
        if (!trimmed) return undefined;
        const n = Number(trimmed);
        if (!Number.isInteger(n) || n < 1 || n > 4094) {
          warnings.push(`${label} "${trimmed}" is invalid (must be 1-4094) — skipped.`);
          return undefined;
        }
        return n;
      }
      function checkPassphrase(raw, label, warnings) {
        const trimmed = (raw || '').trim();
        if (!trimmed) return undefined;
        if (trimmed.length < 8 || trimmed.length > 63) {
          warnings.push(`${label} must be 8-63 characters — skipped.`);
          return undefined;
        }
        return trimmed;
      }

      const parsed = [];
      const skipped = [];
      rows.slice(1).forEach((r, i) => {
        const rowNum = i + 2; // +1 for header, +1 for 1-indexing
        const name = (r[nameIdx] || '').trim();
        const residentName = (r[residentNameIdx] || '').trim();
        if (!name && !residentName) return; // blank line
        if (!name || !residentName) {
          skipped.push(`Row ${rowNum}: missing required name/resident_name — skipped.`);
          return;
        }
        const rawCategory = categoryIdx !== -1 ? (r[categoryIdx] || '').trim().toUpperCase() : '';
        const warnings = [];
        parsed.push({
          rowNum,
          name,
          category: rawCategory === 'CONFERENCEROOM' ? 'CONFERENCEROOM' : 'UNIT',
          residentName,
          email: emailIdx !== -1 ? (r[emailIdx] || '').trim() : '',
          phone: phoneIdx !== -1 ? (r[phoneIdx] || '').trim() : '',
          pmsUnitId: pmsIdx !== -1 ? (r[pmsIdx] || '').trim() : '',
          vlan: vlanIdx !== -1 ? checkVlan(r[vlanIdx], 'vlan', warnings) : undefined,
          description: descriptionIdx !== -1 ? (r[descriptionIdx] || '').trim() || undefined : undefined,
          passphrase: passphraseIdx !== -1 ? checkPassphrase(r[passphraseIdx], 'passphrase', warnings) : undefined,
          guestVlan: guestVlanIdx !== -1 ? checkVlan(r[guestVlanIdx], 'guest_vlan', warnings) : undefined,
          guestPassphrase: guestPassphraseIdx !== -1 ? checkPassphrase(r[guestPassphraseIdx], 'guest_passphrase', warnings) : undefined,
          warnings
        });
      });

      state.csvImportRows = parsed;
      $('#import-csv-preview-summary').textContent = `${parsed.length} unit(s) ready to import`
        + (skipped.length ? ` — ${skipped.length} row(s) skipped (see below).` : '.');
      const tbody = $('#import-csv-preview-table tbody');
      tbody.innerHTML = '';
      parsed.forEach((p) => {
        const wifiParts = [];
        if (p.vlan !== undefined || p.passphrase) wifiParts.push(`Owner${p.vlan !== undefined ? ` VLAN ${p.vlan}` : ''}${p.passphrase ? ' + passphrase' : ''}`);
        if (p.guestVlan !== undefined || p.guestPassphrase) wifiParts.push(`Guest${p.guestVlan !== undefined ? ` VLAN ${p.guestVlan}` : ''}${p.guestPassphrase ? ' + passphrase' : ''}`);
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="small">${p.rowNum}</td>
          <td class="small">${escapeHtml(p.name)}</td>
          <td class="small">${p.category === 'CONFERENCEROOM' ? 'Conference room' : 'Unit'}</td>
          <td class="small">${escapeHtml(p.residentName)}</td>
          <td class="small">${escapeHtml([p.email, p.phone].filter(Boolean).join(' / ') || '—')}</td>
          <td class="small">${escapeHtml(wifiParts.join('; ') || '—')}</td>`;
        tbody.appendChild(tr);
        if (p.warnings.length) {
          const warnTr = document.createElement('tr');
          warnTr.innerHTML = `<td></td><td colspan="5" class="error small">Row ${p.rowNum}: ${escapeHtml(p.warnings.join(' '))}</td>`;
          tbody.appendChild(warnTr);
        }
      });
      if (skipped.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="6" class="error small">${escapeHtml(skipped.join(' '))}</td>`;
        tbody.appendChild(tr);
      }
      show($('#import-csv-preview'));
      if (parsed.length) show($('#import-csv-start-btn'));
    } catch (err) {
      setError($('#import-csv-error'), err.message);
    }
  };
  reader.readAsText(file);
});

$('#import-csv-start-btn').addEventListener('click', async () => {
  const rows = state.csvImportRows || [];
  if (!rows.length) return;
  $('#import-csv-start-btn').disabled = true;
  $('#import-csv-file').disabled = true;
  hide($('#import-csv-preview'));
  show($('#import-csv-progress'));
  const resultsEl = $('#import-csv-results');
  resultsEl.innerHTML = '';
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    $('#import-csv-progress-text').textContent = `Importing ${i + 1} of ${rows.length}…`;
    try {
      await window.api.units.create({
        name: row.name,
        category: row.category,
        resident: {
          name: row.residentName,
          email: row.email || undefined,
          phoneNumber: normalizePhoneForApi(row.phone)
        },
        pmsUnitId: row.pmsUnitId || undefined,
        ownerVlan: row.vlan,
        ownerDescription: row.description,
        ownerPassphrase: row.passphrase,
        guestVlan: row.guestVlan,
        guestPassphrase: row.guestPassphrase
      });
      ok++;
      // Owner/guest Wi-Fi extras are applied in the background after the
      // unit itself is created (see units:create in main.js) — note that
      // here rather than implying they're already confirmed set.
      const wifiNote = (row.vlan !== undefined || row.description || row.passphrase || row.guestVlan !== undefined || row.guestPassphrase)
        ? ' (Wi-Fi details will finish applying in the background)' : '';
      resultsEl.innerHTML += `<dt>Row ${row.rowNum}</dt><dd>${escapeHtml(row.name)} — created${wifiNote}</dd>`;
    } catch (err) {
      failed++;
      resultsEl.innerHTML += `<dt class="error">Row ${row.rowNum}</dt><dd class="error">${escapeHtml(row.name)} — ${escapeHtml(cleanErrorMessage(err))}</dd>`;
    }
    // A short gap between creates — this API's create endpoint is async and
    // this session has repeatedly found rapid-fire writes to this API
    // fragile (500s under load elsewhere), so pace it defensively.
    await new Promise((r) => setTimeout(r, 400));
  }
  $('#import-csv-progress-text').textContent = `Done: ${ok} created, ${failed} failed (of ${rows.length}).`;
  $('#import-csv-file').disabled = false;
  await loadUnits();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Shared by every CSV export (Units/Directory/Audit) — quoting alone (the
// only thing this used to do) protects a value from being split across
// columns by an embedded comma/quote/newline, but it does NOT stop a
// spreadsheet app from still treating the cell's content as a formula once
// opened: Excel/Sheets key off the value's first character, not whether the
// CSV field happened to be quoted. A resident name/description field that
// starts with =/+/-/@ (accidentally, from a copy-pasted import, or
// deliberately) would still execute as a formula on open otherwise — a
// well-known class of issue ("CSV/formula injection"). Prefixing with a
// leading apostrophe is the standard neutralizer: every mainstream
// spreadsheet app treats that as "force text" and hides the apostrophe
// itself in the displayed cell, so legitimate values are unaffected.
function csvEscape(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// RUCKUS's API accepts a phoneNumber in any format with no validation, but
// SMS notifications only actually go out when it's in full E.164 (+1XXXXXXXXXX)
// form - so a plain 10-digit US number a front-desk user types (no country
// code) silently never gets a text. Assume a US number (this property is
// US-based) and add +1 automatically rather than requiring staff to know that.
function normalizePhoneForApi(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : trimmed;
}

function parseExtraJson(text, errEl) {
  if (!text || !text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be a JSON object');
    return parsed;
  } catch (e) {
    setError(errEl, `Extra fields JSON is invalid: ${e.message}`);
    throw e;
  }
}

// ---------- Add unit ----------

function buildNewUnitBody() {
  const vlanRaw = $('#new-unit-vlan').value.trim();
  const guestVlanRaw = $('#new-unit-guest-vlan').value.trim();
  return {
    name: $('#new-unit-name').value.trim(),
    resident: {
      name: $('#new-unit-resident-name').value.trim(),
      email: $('#new-unit-resident-email').value.trim() || undefined,
      phoneNumber: normalizePhoneForApi($('#new-unit-resident-phone').value)
    },
    category: state.newUnitCategory || undefined,
    pmsUnitId: $('#new-unit-pms-id').value.trim() || undefined,
    ownerVlan: vlanRaw ? Number(vlanRaw) : undefined,
    ownerDescription: $('#new-unit-description').value.trim() || undefined,
    ownerPassphrase: $('#new-unit-passphrase').value.trim() || undefined,
    guestVlan: guestVlanRaw ? Number(guestVlanRaw) : undefined,
    guestPassphrase: $('#new-unit-guest-passphrase').value.trim() || undefined
  };
}

// Same VLAN/passphrase rules as the CSV importer (1-4094, 8-63 chars) but
// blocks submission with a clear error instead of silently dropping the
// value — the CSV importer's "warn and drop, keep going" approach makes
// sense for a batch of many rows; for a single unit someone's actively
// filling in right now, they'd want to know immediately instead.
function validateNewUnitBody(body) {
  if (body.ownerVlan !== undefined && (!Number.isInteger(body.ownerVlan) || body.ownerVlan < 1 || body.ownerVlan > 4094)) {
    return 'VLAN must be a number between 1 and 4094.';
  }
  if (body.guestVlan !== undefined && (!Number.isInteger(body.guestVlan) || body.guestVlan < 1 || body.guestVlan > 4094)) {
    return 'Guest VLAN must be a number between 1 and 4094.';
  }
  if (body.ownerPassphrase !== undefined && (body.ownerPassphrase.length < 8 || body.ownerPassphrase.length > 63)) {
    return 'Wi-Fi passphrase must be 8-63 characters.';
  }
  if (body.guestPassphrase !== undefined && (body.guestPassphrase.length < 8 || body.guestPassphrase.length > 63)) {
    return 'Guest Wi-Fi passphrase must be 8-63 characters.';
  }
  return null;
}

$('#add-unit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('#add-unit-error'), null);

  const body = buildNewUnitBody();
  const validationError = validateNewUnitBody(body);
  if (validationError) {
    setError($('#add-unit-error'), validationError);
    return;
  }
  try {
    await window.api.units.create(body);
    await loadUnits();
    switchTab('units');
  } catch (err) {
    setError($('#add-unit-error'), cleanErrorMessage(err));
  }
});

// ---------- Directory (cross-unit owner + resident search, expiring-soon) ----------
// Additional Residents only live to view scoped to one unit at a time
// otherwise — this pulls every one of them venue-wide in a single call
// (identities:listAll) so front desk can find "who is this caller" or "whose
// access is expiring soon" without opening each unit individually. Owner
// rows are built from state.units (already loaded for the Units tab, no
// extra API calls needed) so owners are searchable here too, distinguished
// from Additional Residents via the Type column.

state.directory = [];
state.directoryFilter = 'all';

const EXPIRING_SOON_DAYS = 7;

function isExpiringSoon(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const diffDays = (d - Date.now()) / 86400000;
  return diffDays >= 0 && diffDays <= EXPIRING_SOON_DAYS;
}

// Builds directory rows (owner + resident) for one venue's already-fetched
// units/residents — shared between the normal (active-venue-only) load and
// the cross-property load, so a row always carries its own unit *name*
// rather than just an id that would only resolve correctly against
// state.units (which only ever holds the active venue's units).
function buildDirectoryRows(venueId, venueName, units, residents) {
  const unitNameById = new Map(units.map((u) => [unitId(u), unitDisplayName(u)]));
  const owners = units.map((u) => {
    const resident = unitResident(u);
    return {
      type: 'owner',
      name: resident.name || '(no owner set)',
      email: resident.email || '',
      phoneNumber: resident.phoneNumber || '',
      description: '',
      unitId: unitId(u),
      unitName: unitDisplayName(u),
      venueId,
      venueName,
      expirationDate: null,
      revoked: false
    };
  });
  const residentRows = residents
    .filter((r) => !r.error) // couldn't resolve this one — skip rather than show a broken row
    .map((r) => ({
      type: 'resident',
      name: identityName(r),
      email: identityEmail(r),
      phoneNumber: identityPhone(r),
      description: identityDescription(r),
      unitId: r.unitId,
      unitName: unitNameById.get(r.unitId) || r.unitId || '—',
      venueId,
      venueName,
      expirationDate: identityExpiration(r),
      revoked: identityRevoked(r)
    }));
  return [...owners, ...residentRows];
}

async function loadDirectory() {
  setError($('#directory-error'), null);
  const tbody = $('#directory-table tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="muted small">Loading…</td></tr>';
  const crossProperty = state.user.role === 'admin' && $('#directory-all-properties-checkbox').checked;
  try {
    if (crossProperty) {
      const perVenue = await window.api.directory.listAllVenues();
      const errors = perVenue.filter((v) => v.error);
      if (errors.length) {
        setError($('#directory-error'), `Couldn't load: ${errors.map((v) => `${v.venueName} (${cleanErrorMessage({ message: v.error })})`).join(', ')}`);
      }
      state.directory = perVenue.flatMap((v) => buildDirectoryRows(v.venueId, v.venueName, v.units, v.residents));
    } else {
      const activeVenue = state.venues.find((v) => v.id === state.activeVenueId);
      const linked = await window.api.identities.listAll();
      state.directory = buildDirectoryRows(state.activeVenueId, activeVenue ? activeVenue.name : '', state.units, linked);
    }
    renderDirectory();
  } catch (err) {
    tbody.innerHTML = '';
    setError($('#directory-error'), cleanErrorMessage(err));
  }
  updateExpiringBadge();
}

// Reflects the current property's expiring-soon count on the sidebar so
// it's visible without having to remember to check the Directory tab.
// Deliberately scoped to whatever's already loaded (the active property by
// default) rather than always cross-checking every property — that would
// mean an extra round of API calls on every login just for a badge.
function updateExpiringBadge() {
  const badge = $('#directory-nav-badge');
  const count = state.directory.filter((r) => isExpiringSoon(r.expirationDate)).length;
  if (count > 0) {
    badge.textContent = String(count);
    show(badge);
  } else {
    hide(badge);
  }
}

// Shared by the Directory tab's row click and global search results:
// switches the active property first if the target lives on a different one
// than what's currently loaded, then opens the unit. Swallows the switch
// failure as a toast rather than throwing, matching how the Directory tab's
// own row click already handled it before this was factored out.
async function jumpToUnit(unitId, venueId) {
  if (venueId && venueId !== state.activeVenueId) {
    try {
      await window.api.venues.setActive(venueId);
      await loadSettings();
      await loadUnits();
    } catch (err) {
      showToast(cleanErrorMessage(err), 'error');
      return;
    }
  }
  openUnitDetail(unitId);
}

// ---------- Global search (Cmd/Ctrl+K) ----------
// Reuses state.directory (already built from state.units + every unit's
// Additional Residents, see buildDirectoryRows above) rather than
// maintaining a second index — it already covers every unit (as an 'owner'
// row) and every resident, scoped the same way the Units/Directory tabs
// already are (active property, unless "search all properties" is on).

function buildSearchEntries() {
  return state.directory.map((r) => {
    if (r.type === 'owner') {
      return {
        label: r.unitName,
        sub: r.name && r.name !== 'Vacant' ? r.name : 'Vacant unit',
        unitId: r.unitId,
        venueId: r.venueId,
        haystack: [r.unitName, r.name, r.email, r.phoneNumber].filter(Boolean).join(' ').toLowerCase()
      };
    }
    return {
      label: r.name,
      sub: `Additional resident · ${r.unitName}`,
      unitId: r.unitId,
      venueId: r.venueId,
      haystack: [r.name, r.email, r.phoneNumber, r.unitName, r.description].filter(Boolean).join(' ').toLowerCase()
    };
  });
}

state.searchActiveIndex = -1;

function renderSearchResults() {
  const query = $('#search-input').value.trim().toLowerCase();
  const container = $('#search-results');
  const entries = buildSearchEntries().filter((e) => !query || e.haystack.includes(query));
  const rows = entries.slice(0, 30);
  state.searchActiveIndex = rows.length ? 0 : -1;
  if (!rows.length) {
    container.innerHTML = `<p class="search-empty">${query ? 'No matches.' : 'Start typing to search units and residents.'}</p>`;
    return;
  }
  container.innerHTML = '';
  rows.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = `search-result${i === 0 ? ' active' : ''}`;
    div.innerHTML = `<span class="search-result-title">${escapeHtml(entry.label)}</span><span class="search-result-meta">${escapeHtml(entry.sub)}</span>`;
    div.addEventListener('click', () => selectSearchEntry(entry));
    container.appendChild(div);
  });
}

function selectSearchEntry(entry) {
  hide($('#search-modal'));
  jumpToUnit(entry.unitId, entry.venueId);
}

function openSearch() {
  $('#search-input').value = '';
  show($('#search-modal'));
  renderSearchResults();
  $('#search-input').focus();
}

$('#open-search-btn').addEventListener('click', openSearch);
$('#search-input').addEventListener('input', renderSearchResults);
$('#search-modal').addEventListener('click', (e) => {
  if (e.target.id === 'search-modal') hide($('#search-modal'));
});
$('#search-input').addEventListener('keydown', (e) => {
  const rows = $all('#search-results .search-result');
  if (e.key === 'Escape') {
    hide($('#search-modal'));
  } else if (e.key === 'ArrowDown' && rows.length) {
    e.preventDefault();
    state.searchActiveIndex = Math.min(state.searchActiveIndex + 1, rows.length - 1);
    rows.forEach((r, i) => r.classList.toggle('active', i === state.searchActiveIndex));
    rows[state.searchActiveIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp' && rows.length) {
    e.preventDefault();
    state.searchActiveIndex = Math.max(state.searchActiveIndex - 1, 0);
    rows.forEach((r, i) => r.classList.toggle('active', i === state.searchActiveIndex));
    rows[state.searchActiveIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (rows[state.searchActiveIndex]) rows[state.searchActiveIndex].click();
  }
});
document.addEventListener('keydown', (e) => {
  if ($('#app-view').classList.contains('hidden')) return; // not signed in yet
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === 'k') {
    e.preventDefault();
    if ($('#search-modal').classList.contains('hidden')) openSearch();
    else hide($('#search-modal'));
  }
});

function renderDirectory() {
  const search = $('#directory-search').value.trim().toLowerCase();
  const filter = state.directoryFilter;
  const rows = state.directory.filter((r) => {
    if (filter === 'expiring' && !isExpiringSoon(r.expirationDate)) return false;
    if (filter === 'revoked' && !r.revoked) return false;
    if (!search) return true;
    const haystack = [r.name, r.email, r.phoneNumber, r.description, r.unitName, r.venueName].join(' ').toLowerCase();
    return haystack.includes(search);
  });
  const tbody = $('#directory-table tbody');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted small">No matching owners or residents.</td></tr>';
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    const contact = [r.email, r.phoneNumber].filter(Boolean).join(' / ') || '—';
    const expiringSoon = isExpiringSoon(r.expirationDate);
    tr.innerHTML = `
      <td>${escapeHtml(r.name)}${r.description ? `<div class="muted small">${escapeHtml(r.description)}</div>` : ''}</td>
      <td class="small"><span class="status-pill ${r.type === 'owner' ? 'room' : 'active'}">${r.type === 'owner' ? 'Owner' : 'Resident'}</span></td>
      <td class="small">${escapeHtml(r.venueName || '—')}</td>
      <td class="small">${escapeHtml(r.unitName)}</td>
      <td class="small">${escapeHtml(contact)}</td>
      <td class="small">${r.expirationDate ? `<span class="${expiringSoon ? 'error' : ''}">${escapeHtml(isoToDateInput(r.expirationDate))}</span>` : '—'}</td>
      <td>${r.type === 'resident' ? (r.revoked ? '<span class="status-pill suspended">revoked</span>' : '<span class="status-pill active">active</span>') : '—'}</td>`;
    tr.addEventListener('click', () => jumpToUnit(r.unitId, r.venueId));
    tbody.appendChild(tr);
  });
}

$('#directory-search').addEventListener('input', renderDirectory);
$all('#directory-filter-chips .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    state.directoryFilter = chip.dataset.filter;
    $all('#directory-filter-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderDirectory();
  });
});
$('#directory-refresh-btn').addEventListener('click', loadDirectory);
$('#directory-all-properties-checkbox').addEventListener('change', loadDirectory);

$('#directory-export-btn').addEventListener('click', () => {
  const header = ['Name', 'Type', 'Property', 'Unit', 'Email', 'Phone', 'Expires', 'Status'];
  const lines = [header.map(csvEscape).join(',')];
  state.directory.forEach((r) => {
    lines.push(
      [
        r.name,
        r.type === 'owner' ? 'Owner' : 'Resident',
        r.venueName || '',
        r.unitName || '',
        r.email || '',
        r.phoneNumber || '',
        r.expirationDate ? isoToDateInput(r.expirationDate) : '',
        r.type === 'resident' ? (r.revoked ? 'revoked' : 'active') : ''
      ]
        .map(csvEscape)
        .join(',')
    );
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `directory-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- Unit detail ----------

async function openUnitDetail(id) {
  state.activeUnitId = id;
  setError($('#unit-detail-error'), null);
  setOk($('#unit-detail-ok'), null);
  $('#clients-table tbody').innerHTML = '';
  TAB_SECTIONS.forEach((tid) => hide($('#' + tid)));
  show($('#unit-detail'));

  try {
    const unit = await window.api.units.get(id);
    state.activeUnit = unit;
    $('#unit-detail-title').firstChild.textContent = `Unit: ${unitDisplayName(unit)} `;
    updateUnitStatusUi(unit);
    $('#edit-unit-name').value = unit.name || '';
    const resident = unitResident(unit);
    $('#edit-unit-resident-name').value = resident.name || '';
    $('#edit-unit-resident-email').value = resident.email || '';
    $('#edit-unit-resident-phone').value = resident.phoneNumber || '';
    // type/category/pmsUnitId/accessPoint are confirmed create-only — RUCKUS
    // rejects a re-sent `category` outright ("Changing unit category is not
    // supported") and silently ignores a changed `pmsUnitId` on PATCH
    // (verified live: waited 12s, value never took) — so they're shown here
    // read-only rather than as editable fields that would silently no-op.
    const readonlyParts = [];
    if (unit.type) readonlyParts.push(`Type: ${unit.type}`);
    if (unit.category) readonlyParts.push(`Category: ${unit.category}`);
    if (unit.pmsUnitId) readonlyParts.push(`PMS unit ID: ${unit.pmsUnitId}`);
    $('#edit-unit-readonly-fields').textContent = readonlyParts.length
      ? `${readonlyParts.join(' · ')} (set at creation, not editable)`
      : '';
    const portalUrl = unit._links && unit._links.residentPortal && unit._links.residentPortal.href;
    if (portalUrl) {
      $('#resident-portal-url').value = portalUrl;
      show($('#resident-portal-label'));
    } else {
      $('#resident-portal-url').value = '';
      hide($('#resident-portal-label'));
    }
    // Strip every known Unit field, not just the ones this form edits — RUCKUS
    // One rejects a PATCH that merely re-sends an unchanged value for some
    // fields (e.g. `category`) as an attempted change. Only genuinely unknown/
    // extra fields (if any) should land in the raw JSON box.
    const rest = { ...unit };
    ['name', 'resident', 'dpsks', 'id', 'pmsUnitId', 'type', 'category', 'status',
      'accessPoint', 'trafficControl', 'personaId', 'guestPersonaId', 'identityCount',
      'createdAt', 'updatedAt', '_links'].forEach((k) => delete rest[k]);
    $('#edit-unit-json').value = Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
    hide($('#add-identity-form'));
    await loadUnitLiveClients(id);
    await loadResidents(id);
    await loadBuiltinIdentities(id);
  } catch (err) {
    setError($('#unit-detail-error'), cleanErrorMessage(err));
  }
}

async function loadBuiltinIdentities(id) {
  $('#unit-dpsk-rows').innerHTML = '<p class="muted small">Loading…</p>';
  try {
    const { owner, guest } = await window.api.units.builtinIdentities(id);
    const residentName = state.activeUnit && state.activeUnit.resident && state.activeUnit.resident.name;
    renderUnitDpskRows([
      // qrName feeds the QR modal/print sheet's "Resident" line — the card
      // heading stays a generic slot label ("Unit (owner) Wi-Fi"), but a
      // move-in sheet should show the actual person's name, not the slot name.
      { label: 'Unit (owner) Wi-Fi', qrName: residentName || 'Unit (owner) Wi-Fi', identity: owner },
      { label: 'Guest Wi-Fi', qrName: 'Guest Wi-Fi', identity: guest }
    ]);
  } catch (err) {
    $('#unit-dpsk-rows').innerHTML = `<p class="error small">${escapeHtml(cleanErrorMessage(err))}</p>`;
  }
}

function renderUnitDpskRows(slots) {
  const container = $('#unit-dpsk-rows');
  container.innerHTML = '';

  slots.forEach(({ label, qrName, identity }) => {
    const row = document.createElement('div');
    row.className = 'dpsk-row';

    if (!identity) {
      row.innerHTML = `<h4>${escapeHtml(label)}</h4><p class="muted small">Not set up for this unit.</p>`;
      container.appendChild(row);
      return;
    }
    if (identity.error) {
      row.innerHTML = `<h4>${escapeHtml(label)}</h4><p class="error small">${escapeHtml(identity.error)}</p>`;
      container.appendChild(row);
      return;
    }

    const devices = liveClientsFor(identity.id);
    const devicesText = devices.length ? devices.map(formatLiveClient).join(', ') : 'None connected';
    row.innerHTML = `
      <h4>${escapeHtml(label)}</h4>
      <label>Passphrase<input type="text" class="dpsk-passphrase" value="${escapeHtml(identityPassphrase(identity))}" placeholder="(not set)" /></label>
      <label>VLAN<input type="number" class="dpsk-vlan" min="1" max="4094" value="${escapeHtml(identityVlan(identity))}" placeholder="Optional" /></label>
      <label>Description<input type="text" class="dpsk-description" value="${escapeHtml(identityDescription(identity))}" placeholder="Optional" /></label>
      <p class="small"><strong>Devices:</strong> ${escapeHtml(devicesText)}</p>
      <div class="row-actions"></div>`;
    const passphraseInput = row.querySelector('.dpsk-passphrase');
    const vlanInput = row.querySelector('.dpsk-vlan');
    const descriptionInput = row.querySelector('.dpsk-description');
    const actions = row.querySelector('.row-actions');

    const mkBtn = (text, onClick) => {
      const b = document.createElement('button');
      b.className = 'secondary row-btn';
      b.textContent = text;
      b.addEventListener('click', onClick);
      return b;
    };

    actions.appendChild(mkBtn('Save details', async () => {
      setError($('#unit-detail-error'), null);
      setOk($('#unit-detail-ok'), null);
      try {
        const vlanRaw = vlanInput.value;
        await window.api.identities.update({
          identityId: identity.id,
          patch: {
            vlan: vlanRaw ? Number(vlanRaw) : undefined,
            description: descriptionInput.value.trim() || undefined
          }
        });
        setOk($('#unit-detail-ok'), `${label} details saved.`);
        await loadBuiltinIdentities(state.activeUnitId);
      } catch (err) {
        setError($('#unit-detail-error'), cleanErrorMessage(err));
      }
    }));
    actions.appendChild(mkBtn('Generate new passphrase', async () => {
      if (!confirm(`Generate a new Wi-Fi passphrase for ${label}? The old one will stop working.`)) return;
      try {
        const result = await window.api.identities.regenerate(identity.id);
        await loadBuiltinIdentities(state.activeUnitId);
        setOk($('#unit-detail-ok'), 'New passphrase generated.');
        showWifiQr({ name: qrName || label, dpskPassphrase: result.passphrase });
      } catch (err) {
        setError($('#unit-detail-error'), cleanErrorMessage(err));
      }
    }));
    actions.appendChild(mkBtn('QR code', () => showWifiQr({ name: qrName || label, dpskPassphrase: passphraseInput.value.trim() })));

    container.appendChild(row);
  });
}

function updateUnitStatusUi(unit) {
  const label = unitStatusLabel(unitStatus(unit));
  const pill = $('#unit-detail-status');
  pill.textContent = label;
  pill.className = `status-pill ${label}`;
  $('#suspend-unit-btn').textContent = label === 'suspended' ? 'Reactivate unit' : 'Suspend unit';
}

$('#back-to-units').addEventListener('click', () => switchTab('units'));

function buildUnitEditPatch(extra) {
  return {
    name: $('#edit-unit-name').value.trim(),
    resident: {
      name: $('#edit-unit-resident-name').value.trim(),
      email: $('#edit-unit-resident-email').value.trim() || undefined,
      phoneNumber: normalizePhoneForApi($('#edit-unit-resident-phone').value)
    },
    ...extra
  };
}

$('#unit-edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('#unit-detail-error'), null);
  setOk($('#unit-detail-ok'), null);
  let extra;
  try {
    extra = parseExtraJson($('#edit-unit-json').value, $('#unit-detail-error'));
  } catch { return; }
  const patch = buildUnitEditPatch(extra);
  try {
    await window.api.units.update({ unitId: state.activeUnitId, patch });
    setOk($('#unit-detail-ok'), 'Saved.');
    await loadUnits();
  } catch (err) {
    setError($('#unit-detail-error'), cleanErrorMessage(err));
  }
});

$('#delete-unit-btn').addEventListener('click', async () => {
  if (!confirm('Delete this unit? This cannot be undone in RUCKUS One.')) return;
  try {
    await window.api.units.delete(state.activeUnitId);
    await loadUnits();
    switchTab('units');
  } catch (err) {
    setError($('#unit-detail-error'), cleanErrorMessage(err));
  }
});

$('#suspend-unit-btn').addEventListener('click', async () => {
  setOk($('#unit-detail-ok'), null);
  setError($('#unit-detail-error'), null);
  const currentlySuspended = unitStatusLabel(unitStatus(state.activeUnit || {})) === 'suspended';
  const nextStatus = currentlySuspended ? 'ENABLED' : 'DISABLED';
  if (!confirm(currentlySuspended ? 'Reactivate this unit?' : 'Suspend this unit? Residents will lose network access.')) return;
  try {
    const updated = await window.api.units.setStatus({ unitId: state.activeUnitId, status: nextStatus });
    state.activeUnit = { ...state.activeUnit, ...updated };
    updateUnitStatusUi(state.activeUnit);
    setOk($('#unit-detail-ok'), nextStatus === 'DISABLED' ? 'Unit suspended.' : 'Unit reactivated.');
    await loadUnits();
  } catch (err) {
    setError($('#unit-detail-error'), cleanErrorMessage(err));
  }
});

$('#move-out-btn').addEventListener('click', async () => {
  setOk($('#unit-detail-ok'), null);
  setError($('#unit-detail-error'), null);
  if (
    !confirm(
      'Move out this unit? This revokes the owner and guest Wi-Fi, removes and deletes every Additional Resident, and clears the resident of record. This cannot be undone.'
    )
  ) {
    return;
  }
  try {
    const result = await window.api.units.moveOut(state.activeUnitId);
    setOk(
      $('#unit-detail-ok'),
      `Move-out complete: ${result.revoked} Wi-Fi slot(s) revoked, ${result.removed} additional resident(s) removed.` +
        (result.errors.length ? ` ${result.errors.length} step(s) failed — check details below.` : '')
    );
    if (result.errors.length) setError($('#unit-detail-error'), result.errors.join(' '));
    await openUnitDetail(state.activeUnitId);
    await loadUnits();
  } catch (err) {
    setError($('#unit-detail-error'), cleanErrorMessage(err));
  }
});

$('#resend-creds-btn').addEventListener('click', async () => {
  setOk($('#unit-detail-ok'), null);
  setError($('#unit-detail-error'), null);
  try {
    await window.api.units.resendNotifications([state.activeUnitId]);
    setOk($('#unit-detail-ok'), 'Access details resent by email/SMS.');
  } catch (err) {
    setError($('#unit-detail-error'), cleanErrorMessage(err));
  }
});

$('#copy-portal-link-btn').addEventListener('click', async () => {
  const url = $('#resident-portal-url').value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    setOk($('#unit-detail-ok'), 'Portal link copied.');
  } catch (err) {
    setError($('#unit-detail-error'), cleanErrorMessage(err));
  }
});

$('#open-portal-link-btn').addEventListener('click', async () => {
  const url = $('#resident-portal-url').value;
  if (!url) return;
  try {
    await window.api.units.openResidentPortal(url);
  } catch (err) {
    setError($('#unit-detail-error'), cleanErrorMessage(err));
  }
});

// ---------- Additional Residents ----------
// RUCKUS One doesn't expose the unit's built-in owner/guest Wi-Fi passphrase
// to the property-manager API — only "resend the notification" (the
// "Resend Wi-Fi credentials" button) is available for those. This list is
// for extra residents beyond that: each is an "Identity" under the venue's
// Identity Group (confirmed live via RUCKUS One's own web UI network
// traffic — see lib/ruckus/identityGroups.js). Confirmed field names: id,
// name, email, phoneNumber, vlan, dpskPassphrase, revoked (boolean).
function identityId(i) { return i.id; }
function identityName(i) { return i.name || identityId(i) || '(unnamed)'; }
function identityEmail(i) { return i.email || ''; }
function identityPhone(i) { return i.phoneNumber || ''; }
function identityVlan(i) { return i.vlan ?? ''; }
function identityRevoked(i) { return Boolean(i.revoked); }
function identityPassphrase(i) { return i.dpskPassphrase || ''; }
function identityDescription(i) { return i.description || ''; }
function identityExpiration(i) { return i.expirationDate || ''; }
function isoToDateInput(iso) { return iso ? String(iso).slice(0, 10) : ''; }
function dateInputToIso(dateStr) { return dateStr ? `${dateStr}T00:00:00Z` : null; }

// An Identity's own `devices[]` field is registered/authorized devices, NOT
// currently-connected clients (confirmed live earlier this session — it's
// empty even for a device actively connected right now). Live connection
// status only comes from `/identities/clients/query`, keyed by identityId —
// fetched once per unit-detail load (see loadUnitLiveClients) and reused
// here for both the Additional Residents table and the Unit & Guest Wi-Fi
// cards, instead of the wrong `devices[]` field.
function liveClientsFor(identityId) {
  return (state.unitLiveClientsByIdentity && state.unitLiveClientsByIdentity[identityId]) || [];
}
function formatLiveClient(c) {
  const label = c.alias || c.clientMac || 'device';
  return c.ssid ? `${label} (${c.ssid})` : label;
}

async function loadUnitLiveClients(id) {
  state.unitLiveClientsByIdentity = {};
  try {
    const { clients } = await window.api.units.clients(id);
    (clients || []).forEach((c) => {
      if (!c.identityId) return;
      (state.unitLiveClientsByIdentity[c.identityId] ||= []).push(c);
    });
  } catch {
    // Connected-devices lookup is best-effort — residents/Wi-Fi cards still
    // render fine without it, just without live device info.
  }
}

state.selectedResidentIds = new Set();

function renderResidentBulkBar() {
  const count = state.selectedResidentIds.size;
  $('#resident-bulk-selected-count').textContent = `${count} selected`;
  (count > 0 ? show : hide)($('#resident-bulk-actions-bar'));
}

async function loadResidents(id) {
  state.selectedResidentIds.clear();
  renderResidentBulkBar();
  const tbody = $('#identities-table tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="muted small">Loading…</td></tr>';
  try {
    const rows = await window.api.units.residents(id);
    state.currentResidents = rows;
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted small">No additional residents added yet.</td></tr>';
      $('#residents-select-all').checked = false;
      return;
    }
    rows.forEach((idy) => renderIdentityRow(id, idy, tbody));
    $('#residents-select-all').checked = rows.every((idy) => state.selectedResidentIds.has(identityId(idy)));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="error small">${escapeHtml(cleanErrorMessage(err))}</td></tr>`;
  }
}

function renderIdentityRow(uid, idy, tbody) {
  const iid = identityId(idy);
  const revoked = identityRevoked(idy);
  const contact = [identityEmail(idy), identityPhone(idy)].filter(Boolean).join(' / ') || '—';
  const devices = liveClientsFor(iid);
  const description = identityDescription(idy);
  const expiration = identityExpiration(idy);
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="checkbox-col"><input type="checkbox" class="resident-row-checkbox" ${state.selectedResidentIds.has(iid) ? 'checked' : ''} /></td>
    <td>${escapeHtml(identityName(idy))}${description ? `<div class="muted small">${escapeHtml(description)}</div>` : ''}</td>
    <td class="small">${escapeHtml(contact)}</td>
    <td class="small">${escapeHtml(String(identityVlan(idy) || '—'))}</td>
    <td class="small">${devices.length ? escapeHtml(devices.map(formatLiveClient).join(', ')) : '—'}</td>
    <td>${revoked ? '<span class="status-pill suspended">revoked</span>' : '<span class="status-pill active">active</span>'}${expiration ? `<div class="muted small">expires ${escapeHtml(isoToDateInput(expiration))}</div>` : ''}</td>
    <td><div class="actions-grid"></div></td>`;
  const checkbox = tr.querySelector('.resident-row-checkbox');
  checkbox.addEventListener('click', () => {
    if (checkbox.checked) state.selectedResidentIds.add(iid);
    else state.selectedResidentIds.delete(iid);
    const allChecked = $all('#identities-table tbody .resident-row-checkbox').every((cb) => cb.checked);
    $('#residents-select-all').checked = allChecked;
    renderResidentBulkBar();
  });
  const actions = tr.children[6].firstChild;

  const mkBtn = (label, onClick, cls = 'secondary') => {
    const b = document.createElement('button');
    b.className = `${cls} row-btn`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  actions.appendChild(mkBtn('Edit', () => openEditIdentityForm(idy)));
  actions.appendChild(mkBtn('QR', () => showWifiQr(idy)));

  tbody.appendChild(tr);
}

$('#residents-select-all').addEventListener('click', () => {
  const checked = $('#residents-select-all').checked;
  $all('#identities-table tbody .resident-row-checkbox').forEach((cb) => { cb.checked = checked; });
  (state.currentResidents || []).forEach((idy) => {
    const iid = identityId(idy);
    if (checked) state.selectedResidentIds.add(iid);
    else state.selectedResidentIds.delete(iid);
  });
  renderResidentBulkBar();
});

$('#resident-bulk-clear-btn').addEventListener('click', () => {
  state.selectedResidentIds.clear();
  loadResidents(state.activeUnitId);
});

$('#resident-bulk-passphrase-btn').addEventListener('click', () => runBulkAction(
  Array.from(state.selectedResidentIds),
  (id) => window.api.identities.regenerate(id),
  {
    confirmMessage: 'Generate a new Wi-Fi passphrase for {n} resident(s)? The old ones will stop working.',
    errorTarget: $('#identities-error'),
    onDone: async () => { state.selectedResidentIds.clear(); await loadResidents(state.activeUnitId); }
  }
));

$('#resident-bulk-revoke-btn').addEventListener('click', () => runBulkAction(
  Array.from(state.selectedResidentIds),
  (id) => window.api.identities.setRevoked({ identityId: id, revoked: true }),
  {
    confirmMessage: 'Revoke Wi-Fi access for {n} resident(s)?',
    errorTarget: $('#identities-error'),
    onDone: async () => { state.selectedResidentIds.clear(); await loadResidents(state.activeUnitId); }
  }
));

$('#resident-bulk-unrevoke-btn').addEventListener('click', () => runBulkAction(
  Array.from(state.selectedResidentIds),
  (id) => window.api.identities.setRevoked({ identityId: id, revoked: false }),
  {
    confirmMessage: 'Unrevoke Wi-Fi access for {n} resident(s)?',
    errorTarget: $('#identities-error'),
    onDone: async () => { state.selectedResidentIds.clear(); await loadResidents(state.activeUnitId); }
  }
));

$('#resident-bulk-remove-btn').addEventListener('click', () => runBulkAction(
  Array.from(state.selectedResidentIds),
  (id) => window.api.units.removeIdentity({ unitId: state.activeUnitId, identityId: id }),
  {
    confirmMessage: 'Remove {n} resident(s) from this unit? This cannot be undone.',
    errorTarget: $('#identities-error'),
    onDone: async () => { state.selectedResidentIds.clear(); await loadResidents(state.activeUnitId); }
  }
));

$('#associate-identity-btn').addEventListener('click', async () => {
  const idyId = $('#identity-id-input').value.trim();
  if (!idyId) return;
  try {
    await window.api.units.associateIdentity({ unitId: state.activeUnitId, identityId: idyId });
    $('#identity-id-input').value = '';
    await loadResidents(state.activeUnitId);
  } catch (err) {
    setError($('#identities-error'), cleanErrorMessage(err));
  }
});

// ---------- Add / edit resident form ----------

state.editingIdentityId = null;

function resetIdentityForm() {
  state.editingIdentityId = null;
  $('#add-identity-form').reset();
  $('#add-identity-form').querySelector('button[type=submit]').textContent = 'Create passphrase';
}

$('#add-identity-btn').addEventListener('click', () => {
  resetIdentityForm();
  setError($('#identities-error'), null);
  show($('#add-identity-form'));
});
$('#cancel-add-identity').addEventListener('click', () => {
  hide($('#add-identity-form'));
  resetIdentityForm();
});

function openEditIdentityForm(idy) {
  state.editingIdentityId = identityId(idy);
  $('#new-identity-name').value = identityName(idy) || '';
  $('#new-identity-email').value = identityEmail(idy) || '';
  $('#new-identity-phone').value = identityPhone(idy) || '';
  $('#new-identity-vlan').value = identityVlan(idy) || '';
  $('#new-identity-description').value = identityDescription(idy);
  $('#new-identity-expiration').value = isoToDateInput(identityExpiration(idy));
  const rest = { ...idy };
  ['id', 'groupId', 'parentId', 'name', 'email', 'phoneNumber', 'dpskGuid', 'dpskPassphrase',
    'identityId', 'revoked', 'vlan', 'vni', 'createdAt', 'updatedAt', 'devices', 'deviceCount',
    'clientCount', 'certificateCount', 'ethernetPorts', 'switches', 'meteringProfileId',
    'description', 'expirationDate', 'displayName', 'externalIdentityId', 'lastLoginAt', 'primary', 'links'
  ].forEach((k) => delete rest[k]);
  $('#new-identity-json').value = Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
  setError($('#identities-error'), null);
  show($('#add-identity-form'));
  $('#add-identity-form').querySelector('button[type=submit]').textContent = 'Save changes';
  $('#add-identity-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('#add-identity-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('#identities-error'), null);
  let extra;
  try {
    extra = parseExtraJson($('#new-identity-json').value, $('#identities-error'));
  } catch { return; }

  const body = {
    username: $('#new-identity-name').value.trim(),
    email: $('#new-identity-email').value.trim() || undefined,
    phoneNumber: normalizePhoneForApi($('#new-identity-phone').value),
    vlanId: $('#new-identity-vlan').value.trim() ? Number($('#new-identity-vlan').value.trim()) : undefined,
    description: $('#new-identity-description').value.trim() || undefined,
    expirationDate: dateInputToIso($('#new-identity-expiration').value) || undefined,
    ...extra
  };

  try {
    if (state.editingIdentityId) {
      await window.api.identities.update({ identityId: state.editingIdentityId, patch: body });
      setOk($('#unit-detail-ok'), 'Resident updated.');
    } else {
      // main.js fills in a generated passphrase if none is typed here.
      await window.api.identities.create({ unitId: state.activeUnitId, body });
      setOk($('#unit-detail-ok'), 'Resident added.');
    }
    hide($('#add-identity-form'));
    resetIdentityForm();
    await loadResidents(state.activeUnitId);
  } catch (err) {
    setError($('#identities-error'), cleanErrorMessage(err));
  }
});

// ---------- Wi-Fi QR code ----------

function escapeWifiField(s) {
  return String(s || '').replace(/([\\;,":])/g, '\\$1');
}

function showWifiQr(idy) {
  const ssid = state.networkSsid || '';
  const passphrase = identityPassphrase(idy);
  const label = identityName(idy);
  $('#qr-identity-label').textContent = label;
  $('#qr-passphrase-text').textContent = passphrase || '(not available — use "New passphrase" to set one)';
  $('#qr-code-container').innerHTML = '';
  hide($('#qr-note'));
  state.qrDownloadLabel = label;

  if (!ssid) {
    $('#qr-note').textContent = 'Set the Wi-Fi network name (SSID) in Settings to generate a scannable QR code.';
    show($('#qr-note'));
    hide($('#qr-download-btn'));
    hide($('#qr-print-btn'));
    hide($('#qr-pdf-btn'));
  } else if (!passphrase) {
    $('#qr-note').textContent = 'No passphrase value available for this resident yet.';
    show($('#qr-note'));
    hide($('#qr-download-btn'));
    hide($('#qr-print-btn'));
    hide($('#qr-pdf-btn'));
  } else {
    const text = `WIFI:T:WPA;S:${escapeWifiField(ssid)};P:${escapeWifiField(passphrase)};;`;
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    $('#qr-code-container').innerHTML = qr.createSvgTag(6, 4);
    show($('#qr-download-btn'));
    show($('#qr-print-btn'));
    show($('#qr-pdf-btn'));
  }
  show($('#qr-modal'));
}

// Builds one .print-sheet-page element from a plain data object — shared by
// the single QR-modal sheet and a bulk multi-unit print/PDF from the Units
// tab. qrSvgHtml is trusted markup from our own qrcode.js output (or a
// previously-rendered modal SVG's outerHTML), so it's inserted as-is, same
// as the rest of the app's QR handling; logoSrc is set via the DOM property
// rather than embedded in the HTML string since it's often a very long data
// URI.
function buildPrintSheetPage({ logoSrc, appName, unitLabel, residentLabel, qrSvgHtml, ssid, passphrase }) {
  const page = document.createElement('div');
  page.className = 'print-sheet-page';
  page.innerHTML = `
    <img class="print-sheet-logo" alt="" />
    <h1 class="print-sheet-app-name">${escapeHtml(appName)}</h1>
    <h2 class="print-sheet-unit">${escapeHtml(unitLabel)}</h2>
    <p class="print-sheet-resident">${escapeHtml(residentLabel)}</p>
    <div class="print-sheet-qr">${qrSvgHtml}</div>
    <table>
      <tr><td>Wi-Fi network</td><td>${escapeHtml(ssid)}</td></tr>
      <tr><td>Password</td><td>${escapeHtml(passphrase)}</td></tr>
    </table>
    <p>Scan the QR code with your phone's camera to join automatically, or open your device's Wi-Fi settings and enter the network name and password above.</p>
  `;
  page.querySelector('.print-sheet-logo').src = logoSrc;
  return page;
}

// Fills #print-wifi-sheet with one page per entry in `sheets` right before
// printing/exporting, so a bulk job produces one PDF/print job with N pages
// (one per selected unit) instead of N separate print dialogs.
function populatePrintSheet(sheets) {
  const container = $('#print-wifi-sheet');
  container.innerHTML = '';
  sheets.forEach((sheet) => container.appendChild(buildPrintSheetPage(sheet)));
  return sheets.length > 0;
}

// Sheet data for whatever's currently shown in the QR modal — reuses the
// modal's own already-rendered SVG rather than regenerating it, so the
// printed/exported code always matches exactly what's on screen.
function currentQrSheetData() {
  const svgEl = $('#qr-code-container svg');
  if (!svgEl) return null;
  return {
    logoSrc: state.branding && state.branding.logoDataUri ? state.branding.logoDataUri : DEFAULT_LOGO_SRC,
    appName: (state.branding && state.branding.appName) || 'DwellLink',
    unitLabel: state.activeUnit ? `Unit: ${unitDisplayName(state.activeUnit)}` : '',
    residentLabel: `Resident: ${$('#qr-identity-label').textContent}`,
    qrSvgHtml: svgEl.outerHTML,
    ssid: state.networkSsid || '',
    passphrase: $('#qr-passphrase-text').textContent
  };
}

async function downloadPrintSheetPdf(filename) {
  const bytes = await window.api.print.wifiSheetPdf();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

$('#qr-print-btn').addEventListener('click', () => {
  const sheet = currentQrSheetData();
  if (sheet && populatePrintSheet([sheet])) window.print();
});

$('#qr-pdf-btn').addEventListener('click', async () => {
  const sheet = currentQrSheetData();
  if (!sheet || !populatePrintSheet([sheet])) return;
  const btn = $('#qr-pdf-btn');
  btn.disabled = true;
  try {
    const unitSlug = state.activeUnit ? unitDisplayName(state.activeUnit).replace(/[^a-z0-9]+/gi, '-') : 'unit';
    await downloadPrintSheetPdf(`wifi-move-in-${unitSlug}.pdf`);
  } catch (err) {
    showToast(cleanErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

$('#qr-close-btn').addEventListener('click', () => hide($('#qr-modal')));
$('#qr-modal').addEventListener('click', (e) => {
  if (e.target.id === 'qr-modal') hide($('#qr-modal'));
});

$('#qr-download-btn').addEventListener('click', () => {
  const svgEl = $('#qr-code-container svg');
  if (!svgEl) return;
  const size = 1024;
  const svgText = new XMLSerializer().serializeToString(svgEl);
  const svgDataUri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (state.qrDownloadLabel || 'wifi').replace(/[^a-z0-9-_]+/gi, '-');
      a.href = url;
      a.download = `${safeName}-wifi-qr.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };
  img.src = svgDataUri;
});

// ---------- Connected devices ----------

$('#refresh-clients-btn').addEventListener('click', async () => {
  const tbody = $('#clients-table tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="muted small">Loading…</td></tr>';
  try {
    const data = await window.api.units.clients(state.activeUnitId);
    const rows = data.clients || [];
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted small">No connected devices found.</td></tr>';
      return;
    }
    rows.forEach((c) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="small">${escapeHtml(c.clientMac || '—')}</td>
        <td class="small">${escapeHtml(c.ssid || '—')}${c.apMac ? ` / ${escapeHtml(c.apMac)}` : ''}</td>
        <td class="small">${escapeHtml(c.username || '—')}</td>
        <td><div class="actions-grid"></div></td>`;
      if (c.identityId) {
        const actionsCell = tr.children[3].firstChild;
        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'secondary small row-btn';
        detailsBtn.textContent = 'Details';
        detailsBtn.addEventListener('click', async () => {
          try {
            detailsBtn.disabled = true;
            detailsBtn.textContent = 'Loading…';
            const detail = await window.api.identities.clientDetail(c.identityId);
            showClientDetail(detail, c);
          } catch (err) {
            showToast(cleanErrorMessage(err), 'error');
          } finally {
            detailsBtn.disabled = false;
            detailsBtn.textContent = 'Details';
          }
        });
        actionsCell.appendChild(detailsBtn);

        const disconnectBtn = document.createElement('button');
        disconnectBtn.className = 'secondary small row-btn';
        disconnectBtn.textContent = 'Remove from network';
        disconnectBtn.title = 'Disconnects this device right now — it can reconnect on its own unless you also block the identity.';
        disconnectBtn.addEventListener('click', async () => {
          if (!confirm(`Disconnect ${c.clientMac || 'this device'} from the network now?`)) return;
          try {
            disconnectBtn.disabled = true;
            const detail = await window.api.identities.clientDetail(c.identityId);
            const serialNumber = detail && detail.apInformation && detail.apInformation.serialNumber;
            if (!serialNumber) throw new Error('Could not determine which AP this device is connected to.');
            await window.api.units.disconnectClient({ serialNumber, clientMac: c.clientMac });
            setOk($('#unit-detail-ok'), 'Device disconnected.');
            $('#refresh-clients-btn').click();
          } catch (err) {
            showToast(cleanErrorMessage(err), 'error');
          } finally {
            disconnectBtn.disabled = false;
          }
        });
        actionsCell.appendChild(disconnectBtn);

        const blockBtn = document.createElement('button');
        blockBtn.className = 'danger small row-btn';
        blockBtn.textContent = 'Block identity';
        blockBtn.title = 'Revokes this resident’s whole Wi-Fi passphrase — a permanent block, not just this one device.';
        blockBtn.addEventListener('click', async () => {
          if (!confirm(`Revoke Wi-Fi access for ${c.username || 'this resident'}? This blocks all of their devices, not just this one.`)) return;
          try {
            blockBtn.disabled = true;
            await window.api.identities.setRevoked({ identityId: c.identityId, revoked: true });
            setOk($('#unit-detail-ok'), 'Identity blocked (revoked).');
            $('#refresh-clients-btn').click();
            if (state.activeUnitId) {
              await loadResidents(state.activeUnitId);
              await loadBuiltinIdentities(state.activeUnitId);
            }
          } catch (err) {
            showToast(cleanErrorMessage(err), 'error');
          } finally {
            blockBtn.disabled = false;
          }
        });
        actionsCell.appendChild(blockBtn);
      }
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="error small">${escapeHtml(cleanErrorMessage(err))}</td></tr>`;
  }
});

function detailRow(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd>`;
}

function showClientDetail(d, fallback) {
  const body = $('#client-detail-body');
  if (!d) {
    body.innerHTML = `<div class="section-label muted" style="border-top:none;margin-top:0;">
      No live connection details available for this client right now (it may have just disconnected).</div>
      ${detailRow('Username', fallback && fallback.username)}
      ${detailRow('SSID', fallback && fallback.ssid)}`;
    show($('#client-detail-modal'));
    return;
  }
  const ap = d.apInformation || {};
  const net = d.networkInformation || {};
  const sig = d.signalStatus || {};
  const radio = d.radioStatus || {};
  const venue = d.venueInformation || {};
  body.innerHTML = [
    detailRow('Hostname', d.hostname),
    detailRow('Alias', d.alias),
    detailRow('Device', [d.modelName, d.deviceType].filter(Boolean).join(' — ')),
    detailRow('OS', d.osType),
    detailRow('MAC address', d.macAddress),
    detailRow('IPv4', d.ipAddress),
    detailRow('IPv6', d.ipv6Address),
    detailRow('Username', d.username),
    '<div class="section-label">Network</div>',
    detailRow('Venue', venue.name),
    detailRow('Access point', ap.name),
    detailRow('SSID', net.ssid),
    detailRow('VLAN', net.vlan),
    detailRow('Encryption', net.encryptionMethod),
    detailRow('Band / Channel', [d.band, radio.channel].filter(Boolean).join(' / ')),
    '<div class="section-label">Status</div>',
    detailRow('Health', sig.health),
    detailRow('RSSI', sig.rssi !== undefined ? `${sig.rssi} dBm` : undefined),
    detailRow('SNR', sig.snr !== undefined ? `${sig.snr} dB` : undefined),
    detailRow('Connected since', d.connectedTime ? new Date(d.connectedTime).toLocaleString() : undefined),
    detailRow('Last updated', d.lastUpdatedTime ? new Date(d.lastUpdatedTime).toLocaleString() : undefined)
  ].join('');
  show($('#client-detail-modal'));
}

$('#client-detail-close-btn').addEventListener('click', () => hide($('#client-detail-modal')));
$('#client-detail-modal').addEventListener('click', (e) => {
  if (e.target.id === 'client-detail-modal') hide($('#client-detail-modal'));
});

// ---------- Staff (admin) ----------

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function venueName(id) {
  const v = state.venues.find((x) => x.id === id);
  return v ? v.name : id;
}

// Shared by the "Add staff account" form and the "Edit access" card — a
// checklist of every property this admin can see (which, for an admin, is
// always all of them, so front-desk assignment always has the full list to
// pick from regardless of that front-desk account's own current access).
function renderVenueCheckboxList(container, checkedIds) {
  const checked = new Set(checkedIds || []);
  container.innerHTML = '';
  if (!state.venues.length) {
    container.innerHTML = '<p class="muted small">No properties configured yet.</p>';
    return;
  }
  state.venues.forEach((v) => {
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = v.id;
    cb.checked = checked.has(v.id);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(v.name));
    container.appendChild(label);
  });
}

function getCheckedVenueIds(container) {
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
}

state.editingUserVenuesId = null;

function openEditUserVenues(u) {
  state.editingUserVenuesId = u.id;
  $('#edit-user-venues-username').textContent = u.username;
  renderVenueCheckboxList($('#edit-user-venues-list'), u.venueIds || []);
  setError($('#edit-user-venues-error'), null);
  hide($('#add-user-card'));
  show($('#edit-user-venues-card'));
}

$('#save-user-venues-btn').addEventListener('click', async () => {
  setError($('#edit-user-venues-error'), null);
  try {
    await window.api.users.setVenues({
      id: state.editingUserVenuesId,
      venueIds: getCheckedVenueIds($('#edit-user-venues-list'))
    });
    hide($('#edit-user-venues-card'));
    loadUsers();
  } catch (err) {
    setError($('#edit-user-venues-error'), cleanErrorMessage(err));
  }
});
$('#cancel-edit-user-venues').addEventListener('click', () => hide($('#edit-user-venues-card')));

async function loadUsers() {
  if (state.user.role !== 'admin') return;
  const tbody = $('#users-table tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="muted small">Loading…</td></tr>';
  try {
    const users = await window.api.users.list();
    tbody.innerHTML = '';
    users.forEach((u) => {
      const tr = document.createElement('tr');
      const propertiesText = u.role === 'admin'
        ? 'All properties'
        : ((u.venueIds && u.venueIds.length) ? u.venueIds.map(venueName).join(', ') : '— none —');
      tr.innerHTML = `<td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.role)}</td>
        <td class="small">${escapeHtml(propertiesText)}</td>
        <td class="muted small">${escapeHtml(u.created_at)}</td><td></td>`;
      if (u.role === 'frontdesk') {
        const editAccessBtn = document.createElement('button');
        editAccessBtn.className = 'secondary row-btn';
        editAccessBtn.textContent = 'Edit access';
        editAccessBtn.addEventListener('click', () => openEditUserVenues(u));
        tr.children[4].appendChild(editAccessBtn);
      }
      if (u.id !== state.user.id) {
        const resetBtn = document.createElement('button');
        resetBtn.className = 'secondary row-btn';
        resetBtn.textContent = 'Reset password';
        resetBtn.addEventListener('click', async () => {
          if (!confirm(`Reset the password for "${u.username}"? They'll need the new password to sign in.`)) return;
          const newPassword = generateTempPassword();
          try {
            await window.api.users.resetPassword({ id: u.id, newPassword });
            alert(`New temporary password for ${u.username}:\n\n${newPassword}\n\nShare this with them directly — it won't be shown again, and they should change it from Settings after signing in.`);
          } catch (err) {
            showToast(cleanErrorMessage(err), 'error');
          }
        });
        tr.children[4].appendChild(resetBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'danger row-btn';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', async () => {
          if (!confirm(`Delete staff account "${u.username}"?`)) return;
          await window.api.users.delete(u.id);
          loadUsers();
        });
        tr.children[4].appendChild(deleteBtn);
      }
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="error small">${escapeHtml(cleanErrorMessage(err))}</td></tr>`;
  }
}

function updateNewUserVenuesVisibility() {
  (($('#new-user-role').value === 'frontdesk') ? show : hide)($('#new-user-venues-field'));
}
$('#new-user-role').addEventListener('change', updateNewUserVenuesVisibility);

$('#add-user-btn').addEventListener('click', () => {
  $('#add-user-form').reset();
  setError($('#add-user-error'), null);
  renderVenueCheckboxList($('#new-user-venues-list'), []);
  updateNewUserVenuesVisibility();
  hide($('#edit-user-venues-card'));
  show($('#add-user-card'));
});
$('#cancel-add-user').addEventListener('click', () => hide($('#add-user-card')));

$('#add-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('#add-user-error'), null);
  try {
    await window.api.users.create({
      username: $('#new-user-username').value.trim(),
      password: $('#new-user-password').value,
      role: $('#new-user-role').value,
      venueIds: getCheckedVenueIds($('#new-user-venues-list'))
    });
    hide($('#add-user-card'));
    loadUsers();
  } catch (err) {
    setError($('#add-user-error'), cleanErrorMessage(err));
  }
});

// ---------- Audit log ----------

state.auditLog = [];

async function loadAudit() {
  if (state.user.role !== 'admin') return;
  setError($('#audit-error'), null);
  try {
    state.auditLog = await window.api.audit.list();
    const actions = Array.from(new Set(state.auditLog.map((r) => r.action))).sort();
    const filterSelect = $('#audit-action-filter');
    const currentFilter = filterSelect.value;
    filterSelect.innerHTML = '<option value="">All actions</option>';
    actions.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      filterSelect.appendChild(opt);
    });
    filterSelect.value = actions.includes(currentFilter) ? currentFilter : '';
    renderAudit();
  } catch (err) {
    setError($('#audit-error'), cleanErrorMessage(err));
  }
}

function auditDetailSummary(detail) {
  if (!detail) return '—';
  try {
    const s = JSON.stringify(detail);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return String(detail);
  }
}

function renderAudit() {
  const search = $('#audit-search').value.trim().toLowerCase();
  const actionFilter = $('#audit-action-filter').value;
  const rows = state.auditLog.filter((r) => {
    if (actionFilter && r.action !== actionFilter) return false;
    if (!search) return true;
    const haystack = [r.username, r.action, auditDetailSummary(r.detail)].join(' ').toLowerCase();
    return haystack.includes(search);
  });
  const tbody = $('#audit-table tbody');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted small">No matching audit entries.</td></tr>';
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.innerHTML = `<td class="small">${escapeHtml(r.created_at)}</td>
      <td class="small">${escapeHtml(r.username || '—')}</td>
      <td class="small">${escapeHtml(r.action)}</td>
      <td class="small muted">${escapeHtml(auditDetailSummary(r.detail))}</td>`;
    tr.addEventListener('click', () => showAuditDetail(r));
    tbody.appendChild(tr);
  });
}

function showAuditDetail(r) {
  $('#audit-detail-time').textContent = r.created_at;
  $('#audit-detail-user').textContent = r.username || '—';
  $('#audit-detail-action').textContent = r.action;
  $('#audit-detail-json').textContent = r.detail ? JSON.stringify(r.detail, null, 2) : '(no additional detail)';
  show($('#audit-detail-modal'));
}

$('#audit-detail-close-btn').addEventListener('click', () => hide($('#audit-detail-modal')));
$('#audit-search').addEventListener('input', renderAudit);
$('#audit-action-filter').addEventListener('change', renderAudit);
$('#audit-refresh-btn').addEventListener('click', loadAudit);

$('#audit-export-btn').addEventListener('click', () => {
  const lines = [['Time', 'User', 'Action', 'Detail'].map(csvEscape).join(',')];
  state.auditLog.forEach((r) => {
    lines.push(
      [r.created_at, r.username || '', r.action, r.detail ? JSON.stringify(r.detail) : ''].map(csvEscape).join(',')
    );
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- Settings ----------

// Seeds a <select> with a single option representing its already-saved
// value, before the real list has been loaded via "Load from RUCKUS One" —
// a <select>'s .value setter only takes effect if a matching <option>
// already exists, so this has to run before anything tries to set .value.
function seedSelect(select, currentValue) {
  select.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = currentValue || '';
  opt.textContent = currentValue ? `Current: ${currentValue}` : '(none selected — click "Load from RUCKUS One")';
  select.appendChild(opt);
}

// Replaces a <select>'s options with a fresh list while preserving the
// current selection — if it's not in the new list (stale/deleted resource),
// keeps it as a fallback option instead of silently discarding it.
function populateSelect(select, options) {
  const currentValue = select.value;
  select.innerHTML = '';
  if (!options.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(none found)';
    select.appendChild(opt);
  }
  options.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  });
  if (currentValue && !options.some((o) => o.value === currentValue)) {
    const opt = document.createElement('option');
    opt.value = currentValue;
    opt.textContent = `Current: ${currentValue}`;
    select.appendChild(opt);
  }
  select.value = currentValue || (options[0] && options[0].value) || '';
}

async function refreshWifiNetworksForVenue(venueId) {
  try {
    const networks = await window.api.discovery.wifiNetworks(venueId);
    populateSelect(
      $('#network-ssid-input'),
      networks.map((n) => ({
        value: n.ssid,
        label: n.name && n.name !== n.ssid ? `${n.ssid} (${n.name})` : n.ssid
      }))
    );
  } catch (err) {
    setError($('#venue-form-error'), cleanErrorMessage(err));
  }
}

// ---------- Properties (multi-venue) ----------
// One local install can now manage several RUCKUS venues ("properties").
// Everything else in the app (units, residents, Wi-Fi) is already scoped by
// venueId per RUCKUS API call, so switching which venue is "active" here is
// all it takes to make the whole app operate on a different property.

state.editingVenueId = null;

function renderCurrentVenueLabel() {
  const label = $('#current-venue-label');
  const switcher = $('#venue-switcher');
  const active = state.venues.find((v) => v.id === state.activeVenueId);
  // Anyone (admin or front desk) managing 2+ properties gets a quick-switch
  // dropdown right in the sidebar instead of a plain label. Front desk only
  // ever sees their own assigned properties here — state.venues is already
  // filtered server-side to that set (see settings:get in main.js) — so a
  // front-desk account restricted to one building still just sees the plain
  // name, same as a single-property install.
  if (state.venues.length > 1) {
    hide(label);
    switcher.innerHTML = '';
    state.venues.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      switcher.appendChild(opt);
    });
    switcher.value = state.activeVenueId;
    show(switcher);
  } else {
    hide(switcher);
    if (active) {
      label.textContent = active.name;
      show(label);
    } else {
      hide(label);
    }
  }
}

$('#venue-switcher').addEventListener('change', async () => {
  const id = $('#venue-switcher').value;
  try {
    await window.api.venues.setActive(id);
    await loadSettings();
    switchTab('units');
    await loadUnits();
    await loadDirectory();
  } catch (err) {
    showToast(cleanErrorMessage(err), 'error');
    await loadSettings();
  }
});

function renderVenuesTable() {
  const tbody = $('#venues-table tbody');
  tbody.innerHTML = '';
  (state.venues.length ? hide : show)($('#venues-empty'));
  state.venues.forEach((v) => {
    const isActive = v.id === state.activeVenueId;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(v.name)}<div class="muted small">${escapeHtml(v.id)}</div></td>
      <td class="small">${escapeHtml(v.dpskPoolId || '—')}</td>
      <td class="small">${escapeHtml(v.networkSsid || '—')}</td>
      <td>${isActive ? '<span class="status-pill active">active</span>' : ''}</td>
      <td><div class="actions-grid"></div></td>`;
    const actions = tr.children[4].firstChild;

    if (!isActive) {
      const activateBtn = document.createElement('button');
      activateBtn.className = 'secondary row-btn';
      activateBtn.textContent = 'Set active';
      activateBtn.addEventListener('click', async () => {
        setError($('#settings-error'), null);
        setOk($('#settings-ok'), null);
        try {
          await window.api.venues.setActive(v.id);
          setOk($('#settings-ok'), `Now managing ${v.name}.`);
          await loadSettings();
          switchTab('units');
          await loadUnits();
          await loadDirectory();
        } catch (err) {
          setError($('#settings-error'), cleanErrorMessage(err));
        }
      });
      actions.appendChild(activateBtn);
    }

    const editBtn = document.createElement('button');
    editBtn.className = 'secondary row-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openVenueForm(v));
    actions.appendChild(editBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'danger row-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      if (!confirm(`Remove "${v.name}" from this install? This only removes it from DwellLink — nothing changes in RUCKUS One.`)) return;
      setError($('#settings-error'), null);
      setOk($('#settings-ok'), null);
      try {
        await window.api.venues.remove(v.id);
        setOk($('#settings-ok'), 'Property removed.');
        await loadSettings();
        if (v.id === state.activeVenueId || isActive) {
          await loadUnits();
          await loadDirectory();
        }
      } catch (err) {
        setError($('#settings-error'), cleanErrorMessage(err));
      }
    });
    actions.appendChild(removeBtn);

    tbody.appendChild(tr);
  });
}

function openVenueForm(venue) {
  state.editingVenueId = venue ? venue.id : null;
  setError($('#venue-form-error'), null);
  $('#venue-form-title').textContent = venue ? `Edit ${venue.name}` : 'Add a Property';
  $('#save-venue-btn').textContent = venue ? 'Save changes' : 'Add property';
  if (venue) {
    hide($('#venue-picker-label'));
    $('#venue-editing-name').textContent = venue.id;
    show($('#venue-editing-name'));
    $('#venue-name-input').value = venue.name || '';
    seedSelect($('#dpsk-pool-id-input'), venue.dpskPoolId);
    seedSelect($('#network-ssid-input'), venue.networkSsid);
  } else {
    show($('#venue-picker-label'));
    hide($('#venue-editing-name'));
    $('#venue-name-input').value = '';
    seedSelect($('#venue-id-input'), '');
    seedSelect($('#dpsk-pool-id-input'), '');
    seedSelect($('#network-ssid-input'), '');
  }
  show($('#venue-form'));
  $('#venue-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closeVenueForm() {
  state.editingVenueId = null;
  hide($('#venue-form'));
}

$('#add-venue-btn').addEventListener('click', () => openVenueForm(null));
$('#cancel-venue-form-btn').addEventListener('click', closeVenueForm);

$('#refresh-ruckus-lists-btn').addEventListener('click', async () => {
  setError($('#venue-form-error'), null);
  const btn = $('#refresh-ruckus-lists-btn');
  btn.disabled = true;
  try {
    const editingVenue = state.editingVenueId ? state.venues.find((v) => v.id === state.editingVenueId) : null;
    let targetVenueId = editingVenue ? editingVenue.id : null;

    if (!editingVenue) {
      const venues = await window.api.discovery.venues();
      const alreadyAdded = new Set(state.venues.map((v) => v.id));
      populateSelect(
        $('#venue-id-input'),
        venues
          .filter((v) => !alreadyAdded.has(v.id))
          .map((v) => ({ value: v.id, label: [v.name, v.city].filter(Boolean).join(' — ') }))
      );
      targetVenueId = $('#venue-id-input').value;
      const label = $('#venue-id-input').selectedOptions[0] && $('#venue-id-input').selectedOptions[0].textContent;
      if (label) $('#venue-name-input').value = label.split(' — ')[0];
    }

    const pools = await window.api.discovery.dpskPools();
    // Best-effort: Property Management may not be set up on this venue yet
    // (or the lookup may fail) — fine, just no recommendation.
    const recommendedPoolId = targetVenueId
      ? await window.api.discovery.recommendedDpskPool(targetVenueId).catch(() => null)
      : null;
    populateSelect(
      $('#dpsk-pool-id-input'),
      pools.map((p) => {
        const ssids = Array.isArray(p.ssids) && p.ssids.length ? ` (${p.ssids.join(', ')})` : '';
        const recommended = recommendedPoolId && p.id === recommendedPoolId ? ' — recommended for this venue' : '';
        return { value: p.id, label: `${p.name}${ssids}${recommended}` };
      })
    );
    if (editingVenue) $('#dpsk-pool-id-input').value = editingVenue.dpskPoolId || $('#dpsk-pool-id-input').value;

    if (targetVenueId) await refreshWifiNetworksForVenue(targetVenueId);
    if (editingVenue) $('#network-ssid-input').value = editingVenue.networkSsid || $('#network-ssid-input').value;
  } catch (err) {
    setError($('#venue-form-error'), cleanErrorMessage(err));
  } finally {
    btn.disabled = false;
  }
});

$('#venue-id-input').addEventListener('change', () => {
  const picker = $('#venue-id-input');
  refreshWifiNetworksForVenue(picker.value);
  const label = picker.selectedOptions[0] && picker.selectedOptions[0].textContent;
  if (label) $('#venue-name-input').value = label.split(' — ')[0];
});

$('#venue-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('#venue-form-error'), null);
  try {
    const name = $('#venue-name-input').value.trim();
    if (!name) throw new Error('A property name is required.');
    if (state.editingVenueId) {
      await window.api.venues.update({
        id: state.editingVenueId,
        name,
        dpskPoolId: $('#dpsk-pool-id-input').value.trim(),
        networkSsid: $('#network-ssid-input').value.trim()
      });
    } else {
      const venueId = $('#venue-id-input').value.trim();
      if (!venueId) throw new Error('Pick a venue first — click "Load from RUCKUS One".');
      await window.api.venues.add({
        id: venueId,
        name,
        dpskPoolId: $('#dpsk-pool-id-input').value.trim(),
        networkSsid: $('#network-ssid-input').value.trim()
      });
    }
    setOk($('#settings-ok'), state.editingVenueId ? 'Property updated.' : 'Property added.');
    closeVenueForm();
    await loadSettings();
    await loadUnits();
  } catch (err) {
    setError($('#venue-form-error'), cleanErrorMessage(err));
  }
});

async function loadSettings() {
  try {
    const { activeVenueId, venues, idleTimeoutMinutes, apiConfigured, ruckus } = await window.api.settings.get();
    state.activeVenueId = activeVenueId || '';
    state.venues = venues || [];
    const activeVenue = state.venues.find((v) => v.id === state.activeVenueId);
    state.networkSsid = (activeVenue && activeVenue.networkSsid) || '';
    renderVenuesTable();
    renderCurrentVenueLabel();
    // Cross-property search is still admin-only (directory:listAllVenues is
    // requireAdmin()-gated in main.js) — a front-desk account restricted to
    // 2+ properties should still only ever switch between them one at a
    // time, never search across them all at once.
    ((state.user.role === 'admin' && state.venues.length > 1) ? show : hide)($('#directory-all-properties-label'));
    $('#idle-timeout-input').value = idleTimeoutMinutes;
    startIdleTimer(idleTimeoutMinutes);
    $('#settings-api-status').textContent = apiConfigured
      ? 'RUCKUS One API is configured.'
      : 'RUCKUS One API credentials are not configured yet — set them above.';
    $('#ruckus-tenant-id').value = ruckus.tenantId || '';
    $('#ruckus-managed-tenant-id').value = ruckus.managedTenantId || '';
    $('#ruckus-client-id').value = ruckus.clientId || '';
    $('#ruckus-oauth-url').value = ruckus.oauthBaseUrl || '';
    $('#ruckus-api-url').value = ruckus.apiBaseUrl || '';
    $('#ruckus-secret-status').textContent = ruckus.hasSecret ? '(currently set)' : '(not set)';
  } catch (err) {
    setError($('#settings-error'), cleanErrorMessage(err));
  }
  loadBrandingSettings();
  if (state.user.role === 'admin') {
    window.api.updates.getVersion().then((v) => {
      $('#update-version-text').textContent = `Version ${v}`;
    }).catch(() => {});
  }
}

let pendingLogoDataUri;

async function loadBrandingSettings() {
  try {
    const branding = await window.api.settings.getBranding();
    pendingLogoDataUri = undefined;
    $('#brand-name-input').value = branding.appName || '';
    $('#brand-primary-input').value = branding.primaryColor || '#365d6c';
    $('#brand-accent-input').value = branding.accentColor || '#fa8500';
    $('#brand-login-message-input').value = branding.loginMessage || '';
    $('#brand-logo-input').value = '';
    const preview = $('#brand-logo-preview');
    if (branding.logoDataUri) {
      preview.src = branding.logoDataUri;
      show(preview);
      show($('#brand-logo-clear-btn'));
    } else {
      hide(preview);
      preview.removeAttribute('src');
      hide($('#brand-logo-clear-btn'));
    }
  } catch (err) {
    setError($('#branding-error'), cleanErrorMessage(err));
  }
}

// The logo is only ever displayed at a few hundred px at most (sidebar icon,
// login screen), but phone/camera photos routinely come in at several MB —
// far more than the data-URI-in-sqlite size cap allows and far more than the
// UI can even show. Downscale raster images client-side before storing them
// instead of just rejecting anything over the limit; 800px covers the
// largest on-screen use (the login logo) at 2x for retina displays with
// plenty of room to spare. SVGs are already tiny text and stay vector —
// rasterizing one would only make it blurrier, so leave those alone.
function resizeImageDataUri(dataUri, maxDimension = 800) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const scale = maxDimension / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      // PNG (lossless, keeps transparency) is plenty small for what a real
      // logo actually is — flat colors, text, simple shapes. Only a
      // pathologically incompressible image (a noisy photo) could still be
      // over the cap at this point; back off to JPEG quality for that case
      // rather than PNG alone not being a hard guarantee.
      const CAP = 1_800_000; // stay safely under main.js's ~2,000,000-char cap
      let out = canvas.toDataURL('image/png');
      if (out.length <= CAP) return resolve(out);
      for (const quality of [0.85, 0.7, 0.5, 0.3]) {
        out = canvas.toDataURL('image/jpeg', quality);
        if (out.length <= CAP) return resolve(out);
      }
      resolve(out);
    };
    img.onerror = () => reject(new Error('Could not read that image file.'));
    img.src = dataUri;
  });
}

$('#brand-logo-input').addEventListener('change', () => {
  const file = $('#brand-logo-input').files[0];
  if (!file) return;
  setError($('#branding-error'), null);
  const reader = new FileReader();
  reader.onload = async () => {
    let dataUri = reader.result;
    if (file.type !== 'image/svg+xml') {
      try {
        dataUri = await resizeImageDataUri(dataUri);
      } catch (err) {
        setError($('#branding-error'), cleanErrorMessage(err));
        $('#brand-logo-input').value = '';
        return;
      }
    }
    pendingLogoDataUri = dataUri;
    const preview = $('#brand-logo-preview');
    preview.src = pendingLogoDataUri;
    show(preview);
    show($('#brand-logo-clear-btn'));
  };
  reader.readAsDataURL(file);
});

$('#brand-logo-clear-btn').addEventListener('click', () => {
  pendingLogoDataUri = '';
  $('#brand-logo-input').value = '';
  const preview = $('#brand-logo-preview');
  hide(preview);
  preview.removeAttribute('src');
  hide($('#brand-logo-clear-btn'));
});

$('#save-branding-btn').addEventListener('click', async () => {
  setError($('#branding-error'), null);
  setOk($('#branding-ok'), null);
  try {
    await window.api.settings.setBranding({
      appName: $('#brand-name-input').value.trim(),
      primaryColor: $('#brand-primary-input').value,
      accentColor: $('#brand-accent-input').value,
      loginMessage: $('#brand-login-message-input').value,
      ...(pendingLogoDataUri !== undefined ? { logoDataUri: pendingLogoDataUri } : {})
    });
    setOk($('#branding-ok'), 'Appearance saved.');
    await applyBranding();
    await loadBrandingSettings();
  } catch (err) {
    setError($('#branding-error'), cleanErrorMessage(err));
  }
});

$('#reset-branding-btn').addEventListener('click', async () => {
  if (!confirm('Reset app name, logo and colors back to the default?')) return;
  setError($('#branding-error'), null);
  setOk($('#branding-ok'), null);
  try {
    await window.api.settings.resetBranding();
    setOk($('#branding-ok'), 'Appearance reset to default.');
    await applyBranding();
    await loadBrandingSettings();
  } catch (err) {
    setError($('#branding-error'), cleanErrorMessage(err));
  }
});

// ---------- Backup & restore ----------

$('#export-config-btn').addEventListener('click', async () => {
  setError($('#backup-error'), null);
  setOk($('#backup-ok'), null);
  try {
    const config = await window.api.settings.exportConfig();
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `property-portal-config-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setOk($('#backup-ok'), 'Backup downloaded. It contains your RUCKUS client secret — store it securely.');
  } catch (err) {
    setError($('#backup-error'), cleanErrorMessage(err));
  }
});

$('#import-config-file').addEventListener('change', () => {
  const file = $('#import-config-file').files[0];
  if (!file) return;
  setError($('#backup-error'), null);
  setOk($('#backup-ok'), null);
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const config = JSON.parse(String(reader.result));
      if (!confirm('Restore settings from this backup? This overwrites your current RUCKUS connection, venue/DPSK/network selections, and appearance.')) {
        $('#import-config-file').value = '';
        return;
      }
      await window.api.settings.importConfig(config);
      setOk($('#backup-ok'), 'Settings restored from backup.');
      await loadSettings();
      await applyBranding();
      await loadUnits();
    } catch (err) {
      setError($('#backup-error'), err.message.includes('JSON') ? 'That file isn’t valid JSON.' : cleanErrorMessage(err));
    } finally {
      $('#import-config-file').value = '';
    }
  };
  reader.readAsText(file);
});

$('#save-ruckus-config-btn').addEventListener('click', async () => {
  setError($('#ruckus-config-error'), null);
  setOk($('#ruckus-config-ok'), null);
  try {
    await window.api.settings.setRuckusConfig({
      tenantId: $('#ruckus-tenant-id').value.trim(),
      managedTenantId: $('#ruckus-managed-tenant-id').value.trim(),
      clientId: $('#ruckus-client-id').value.trim(),
      clientSecret: $('#ruckus-client-secret').value,
      oauthBaseUrl: $('#ruckus-oauth-url').value.trim(),
      apiBaseUrl: $('#ruckus-api-url').value.trim()
    });
    $('#ruckus-client-secret').value = '';
    setOk($('#ruckus-config-ok'), 'Connection settings saved.');
    loadSettings();
  } catch (err) {
    setError($('#ruckus-config-error'), cleanErrorMessage(err));
  }
});

$('#save-security-btn').addEventListener('click', async () => {
  setError($('#security-error'), null);
  setOk($('#security-ok'), null);
  try {
    await window.api.settings.setIdleTimeout(Number($('#idle-timeout-input').value));
    setOk($('#security-ok'), 'Saved.');
    loadSettings();
  } catch (err) {
    setError($('#security-error'), cleanErrorMessage(err));
  }
});

$('#check-updates-btn').addEventListener('click', async () => {
  $('#update-status').textContent = 'Checking…';
  hide($('#download-update-btn'));
  try {
    const result = await window.api.updates.check();
    $('#update-version-text').textContent = `Version ${result.currentVersion}`;
    if (result.error) {
      $('#update-status').textContent = result.error;
    } else if (result.updateAvailable) {
      $('#update-status').textContent = `A new version (${result.latestVersion}) is available.`;
      show($('#download-update-btn'));
    } else {
      $('#update-status').textContent = 'You have the latest version.';
    }
  } catch (err) {
    $('#update-status').textContent = cleanErrorMessage(err);
  }
});

$('#download-update-btn').addEventListener('click', async () => {
  try {
    await window.api.updates.openUpdatePage();
  } catch (err) {
    $('#update-status').textContent = cleanErrorMessage(err);
  }
});

$('#change-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError($('#cp-error'), null);
  setOk($('#cp-ok'), null);
  try {
    await window.api.auth.changePassword({ currentPassword: $('#cp-current').value, newPassword: $('#cp-new').value });
    setOk($('#cp-ok'), 'Password updated.');
    $('#change-password-form').reset();
  } catch (err) {
    setError($('#cp-error'), cleanErrorMessage(err));
  }
});

boot();

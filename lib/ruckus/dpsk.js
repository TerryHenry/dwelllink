'use strict';

// Wraps the RUCKUS One DPSK API (docs.ruckus.cloud/api/dpsk-api-0.0.3).
// Used for "Additional Residents" — a unit's built-in owner/guest passphrases
// live directly on the Unit object instead (see propertyManagement.js's Unit
// `dpsks` array). Extra residents beyond those two slots are separate DPSK
// passphrases in the building's pool, linked to a unit as a LINKED persona
// via propertyManagement.js's associateIdentity/removeIdentity.
//
// Field names below are CONFIRMED against RUCKUS's own rendered OpenAPI
// schema (DpskPassphraseDto / DpskPassphraseCreateDto / DpskPassphraseFilters
// — pulled directly from docs.ruckus.cloud's page-data JSON, not guessed):
// id, passphrase (8-63 chars), username, vlanId, numberOfDevices (1-512),
// email, phoneNumber, status (ACTIVE|REVOKED|EXPIRED), expiration,
// expirationDate, identityGroupId, devices[].
//
// IMPORTANT: create/update/delete return 202 Accepted with only
// `{ requestId }` — RUCKUS processes these asynchronously, so the new
// passphrase's id is NOT in the response. waitForPassphrase() below polls
// the query endpoint to find it afterward.
//
// Also confirmed live: create requires EITHER `passphrase` OR
// `numberOfPassphrases` explicitly — omitting both to ask for an
// auto-generated one isn't valid on its own ("Either 'passphrase' or
// 'numberOfPassphrases' must be specified."). FURTHER confirmed live:
// sending `username` together with either of those on create reliably 500s
// (a real server-side bug, not a validation response) — reproduced with both
// `numberOfPassphrases` and an explicit `passphrase`. Workaround: create with
// ONLY `passphrase` (no username/email/phone/vlan/etc.), find the resulting
// anonymous record, then PATCH it with the rest — PATCH already works fine
// with those fields (confirmed via "Edit").
//
// The DPSK Pool ID itself has no reliable programmatic lookup in this app —
// two attempts (`/dpskServices/query` name search, and resolving it from the
// venue's Identity Group via `personaGroupId`) both failed; the Identity
// Group and the DPSK pool turned out to be distinct, unrelated-by-any-
// endpoint-we-could-find resources. Find it manually: RUCKUS One → Network →
// DPSK Services (the standalone list, not the Venue's Property Management
// tab) → open the pool → copy the id from that page's URL.

const client = require('./client');

async function getPool(poolId) {
  return client.get(`/dpskServices/${encodeURIComponent(poolId)}`);
}

const passphrasesPath = (poolId) => `/dpskServices/${encodeURIComponent(poolId)}/passphrases`;

// Defaults pageSize to 500, same reasoning/convention as
// propertyManagement.js's listUnits() — an unset pageSize lets RUCKUS apply
// its own unstated default and silently truncate the response. Not
// currently exercised (this function's one caller, waitForPassphrase,
// always passes an explicit pageSize) but hardened to match anyway so it's
// not a landmine for a future direct caller.
async function listPassphrases(poolId, { page, pageSize = 500 } = {}) {
  return client.get(passphrasesPath(poolId), { query: { page, pageSize } });
}

async function queryPassphrases(poolId, queryBody = {}) {
  return client.post(`${passphrasesPath(poolId)}/query`, queryBody);
}

async function getPassphrase(poolId, id) {
  return client.get(`${passphrasesPath(poolId)}/${encodeURIComponent(id)}`);
}

async function createPassphrase(poolId, body) {
  return client.post(passphrasesPath(poolId), body);
}

// Creates a passphrase scoped to a specific identity group from the start —
// path confirmed real (present in RUCKUS's own example-response keys, unlike
// several other paths guessed this session): POST
// /dpskServices/{poolId}/identityGroups/{groupId}/passphrases. Likely what
// RUCKUS's own admin UI uses for this, and unlike a generically-created
// passphrase, property-management may only recognize identities created this
// way as valid for that identity group's units.
async function createPassphraseForIdentityGroup(poolId, identityGroupId, body) {
  return client.post(
    `/dpskServices/${encodeURIComponent(poolId)}/identityGroups/${encodeURIComponent(identityGroupId)}/passphrases`,
    body
  );
}

async function patchPassphrase(poolId, id, patch) {
  return client.patch(`${passphrasesPath(poolId)}/${encodeURIComponent(id)}`, patch);
}

async function deletePassphrases(poolId, ids) {
  return client.del(passphrasesPath(poolId), { body: { ids } });
}

async function sendNotifications(poolId, ids) {
  return client.post(`${passphrasesPath(poolId)}/notifications`, { ids });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Passphrase creation is async (202 + requestId only) — poll the plain GET
// list and match client-side with `isMatch(passphraseRecord)`. Deliberately
// NOT using the POST .../query endpoint here: every POST "/query" endpoint
// touched in this whole API has turned out fragile/500-prone live (this one
// included, across several request-body shapes), while plain GET list/get
// endpoints have all worked reliably on the first try.
async function waitForPassphrase(poolId, isMatch, { retries = 6, delayMs = 1000, pageSize = 50 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await sleep(delayMs);
    const result = await listPassphrases(poolId, { page: 0, pageSize });
    const rows = (result && result.data) || (result && result.content) || (Array.isArray(result) ? result : []);
    const match = rows.find(isMatch);
    if (match && match.id) return match;
  }
  throw new Error(
    `Created the passphrase but couldn't find it afterward (RUCKUS processes creation asynchronously). Refresh the residents list in a moment.`
  );
}

function randomChars(alphabet, length) {
  const bytes = require('crypto').randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// "Keyboard friendly" — no ambiguous-looking characters (0/O, 1/I/l) — is
// what this app generated unconditionally before generateFormattedPassphrase
// existed; kept as the default/fallback for that reason.
function generateRandomPassphrase(length = 12) {
  return randomChars('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', length);
}

// A small built-in word list for DpskPoolDto.passphraseFormat ===
// 'DICTIONARY_WORDS' — RUCKUS's own dictionary isn't exposed via the API, so
// this can't reproduce their exact wordlist, but it matches the *shape*
// residents/front-desk will actually see (N short lowercase words joined by
// hyphens, optionally with a numeric suffix), which is what "follows the
// passphrase format" means in practice for this format.
const WORD_LIST = [
  'amber', 'anchor', 'aspen', 'banjo', 'basil', 'beacon', 'birch', 'bison',
  'blaze', 'bloom', 'breeze', 'bridge', 'bronze', 'canyon', 'cedar', 'cinder',
  'clover', 'coral', 'cove', 'crane', 'creek', 'crimson', 'crystal', 'dawn',
  'delta', 'denim', 'dune', 'ember', 'falcon', 'feather', 'fern', 'fjord',
  'flint', 'forest', 'fox', 'garnet', 'glacier', 'glow', 'granite', 'grove',
  'harbor', 'harvest', 'haven', 'hazel', 'heron', 'hollow', 'indigo', 'ivory',
  'jade', 'juniper', 'kestrel', 'lagoon', 'lantern', 'lark', 'laurel',
  'ledge', 'lily', 'lumen', 'lunar', 'maple', 'marble', 'meadow', 'mesa',
  'mist', 'moss', 'nectar', 'nova', 'oak', 'oasis', 'onyx', 'opal', 'orbit',
  'osprey', 'otter', 'pebble', 'petal', 'pine', 'plaza', 'prairie', 'quartz',
  'quill', 'raven', 'reef', 'ridge', 'river', 'robin', 'rustic', 'saffron',
  'sage', 'shore', 'sierra', 'slate', 'sparrow', 'spruce', 'summit', 'swift',
  'tidal', 'timber', 'topaz', 'tundra', 'valley', 'violet', 'willow', 'wren',
];

// Builds a passphrase matching the DPSK pool's own configured generation
// rule (DpskPoolDto.passphraseFormat/passphraseLength/wordCount/
// numericSuffixEnabled — confirmed field names via docs.ruckus.cloud's
// schemaStore) instead of always producing the same fixed-length
// keyboard-friendly string regardless of how the pool is actually set up,
// which is why a generated passphrase could come out not matching what the
// DPSK service expects. `pool` is whatever dpsk.getPool(poolId) returns;
// falls back to the original keyboard-friendly generator if the pool has no
// passphraseFormat set (or the lookup failed) so this never blocks
// generating *a* passphrase.
function generateFormattedPassphrase(pool) {
  const format = pool && pool.passphraseFormat;
  const minLength = pool && Number.isFinite(pool.passphraseLength) ? pool.passphraseLength : 12;
  const length = Math.max(8, Math.min(63, minLength || 12));

  switch (format) {
    case 'NUMBERS_ONLY':
      return randomChars('0123456789', length);
    case 'MOST_SECURED':
      return randomChars('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+', length);
    case 'DICTIONARY_WORDS': {
      const wordCount = pool && Number.isFinite(pool.wordCount) ? Math.max(3, Math.min(6, pool.wordCount)) : 4;
      const bytes = require('crypto').randomBytes(wordCount);
      const words = Array.from({ length: wordCount }, (_, i) => WORD_LIST[bytes[i] % WORD_LIST.length]);
      let out = words.join('-');
      if (pool && pool.numericSuffixEnabled) out += randomChars('0123456789', 3);
      return out;
    }
    case 'KEYBOARD_FRIENDLY':
    default:
      return generateRandomPassphrase(length);
  }
}

module.exports = {
  getPool,
  listPassphrases,
  queryPassphrases,
  getPassphrase,
  createPassphrase,
  createPassphraseForIdentityGroup,
  patchPassphrase,
  deletePassphrases,
  sendNotifications,
  generateRandomPassphrase,
  generateFormattedPassphrase,
  waitForPassphrase
};

'use strict';

// Wraps the RUCKUS One "Property Management" REST API.
// Reference: https://docs.ruckus.cloud/api/property-management-1.0.1
//
// Hierarchy: Venue -> Property Management System -> Property -> Property Units.
//
// CONFIRMED Unit schema (pulled directly from RUCKUS's rendered OpenAPI JSON
// Schema via docs.ruckus.cloud's Gatsby page-data store, not guessed):
//   id, name (required), resident (required: { name, email, phoneNumber }),
//   pmsUnitId, type (R1|PMS|INTERNAL), category (UNIT|CONFERENCEROOM),
//   status (DISABLED|ENABLED), dpsks[] (max 2: { type: UNIT|GUEST|LINKED,
//   passphrase (<=63 chars), vlan (1-4094) }), accessPoint ({ name,
//   selectedPorts[] }), trafficControl ({ meteringProfileId, profileExpiry }),
//   personaId (uuid, the built-in "UNIT" persona), guestPersonaId (uuid, the
//   built-in "GUEST" persona), identityCount (readonly).
//
// CORRECTION (confirmed against a real tenant, 2026-09): a GET on a unit does
// NOT actually return `dpsks[]` — only `personaId`/`guestPersonaId` come
// back. Those two uuids ARE DPSK passphrase ids in the configured pool: the
// unit's OWNER and GUEST Wi-Fi passphrase + VLAN must be read via
// `dpsk.getPassphrase(poolId, personaId)`, not from the unit object (see
// main.js's `units:residents`, which resolves personaId/guestPersonaId plus
// any LINKED personas from the identities/query endpoint below into full
// passphrase records in one call). Whether PATCHing a unit's `dpsks[]`
// actually writes those same passphrases is unconfirmed either way — the app
// writes them through `identities:update`/`identities:regenerate` (same path
// as "Additional Residents") instead, since that's the mechanism confirmed
// to work. The `units/{unitId}/identities/{identityId}` endpoints below
// link/unlink an *additional* ("LINKED") persona to a unit, for residents
// beyond the built-in owner+guest slots.

const client = require('./client');

const unitsPath = (venueId) => `/venues/${encodeURIComponent(venueId)}/units`;
const unitPath = (venueId, unitId) => `${unitsPath(venueId)}/${encodeURIComponent(unitId)}`;

// Raw single-page call. CONFIRMED via docs.ruckus.cloud's schemaStore
// (PageEntityModelUnit) that this returns a real Spring-Data-style page
// envelope: { content[], totalElements, totalPages, number (0-indexed),
// size, first, last, numberOfElements, empty }. Also confirmed live against
// a real tenant: RUCKUS hard-caps `size` at 20 regardless of the requested
// pageSize (tried 500 — still capped at 20) — an unset pageSize doesn't
// just fall back to some generous default, it's a real, low ceiling. Use
// listAllUnits() below for "give me every unit," not this directly.
async function listUnits(venueId, { page, pageSize } = {}) {
  return client.get(unitsPath(venueId), { query: { page, pageSize } });
}

// Loops through every page (0-indexed, per the confirmed schema) and
// returns the combined flat array. This is the actual fix for units
// silently going missing from the app once a venue passes ~20 units — a
// bigger single-page request doesn't work here since RUCKUS caps the page
// size itself, so the only correct approach is real pagination. Capped at
// 200 iterations (a generous ceiling for any real MDU property) purely as a
// runaway-loop safeguard in case the response shape is ever malformed.
async function listAllUnits(venueId) {
  const first = await listUnits(venueId, { page: 0 });
  const firstContent = Array.isArray(first) ? first : first.content || first.data || [];
  const totalPages = first && typeof first.totalPages === 'number' ? first.totalPages : 1;
  const units = [...firstContent];
  for (let page = 1; page < Math.min(totalPages, 200); page++) {
    const result = await listUnits(venueId, { page });
    const content = Array.isArray(result) ? result : result.content || result.data || [];
    if (!content.length) break;
    units.push(...content);
  }
  return units;
}

async function queryUnits(venueId, queryBody = {}) {
  return client.post(`${unitsPath(venueId)}/query`, queryBody);
}

async function getUnit(venueId, unitId) {
  return client.get(unitPath(venueId, unitId));
}

async function createUnit(venueId, unit) {
  return client.post(unitsPath(venueId), unit);
}

async function updateUnit(venueId, unitId, patch) {
  return client.patch(unitPath(venueId, unitId), patch);
}

async function deleteUnit(venueId, unitId) {
  return client.del(unitPath(venueId, unitId));
}

// Resends the unit-assignment / Wi-Fi credential notification (email/SMS) for one or more units.
// Confirmed against a real tenant: the body must be a bare JSON array of unit
// UUIDs, not an object wrapping one — the server deserializes it directly as
// List<UUID> and rejects `{ unitIds: [...] }` with a JSON parse error.
async function resendUnitNotifications(venueId, unitIds) {
  return client.post(`${unitsPath(venueId)}/notifications`, unitIds);
}

// Confirmed live: this endpoint deserializes {identityId} as a Java UUID, but
// DPSK-API-issued ids (pools, passphrases) come back as bare 32-char hex with
// no dashes (e.g. `0123456789abcdef0123456789abcdef`) — property-management-
// issued ids (personaId, guestPersonaId) are already dashed. Reformat before
// use here or the server rejects it: "Failed to convert value of type
// 'java.lang.String' to required type 'java.util.UUID'".
function toDashedUuid(id) {
  const hex = String(id).replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return id; // not a bare-hex id — leave as-is
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function associateIdentity(venueId, unitId, identityId) {
  // A bare bodyless PUT here was suspected of causing a server-side 500 when
  // called right after creating a passphrase — every other write endpoint in
  // this API family expects at least a `{}` JSON body, so send one explicitly.
  return client.put(`${unitPath(venueId, unitId)}/identities/${encodeURIComponent(toDashedUuid(identityId))}`, {});
}

async function removeIdentity(venueId, unitId, identityId) {
  return client.del(`${unitPath(venueId, unitId)}/identities/${encodeURIComponent(toDashedUuid(identityId))}`);
}

async function queryUnitIdentities(venueId, queryBody = {}) {
  return client.post(`${unitsPath(venueId)}/identities/query`, queryBody);
}

async function getPropertyConfig(venueId) {
  return client.get(`/venues/${encodeURIComponent(venueId)}/propertyConfigs`);
}

module.exports = {
  listUnits,
  listAllUnits,
  queryUnits,
  getUnit,
  createUnit,
  updateUnit,
  deleteUnit,
  resendUnitNotifications,
  associateIdentity,
  removeIdentity,
  queryUnitIdentities,
  getPropertyConfig
};

'use strict';

// Wraps RUCKUS One's "Identity Groups" API — discovered live via the
// customer's own browser DevTools against their real tenant, NOT present in
// docs.ruckus.cloud's public schema dump at all. This is a THIRD API surface,
// distinct from both the DPSK API (lib/ruckus/dpsk.js) and the Property
// Management API (lib/ruckus/propertyManagement.js).
//
// A unit's `personaId`/`guestPersonaId` (from propertyManagement.js's Unit)
// are ids of "Identity" records HERE — confirmed by cross-referencing a real
// unit against a real identity: Identity.id === Unit.personaId, and
// Identity.identityId is actually a back-reference to the unit's own id (NOT
// a separate id to use elsewhere, despite the confusing name overlap with
// propertyManagement's `identityId` path param).
//
// Confirmed fields on an Identity (GET /identityGroups/{groupId}/identities/{id}):
// id, groupId, parentId, name, email, phoneNumber, dpskGuid (the linked DPSK
// passphrase's bare-hex id — same format as DPSK-API-issued ids elsewhere),
// dpskPassphrase (the actual plaintext passphrase value), vlan, vni, revoked,
// devices[], deviceCount, clientCount, primary (true for a unit's built-in
// owner identity), createdAt/updatedAt (unix seconds w/ fractional, not ISO
// strings like every other RUCKUS timestamp seen so far).
//
// CONFIRMED (captured live from RUCKUS One's own web UI, not guessed): a
// DPSK passphrase created directly via dpsk.js's createPassphrase is a
// different resource that property-management's associate endpoint never
// recognizes ("Identity selected for association does not exist"). The real
// flow RUCKUS's own frontend uses is:
//   POST /identityGroups/{groupId}/identities?autoDpskPassphraseCreation=<bool>
//   body: { name, groupId }
//   -> 202 { requestId, id }  -- the new identity's real id, returned
//      SYNCHRONOUSLY (unlike DPSK passphrase creation, no polling needed)
// That returned `id` is what property-management's
// `units/{unitId}/identities/{identityId}` association endpoint actually
// wants (it's the same id space as personaId/guestPersonaId). Whether the
// create body accepts more than name/groupId (email, phoneNumber, vlan) is
// UNCONFIRMED — the captured example only sent those two — so create()
// deliberately only takes a name; set other fields via a follow-up PATCH
// once that endpoint is confirmed too.

const client = require('./client');

const identitiesPath = (groupId) => `/identityGroups/${encodeURIComponent(groupId)}/identities`;

async function getIdentity(groupId, identityId) {
  return client.get(`${identitiesPath(groupId)}/${encodeURIComponent(identityId)}`);
}

async function createIdentity(groupId, name, { autoDpskPassphraseCreation = true } = {}) {
  return client.post(
    identitiesPath(groupId),
    { name, groupId },
    { query: { autoDpskPassphraseCreation } }
  );
}

// UNCONFIRMED (not captured live — inferred from this API's PATCH-for-partial-
// update convention used everywhere else). Field names for patch guessed from
// the GET response shape: `revoked` (confirmed name), `dpskPassphrase` (best
// guess for setting a new passphrase, matching the GET field name), `email`,
// `phoneNumber`, `vlan`.
async function patchIdentity(groupId, identityId, patch) {
  return client.patch(`${identitiesPath(groupId)}/${encodeURIComponent(identityId)}`, patch);
}

// UNCONFIRMED — same caveat as patchIdentity.
async function deleteIdentity(groupId, identityId) {
  return client.del(`${identitiesPath(groupId)}/${encodeURIComponent(identityId)}`);
}

// CONFIRMED live (captured from RUCKUS One's own web UI): live connected
// clients aren't on the Identity's own `devices[]` field (that's registered/
// authorized devices, not current connections) — they're a separate query,
// scoped by a list of identity ids: POST /identities/clients/query, body
// { identityIds: [...], page (1-indexed), pageSize, sortField, sortOrder }.
// Each result: { id, groupId, identityId, clientMac, networkId, apMac, ssid,
// username, onboardType, alias }.
async function queryClients(identityIds, { page = 1, pageSize = 100 } = {}) {
  return client.post('/identities/clients/query', {
    identityIds,
    page,
    pageSize,
    sortField: 'username',
    sortOrder: 'ASC'
  });
}

// CONFIRMED live against the real tenant (2026-09-25): this is a DIFFERENT
// API surface again — the "viewmodel" spec (docs.ruckus.cloud/api/viewmodel-
// 1.0.45), which is what RUCKUS One's own UI uses to power its rich
// per-client "Devices" detail view. `/identities/clients/query` above only
// returns a handful of fields (clientMac, apMac, ssid, username); this
// endpoint returns hostname, osType, deviceType/modelName, ipAddress/
// ipv6Address, apInformation (name/mac/serial/bssid), networkInformation
// (ssid/vlan/encryption), signalStatus (health/rssi/snr), radioStatus,
// trafficStatus, connectedTime/lastUpdatedTime, and the same identityId/
// identityGroupId fields — filtered by identityId, one row per currently-
// connected client for that identity. Filter key confirmed via a live test
// call (`filters: {identityId: [id]}` -> 200 with the full record).
async function queryApClients(identityIds, { page = 1, pageSize = 100 } = {}) {
  return client.post('/venues/aps/clients/query', {
    filters: { identityId: identityIds },
    page,
    pageSize
  });
}

module.exports = { getIdentity, createIdentity, patchIdentity, deleteIdentity, queryClients, queryApClients };

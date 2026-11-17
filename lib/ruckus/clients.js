'use strict';

// CONFIRMED (docs.ruckus.cloud "wifi" spec, "Patch AP Client" —
// PATCH /venues/{venueId}/aps/{serialNumber}/clients/{clientMacAddress}):
// disconnects a currently-connected client from the AP it's on right now.
// The request schema's only real enum value is `DISCONNECTED` (paired with
// `null`) — this is a one-shot kick, not a persistent block. RUCKUS doesn't
// expose a device-level blocklist via any documented API; "blocking" a
// resident for real means revoking their whole identity/passphrase
// (see identityGroups.patchIdentity's `revoked` field, already used by
// identities:setRevoked) rather than banning one MAC address.
const client = require('./client');

async function disconnectApClient(venueId, serialNumber, clientMac) {
  return client.patch(
    `/venues/${encodeURIComponent(venueId)}/aps/${encodeURIComponent(serialNumber)}/clients/${encodeURIComponent(clientMac)}`,
    { status: 'DISCONNECTED' }
  );
}

module.exports = { disconnectApClient };

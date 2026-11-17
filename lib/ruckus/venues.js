'use strict';

// Best-effort venue lookup. If your tenant/API version doesn't expose GET /venues
// the way this expects, just set RUCKUS_VENUE_ID (or the in-app Settings field)
// directly with the venue ID from the RUCKUS One UI and skip venue listing.

const client = require('./client');

async function listVenues() {
  return client.get('/venues');
}

async function getVenue(venueId) {
  return client.get(`/venues/${encodeURIComponent(venueId)}`);
}

module.exports = { listVenues, getVenue };

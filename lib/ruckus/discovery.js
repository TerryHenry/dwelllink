'use strict';

// Lookups used to populate Settings dropdowns (Venue / DPSK Pool / Wi-Fi
// network) instead of requiring the property manager to copy IDs out of
// RUCKUS One's own UI by hand. A fourth RUCKUS API surface again — the
// "viewmodel" spec for venues/networks, confirmed live 2026-09-25.
const client = require('./client');

// CONFIRMED live: POST /venues/query, DynamicQueryPayloadDto body, response
// { data: [...] } with id/name/city/addressLine per venue.
async function listVenues() {
  const result = await client.post('/venues/query', {
    page: 0,
    pageSize: 200,
    sortField: 'name',
    sortOrder: 'ASC'
  });
  return (result && result.data) || [];
}

// GET /dpskServices (which we used for a long time because it included
// `identityGroupId` per pool) is marked deprecated in RUCKUS's API docs
// ("will be removed no sooner than 08/31/2026"; the replacement is the
// /query call below) and has started returning 405 — that's what broke
// Settings > Add property > "Load from RUCKUS One". The /query v1.2
// response doesn't carry identityGroupId or SSIDs, so the "recommended
// pool" hint now comes from the venue's Identity Group instead (see
// getRecommendedDpskPoolId).
//
// Earlier live testing found POST /dpskServices/query 500s whenever
// `page`/`pageSize` are in the body (a bare {} worked), so first page is
// requested with a bare body; extra pages, if the response says there are
// any, are fetched best-effort and never fail the whole lookup.
async function listDpskPools() {
  const first = await client.post('/dpskServices/query', {});
  const pools = [...((first && first.data) || [])];
  const totalPages = (first && first.totalPages) || 1;
  for (let page = 1; page < Math.min(totalPages, 50); page++) {
    try {
      const next = await client.post('/dpskServices/query', { page });
      pools.push(...((next && next.data) || []));
    } catch {
      break;
    }
  }
  return pools;
}

// An Identity Group records the DPSK pool it's associated with
// (`dpskPoolId`, per the persona spec) — that's the link used to flag the
// right pool as "recommended" for a venue.
async function getRecommendedDpskPoolId(identityGroupId) {
  if (!identityGroupId) return null;
  const group = await client.get(`/identityGroups/${encodeURIComponent(identityGroupId)}`);
  return (group && group.dpskPoolId) || null;
}

// CONFIRMED live: filters.venueId at the top level of the query returns 0
// rows even for a venue with real active networks — a network's venue
// scoping lives in `venueApGroups[].venueId`, not a flat filterable field.
// Fetch the tenant-wide list (small in practice) and filter client-side.
async function listWifiNetworks() {
  const result = await client.post('/wifiNetworks/query', {
    page: 0,
    pageSize: 500,
    sortField: 'name',
    sortOrder: 'ASC'
  });
  return (result && result.data) || [];
}

module.exports = { listVenues, listDpskPools, getRecommendedDpskPoolId, listWifiNetworks };

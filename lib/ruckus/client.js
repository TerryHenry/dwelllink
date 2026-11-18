'use strict';

const settingsStore = require('../settingsStore');

// RUCKUS One auth: POST {oauthBaseUrl}/oauth2/token/{tenantId}
// body: grant_type=client_credentials&client_id=...&client_secret=...
// See: https://docs.ruckus.cloud/api/docs/api-authentication-and-jwt
let cachedToken = null; // { accessToken, expiresAt, forConfigKey }

class RuckusApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'RuckusApiError';
    this.status = status;
    this.body = body;
  }
}

// RUCKUS error bodies aren't consistent across API surfaces. Property
// Management validation errors use a flat string `message`. The DPSK API's
// `ApiError` shape (confirmed via schema) has no top-level `message` at all —
// only `error: { code, message, reason, suggestion }` (an object) and/or
// `errors: [{ code, message, reason, suggestion }, ...]`. Blindly using
// `json.message || json.error` turns that object into the literal string
// "[object Object]" once it hits `new Error(...)`, which silently
// stringifies non-string arguments — so always resolve to a real string here.
function extractErrorMessage(json, status) {
  if (!json) return `RUCKUS One API request failed (${status})`;
  if (typeof json.message === 'string' && json.message) return json.message;
  const subErrors = [
    ...(json.error ? [json.error] : []),
    ...(Array.isArray(json.errors) ? json.errors : [])
  ];
  const parts = subErrors
    .map((e) => (typeof e === 'string' ? e : e && (e.message || e.reason)))
    .filter(Boolean);
  if (parts.length) return parts.join('; ');
  if (typeof json.debugMessage === 'string' && json.debugMessage) return json.debugMessage;
  return `RUCKUS One API request failed (${status})`;
}

function configKey(c) {
  return `${c.tenantId}::${c.clientId}::${c.oauthBaseUrl}::${c.apiBaseUrl}`;
}

function assertConfigured(c) {
  if (!c.tenantId || !c.clientId || !c.clientSecret) {
    throw new RuckusApiError(
      'RUCKUS One API credentials are not configured yet. Set them from Settings.',
      400
    );
  }
}

async function fetchNewToken(c) {
  const url = `${c.oauthBaseUrl.replace(/\/$/, '')}/oauth2/token/${c.tenantId}`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: c.clientId,
    client_secret: c.clientSecret
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new RuckusApiError(`RUCKUS One token request failed (${res.status})`, res.status, json);
  }
  if (!json.access_token) {
    throw new RuckusApiError('RUCKUS One token response did not include access_token — check the Tenant ID, Client ID and Client Secret (no extra characters such as a trailing "/").', res.status, json);
  }

  const expiresInMs = (json.expires_in ? Number(json.expires_in) : 3600) * 1000;
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + Math.max(expiresInMs - 30000, 10000)
  };
}

async function getToken(forceRefresh = false) {
  const c = settingsStore.getRuckusConfig();
  assertConfigured(c);
  const key = configKey(c);

  if (!forceRefresh && cachedToken && cachedToken.forConfigKey === key && cachedToken.expiresAt > Date.now()) {
    return { token: cachedToken.accessToken, config: c };
  }
  const fresh = await fetchNewToken(c);
  cachedToken = { ...fresh, forConfigKey: key };
  return { token: cachedToken.accessToken, config: c };
}

/**
 * Low-level authenticated request against the RUCKUS One REST API.
 * Retries once with a fresh token on a 401.
 */
async function request(method, path, { body, query, retry = true } = {}) {
  const { token, config: c } = await getToken();
  const base = c.apiBaseUrl.replace(/\/$/, '');

  const url = new URL(base + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (res.status === 401 && retry) {
    await getToken(true);
    return request(method, path, { body, query, retry: false });
  }

  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }

  if (!res.ok) {
    let message = extractErrorMessage(json, res.status);
    if (res.status === 401 || res.status === 403) {
      message += ' (Check that the Tenant ID, Client ID and Client Secret all come from the same RUCKUS One account, and that the token\'s scope allows this action.)';
    }
    throw new RuckusApiError(message, res.status, json);
  }

  return json;
}

module.exports = {
  RuckusApiError,
  request,
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts)
};

# DwellLink — Development notes

Setup, build, and API notes for working on the source in this repository. For
what the app does and how to install it, see the [README](README.md); for
day-to-day use, see the [User Guide](USER_GUIDE.md).

**Resident Connectivity Management, powered by RUCKUS One.**

A standalone desktop app (Electron) for front desk staff and property
managers to create and manage property units in **RUCKUS One**, using its
Property Management (MDU), DPSK, and Identity Groups APIs.

For day-to-day usage (adding units, managing residents, Wi-Fi, backups,
etc.), see the [User Guide](USER_GUIDE.md). This README covers setup,
building, and the technical details of how it talks to RUCKUS One.

## What it does

- Staff sign in with their own username/password (roles: `frontdesk`, `admin`).
- Lists, creates, edits (name + resident name/email/mobile phone),
  suspends/reactivates, and deletes property units for a configured venue
  (`admin` role required to delete).
- Per unit, manages the built-in **Unit & Guest Wi-Fi** passphrase + VLAN
  slots directly, plus any number of **Additional Residents** — each with
  their own identity, email, mobile phone, VLAN. For all of these: edit,
  generate a new passphrase, generate a scannable Wi-Fi QR code, remove.
- Resends the unit's built-in owner/guest Wi-Fi credential notification
  (email/SMS) via RUCKUS One.
- Best-effort view of connected devices for a unit.
- Manages multiple RUCKUS venues ("properties") from one install, with a
  sidebar quick-switcher for admins managing 2+ of them. Front desk accounts
  can be restricted to specific properties (a shared-workstation scenario) —
  properties outside their assignment don't appear anywhere in the app for
  them, and they get their own scoped quick-switcher once assigned 2+.
- A cross-property resident directory (search/filter/CSV export), with a
  proactive sidebar badge for residents whose access is expiring soon.
- Printable (or PDF) one-page Wi-Fi move-in sheet per resident — logo, unit,
  resident name, QR code, and the network name/password. Bulk-select units
  from the Units tab to print/export several at once — one print job, one
  combined multi-page PDF, or separate PDFs per unit.
- One-step move-out/turnover (single unit or bulk) — revokes owner/guest
  Wi-Fi, removes every Additional Resident, and clears the resident of
  record (setting it to the literal string `Vacant`, which doubles as the
  vacant-unit detection signal elsewhere in the app — see Architecture).
- A "Vacant" stat + filter chip on the Units tab, derived from that same
  signal — no extra API calls.
- Global quick search (sidebar button or Cmd/Ctrl+K) across units and
  residents, reusing the Directory tab's already-loaded data.
- A one-time "what's new" notice after an upgrade, pulling that version's
  release notes from the GitHub releases feed.
- `admin` users manage staff accounts and the RUCKUS One connection settings.

Everything (staff accounts, RUCKUS API credentials, venue/pool selection) is
stored locally in a small SQLite database in the app's own data directory —
no `.env` file, no server to run separately.

## RUCKUS One prerequisites

Before this portal is useful, in RUCKUS One you need:

1. A **Venue** for the building.
2. An **Identity Group** on that venue configured with a **DPSK service**
   (this is the "DPSK pool" the portal's Settings screen asks for — a
   related but *distinct* resource from the Identity Group itself; see below).
3. **Property Management enabled** on the venue (Venue settings → Property
   Management tab), pointing at that Identity Group.
4. An **API application token** (client ID + secret) under
   *Administration → Account Management → Settings*, and your **tenant ID**.

## Running it

```bash
npm install
npm start
```

On first launch, since no staff accounts exist yet, you'll be prompted to
create the first admin account right in the app. Sign in, then go to
**Settings** to enter your RUCKUS One tenant ID / client ID / client secret,
the venue ID for this building, the DPSK Pool ID, and the Wi-Fi network name
(SSID, needed only to build the QR code).

**Finding the DPSK Pool ID:** there's no reliable way to look this up via the
API (see below) — find it by hand in RUCKUS One: **Network → DPSK Services**
(the standalone list, *not* the Venue's Property Management tab) → open the
pool tied to this venue → copy the id from that page's URL (a 32-character
hex string with no dashes, same format RUCKUS uses for venue ids).

## Building an installable app

The app icon lives at `build/icon.icns` (macOS) / `build/icon.ico` (Windows),
referenced via `mac.icon`/`win.icon` in `package.json`'s `build` config — a
house-shaped "DL" mark (cropped from `renderer/assets/dwelllink-logo.png`,
recolored solid white for legibility at small sizes) on a rounded-square
background using this app's own `--primary`/`--primary-dark` brand colors.
Regenerate it from that same source logo if the brand mark ever changes;
there's no separate design file to keep in sync.

```bash
npm run dist
```

Produces an arm64 (Apple Silicon) `.dmg`/`.zip` in `dist/` (macOS only —
this is `electron-builder`'s default when run on a Mac with no explicit
platform flag; see the `build` section of `package.json`). Intel Mac
support was dropped as of the release published right after this note was
written — `mac.target` used to build both `arm64` and `x64`; add `x64`
back to the `arch` arrays there if Intel support is ever needed again.

**Windows**, from the same Mac, no Windows machine needed:

```bash
npx electron-builder --win
```

Produces `dist/DwellLink Setup <version>.exe` (an NSIS installer, x64).
`electron-builder` fetches everything it needs automatically the first
time — a Windows Electron build, a prebuilt Windows `better-sqlite3`
binary (no cross-compiling a native module required), and a bundled Wine
build it uses internally for Windows resource editing — none of it needs
installing by hand. Add a `linux` target to `package.json`'s `build`
section if that's ever needed too.

**Code signing:** this project has no Apple Developer ID certificate
configured, so the app is **ad-hoc signed** rather than signed with a real
identity — functionally fine for internal/single-organization use, but
macOS Gatekeeper will still warn on first open (see the User Guide's
[Opening the app for the first time](USER_GUIDE.md#opening-the-app-for-the-first-time)).
Ad-hoc signing happens automatically as part of `npm run dist`, via
`scripts/afterSign.js` (wired in through `build.afterSign` in
`package.json`) — electron-builder calls it right after assembling each
`.app` and *before* packaging it into a `.dmg`/`.zip`, so the signed `.app`
is what actually ends up inside every installer, no manual re-signing or
rebuilding-the-dmg-from-the-signed-app step needed. This ordering matters
for more than convenience: it's also what makes the update feed's SHA512
hashes correct (see "Update checks" below) — signing *after* packaging
would leave `latest-mac.yml` describing a different (unsigned) file than
the one anyone actually downloads.

**Windows code signing:** same story as macOS — no code-signing
certificate configured, so the installer is unsigned and Windows
SmartScreen will show "Windows protected your PC" the first time someone
runs it. Click **More info → Run anyway** to proceed; this is expected for
an internal, unsigned tool. Getting a real certificate would remove this
warning.

If this is ever distributed outside the organization or needs to avoid
the Gatekeeper prompt entirely, get an Apple Developer ID Application
certificate and add `mac.identity`/notarization config to
`package.json`'s `build` section — out of scope for this internal tool
today.

**Update checks:** Settings → Software Updates (admin) lets an admin check
whether a newer version exists, via `electron-updater`. `package.json`'s
`build.publish` points at this same repository's GitHub Releases
([TerryHenry/dwelllink](https://github.com/TerryHenry/dwelllink)), where
`electron-updater` looks for `latest-mac.yml`/`latest.yml`. Publish a release with:

```bash
GH_TOKEN=$(gh auth token) npx electron-builder --publish always        # macOS
GH_TOKEN=$(gh auth token) npx electron-builder --win --publish always  # Windows
```

Each command builds, signs (macOS, via the `afterSign` hook above), and
uploads the installers plus `latest-mac.yml`/`latest.yml` to a GitHub
Release tagged with the current `version` — creating one release per
platform run since they share the same version tag. **electron-builder
publishes releases as drafts by default** — a draft's assets aren't served
from the `.../releases/latest/download/...` URLs `electron-updater` queries,
so the release needs one more step to actually go live:

```bash
gh release edit vX.Y.Z --repo TerryHenry/dwelllink --draft=false
```

Bump `version` in `package.json` before publishing a new release — the app
compares its own `app.getVersion()` against whatever version tag is
currently live on GitHub, so re-publishing the *same* version just
overwrites the existing release rather than prompting anyone to update.

This deliberately only **checks and reports** a newer version exists (with a
button that opens the GitHub Releases page to download from) rather than
silently downloading and self-installing it — Squirrel.Mac's install step
verifies the old and new builds were signed with a consistent identity,
which this app's current unsigned/ad-hoc-signed build can't satisfy, so a
real auto-install would likely just fail. Getting a real Apple Developer ID
certificate (see above) would unlock true one-click auto-install if that's
ever worth the $99/year.

**Source and releases:** this repository holds both the source and the
published releases. Installers are published as GitHub Releases (never
committed to the repo), and the update check only reads the latest release's
`latest-mac.yml`/`latest.yml`, so pushing source never affects the update
feed. The source is published for transparency and review; it is not
licensed for reuse (see [LICENSE](LICENSE)). An Electron app's JS ships
readably inside `app.asar` in every installer anyway
(`npx asar extract app.asar out/`).

## The RUCKUS One API surfaces this app talks to

RUCKUS One's model here is genuinely confusing, and getting it right took a
lot of live trial-and-error against a real tenant (including, eventually,
capturing RUCKUS One's own web UI's network traffic — invaluable once the
published API docs ran out of answers). Three **separate** API surfaces are
involved, and the objects they return **look similar but are not
interchangeable**:

1. **Property Management API** (`lib/ruckus/propertyManagement.js`,
   `docs.ruckus.cloud/api/property-management-1.0.1`) — owns **Units**. A
   Unit has `id`, `name`, `resident: { name, email, phoneNumber }`, `status`
   (`ENABLED`|`DISABLED`), and two uuids: `personaId` (the built-in "owner"
   slot) and `guestPersonaId` (the built-in "guest" slot, if configured).
   **Those two uuids are NOT DPSK passphrase ids** — see #3. Also owns the
   `units/{unitId}/identities/{identityId}` endpoints that link an
   "Additional Resident" to a unit (`PUT` with an empty `{}` body — its
   response is a lightweight `{unitId, personaType, personaId}` link record,
   not the resident's actual data) and `units/identities/query` to list a
   unit's linked residents (confirmed live: `filters.unitId` must be a
   **bare string**, not an array — sending an array silently matches
   nothing, no error).
2. **DPSK API** (`lib/ruckus/dpsk.js`, `docs.ruckus.cloud/api/dpsk-api-0.0.3`)
   — owns DPSK **Pools** and raw **Passphrases** within a pool. This looked
   at first like the right place to create "Additional Residents," and it's
   *possible* to create a passphrase here directly — but property-management
   never recognizes a passphrase created this way for unit association
   ("Identity selected for association does not exist"), no matter how it's
   created. This API is effectively unused by the app now except for
   `generateRandomPassphrase()`, a local helper with no network call.
3. **Identity Groups API** (`lib/ruckus/identityGroups.js`,
   `/identityGroups/{groupId}/...`) — **not published on docs.ruckus.cloud at
   all**; discovered by capturing RUCKUS One's own web UI's network traffic.
   This is what actually backs both a unit's built-in owner/guest slots *and*
   "Additional Residents." An **Identity** here (`GET
   /identityGroups/{groupId}/identities/{id}`) has `id`, `groupId`,
   `parentId`, `name`, `email`, `phoneNumber`, `vlan`, `revoked`, `dpskGuid`
   (the underlying DPSK passphrase's id) and — critically — `dpskPassphrase`,
   **the actual plaintext passphrase value**. Confirmed by cross-referencing
   a real Identity against its owning Unit: **`Identity.id` ===
   `Unit.personaId`**. Creating one (`POST
   /identityGroups/{groupId}/identities?autoDpskPassphraseCreation=<bool>`,
   body `{name, groupId}`) returns its new `id` **synchronously** — unlike
   DPSK passphrase creation, no polling needed. That `id` is exactly what
   `units/{unitId}/identities/{identityId}` (from #1) expects, and the same
   endpoint resolves both the built-in owner/guest slots (via
   `personaId`/`guestPersonaId`) and Additional Residents (via
   `units/identities/query`'s results) — `identityGroups.getIdentity()` is
   the single source of truth for all of it in `units:builtinIdentities` and
   `units:residents` (main.js).

**Unconfirmed, best-effort pieces** (inferred from this API's own PATCH
convention rather than captured live — `lib/ruckus/identityGroups.js`'s
`patchIdentity`/`deleteIdentity`): setting `vlan`/`email`/`phoneNumber` via
PATCH, and regenerating a passphrase via PATCHing `dpskPassphrase`. The
`revoked` field name *is* confirmed (seen on a real GET response). If any of
these don't behave as expected against your tenant, that's why — the
Add/Edit forms keep a "raw JSON" field (hidden by default, but present) for
fields that need tenant-specific adjustment.

**Other confirmed-live quirks**, each cost real debugging time and are
called out inline in code comments where they matter:
- Creating a unit requires the `resident` object (required by schema) —
  easy to miss, and PATCHing a unit must strip every field except what's
  actually changing (RUCKUS rejects even *re-sending* an unchanged
  `category`, for example, as an attempted change).
- `POST /venues/{venueId}/units/notifications` (resend Wi-Fi credentials)
  wants a **bare JSON array** of unit ids, not `{unitIds: [...]}`.
- DPSK-issued ids come back as 32-char hex **with no dashes**; endpoints
  that deserialize an id as a Java `UUID` (like the unit-association PUT)
  need it reformatted to `8-4-4-4-12` first (`toDashedUuid()` in
  `propertyManagement.js`).
- Pagination conventions are **inconsistent across these three APIs** —
  some are 0-indexed with optional paging, `units/identities/query`
  specifically is 1-indexed with `page`/`pageSize`/`sortOrder` all required
  despite the schema not marking them so.
- `GET /venues/{venueId}/units` **hard-caps its page size at 20 regardless
  of the requested `pageSize`** — confirmed live (asking for 500 still came
  back capped at 20), unlike every other list endpoint in this app, which
  all honor a larger requested page size. There's no way around it but real
  pagination: `pm.listAllUnits()` loops pages 0..`totalPages-1` (confirmed
  0-indexed via the real `PageEntityModelUnit` response schema) and
  concatenates `content[]` from each. Use `listAllUnits()`, not `listUnits()`
  directly, anywhere the full unit list is needed — `listUnits()` is kept
  around only as the raw single-page primitive.

## Architecture

- `main.js` — Electron main process: creates the window and wires up all
  `ipcMain` handlers (auth, staff accounts, settings, units, residents).
- `preload.js` — exposes a minimal `window.api` surface to the renderer via
  `contextBridge` (context isolation on, no Node integration in the renderer).
- `lib/` — business logic used by the main process:
  - `lib/db.js` — local SQLite (`better-sqlite3`, compiled against Electron's
    ABI via `@electron/rebuild` — see `scripts/fix-electron-gatekeeper.js`
    and the `postinstall` script) storing staff accounts, settings, and an
    activity log in the OS user-data dir.
  - `lib/auth.js` — staff account / login logic.
  - `lib/settingsStore.js` — venue ID, DPSK pool ID, network SSID, and
    RUCKUS API credentials.
  - Front-desk-to-venue access control (`user_venues` table, `lib/auth.js`'s
    `getUserVenueIds`/`setUserVenues`/`updateUserVenues`) is enforced in
    exactly one place: `main.js`'s `venueIdOrThrow()`, the same choke point
    every unit/resident/Wi-Fi handler already calls to get the active venue.
    A front-desk session whose active venue isn't in its assigned set throws
    there — no other handler needs its own permission check. `settings:get`
    additionally *filters* the venue list itself for front desk (not just
    the switcher UI), since the requirement is that a restricted account
    shouldn't learn other properties exist, not just be blocked from using
    them. Admins are never restricted (no `user_venues` rows for them —
    `getUserVenueIds`/`venueIds` returning `null` from `listUsers()` means
    "unrestricted," distinct from a front-desk account with zero rows, which
    means "no access yet").
  - `lib/ruckus/` — the RUCKUS One HTTP client (OAuth2 client-credentials
    token caching) plus the three API surfaces described above
    (`propertyManagement.js`, `dpsk.js`, `identityGroups.js`) and a `clients.js`
    for the connected-devices query. No RUCKUS data is cached locally; the
    app always reads live from RUCKUS One.
- `renderer/` — plain HTML/CSS/JS front end (no build step, no framework).
  `renderer/js/qrcode.js` is a vendored copy of Kazuhiko Arase's public-domain
  `qrcode-generator` library, used to render the Wi-Fi QR code entirely
  client-side (no network access needed for that feature).

**Wi-Fi move-in sheet (print/PDF):** `#print-wifi-sheet` in
`renderer/index.html` **must stay a direct child of `<body>`**, not nested
inside `#app-view` or any other wrapper. The isolation CSS in
`renderer/css/style.css` is `@media print { body > *:not(#print-wifi-sheet)
{ display: none !important; } }` — it only ever hides *direct children of
body*, so nesting the sheet inside another body-level container hides that
container (and the sheet along with it), producing a blank page/PDF despite
the sheet's own `display` being correct. "Save as PDF" (`print:wifiSheetPdf`
in `main.js`) uses Electron's real `webContents.printToPDF()`, which applies
this same `@media print` CSS — there's no separate template to keep in
sync with the printed version. `#print-wifi-sheet` itself is an empty
container that `populatePrintSheet(sheets)` (renderer/js/app.js) fills with
one `.print-sheet-page` per sheet right before printing/exporting — one page
for the QR modal's single-resident flow, one per unit for a bulk
print/PDF from the Units tab's multi-select. `.print-sheet-page +
.print-sheet-page { break-before: page }` in the CSS is what gives each unit
its own printed page; a bulk PDF export is one `printToPDF()` call against
however many pages are currently populated, and "save as separate PDFs"
just re-populates the container with a single page and calls
`printToPDF()` again per unit rather than needing a different code path.

**Vacant-unit detection:** there's no dedicated "vacant" field from RUCKUS.
`units:moveOut` (single-unit and bulk) already clears the resident of
record to the literal string `'Vacant'` as its last step; `renderer/js/app.js`'s
`unitIsVacant()` just checks `resident.name === 'Vacant'` and reuses it for
the Units tab's stat card, filter chip, and row badge. This is deliberately
cheap — `resident.name` is already loaded with every unit via `units:list`,
so there's no extra per-unit identity lookup just to tell occupied from
empty. A unit manually renamed to literally "Vacant" by a human would also
read as vacant; accepted as a non-issue (nobody names a resident "Vacant"
on purpose) rather than adding a second signal.

**Global search (Cmd/Ctrl+K):** reuses `state.directory` — the same data
already loaded for the Directory tab, which covers every unit (as an
"owner" row) and every Additional Resident — instead of building a second
index. It's scoped the same way the Directory tab already is: whichever
property is active, or every property the signed-in account can see if
"Search all properties" is on.

**"What's new" notice:** `app:checkWhatsNew` in `main.js` compares
`app.getVersion()` against a new `lastSeenAppVersion` key in the local
settings table (`lib/settingsStore.js`). It's purely a local comparison —
no network call unless a genuine version change is detected, at which point
it best-effort fetches that version's release notes from
`https://api.github.com/repos/{owner}/{repo}/releases/tags/v{version}` (owner/repo
parsed from the same packaged `app-update.yml` `app:openUpdatePage` already
reads — see "Update checks" above). A failed fetch still shows the notice
(with a generic fallback message) rather than silently doing nothing, but
never blocks sign-in. Only shown in a packaged build (`app.isPackaged`),
and never on a brand-new install (first launch sets the baseline instead of
showing anything) or on the first release that ships this feature, since
`lastSeenAppVersion` doesn't exist yet on any pre-existing install either —
it'll start showing from the release *after* that one.

## Security notes

- Only one signed-in user at a time per running app instance — this matches
  a single front-desk workstation. For multiple simultaneous staff, run one
  installed copy per workstation (each keeps its own local staff-account
  database) or ask if you'd like a shared-server variant instead.
- The RUCKUS client secret is stored in the local SQLite database on disk,
  unencrypted, like the rest of the portal's local settings. Treat the
  workstation this runs on as trusted, the same way you'd treat any admin
  console.

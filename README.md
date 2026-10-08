# DwellLink

**Resident Connectivity Management, powered by RUCKUS One.**

A desktop app for front desk staff and property managers to create and
manage property units, residents, and Wi-Fi access in **RUCKUS One** —
without touching the RUCKUS One admin console directly.

<img width="1179" height="762" alt="image" src="https://github.com/user-attachments/assets/e47e7207-85a0-4bda-83df-2ce533880dc5" />


> **Disclaimer:** DwellLink is **not a RUCKUS product** and is **not
> supported by RUCKUS**. It is provided with **no guarantee or warranty of
> any kind, express or implied**. See [License](#license) below.

This repository hosts the **built app and documentation only** — it's how
DwellLink is distributed and how the app checks for updates. The source
code isn't published here.

## Features

**Units and residents**
- Add residential units and conference rooms, with optional VLAN,
  description, passphrase and guest Wi-Fi set up front.
- Bulk import from CSV (with a downloadable template) and export to CSV.
- Sortable unit list with active, suspended, conference-room and vacant
  counts, plus search and filters.
- Bulk actions: resend access details, suspend, reactivate, move out, delete.
- One-step move-out / turnover: revokes owner and guest Wi-Fi, removes
  additional residents, and marks the unit Vacant.

**Wi-Fi access**
- Owner, guest and additional-resident passphrases, each with its own VLAN
  and optional expiry date.
- Printable or PDF move-in sheets with a Wi-Fi QR code, for a single
  resident or a whole batch (one print job, one PDF, or separate PDFs).
- Connected-device view, with the option to disconnect a device or revoke
  an identity.
- Resident portal link for each unit.

**Visibility**
- Resident Directory across properties, with search, filters, CSV export and
  an "expiring soon" badge.
- Quick search (Cmd/Ctrl+K) to jump to any unit or resident.
- Audit log of every action, with CSV export.
- "What's new" notice after an upgrade.

**Built for shared front desks**
- Multiple properties from one install, with a quick property switcher.
- Admin and front-desk roles; front-desk accounts can be limited to
  specific properties.
- Auto sign-out after inactivity, encrypted API credentials, and
  backup / restore of settings.
- Custom app name, logo and colors; light and dark mode.
- Update checks against this repository's releases.

## Download

Grab the latest installer from the [Releases page](../../releases/latest):

- **macOS (Apple Silicon — M1, M2, M3, M4)** — `DwellLink-*-arm64.dmg`
- **Windows** — `DwellLink Setup *.exe`

Intel Macs aren't supported as of this release.

The app isn't code-signed (no Apple Developer ID / Windows certificate), so
your OS will show a first-run warning — this is expected for an
internally-distributed tool:

- **macOS**: right-click (or Control-click) the app and choose **Open**,
  then **Open** again in the dialog. On newer macOS versions, if you
  instead see *"Apple could not verify 'DwellLink' is free of malware..."*,
  go to **System Settings → Privacy & Security**, find the **Open Anyway**
  button next to the DwellLink warning near the bottom, click it, then try
  opening the app again. You only need to do this once.
- **Windows**: click **More info → Run anyway** on the SmartScreen prompt.

## Documentation

- [User Guide](USER_GUIDE.md) — day-to-day usage for front desk and
  property manager staff (also available as a [PDF](DwellLink-User-Guide.pdf)).

## Updates

DwellLink checks this repository's releases for newer versions from
**Settings → Software Updates** (admin only). It never installs updates
automatically — it tells you a newer version is available and links back
here to download it.

## License

© 2026 Terry Henry. All rights reserved — see [LICENSE](LICENSE).

DwellLink is an independent tool built against the RUCKUS One API. It is
**not a RUCKUS product** and is **not supported by RUCKUS**; RUCKUS and
RUCKUS One are trademarks of their respective owner(s), and this project
isn't published, endorsed, or affiliated with RUCKUS Networks, Belden,
or their affiliates. It is provided **"as is," with no guarantee or
warranty of any kind, express or implied** — see the LICENSE file for the
full warranty disclaimer.

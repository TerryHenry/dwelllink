# DwellLink

**Resident Connectivity Management, powered by RUCKUS One.**

A desktop app for front desk staff and property managers to create and
manage property units, residents, and Wi-Fi access in **RUCKUS One** —
without touching the RUCKUS One admin console directly.

> **Disclaimer:** DwellLink is **not a RUCKUS product** and is **not
> supported by RUCKUS**. It is provided with **no guarantee or warranty of
> any kind, express or implied**. See [License](#license) below.

This repository hosts the **built app and documentation only** — it's how
DwellLink is distributed and how the app checks for updates. The source
code isn't published here.

## Download

Grab the latest installer from the [Releases page](../../releases/latest):

- **macOS (Apple Silicon / M1, M2, M3, M4)** — `DwellLink-*-arm64.dmg`
- **macOS (Intel)** — `DwellLink-*.dmg` (no `arm64` in the name)
- **Windows** — `DwellLink Setup *.exe`

The app isn't code-signed (no Apple Developer ID / Windows certificate), so
your OS will show a first-run warning — this is expected for an
internally-distributed tool:

- **macOS**: right-click (or Control-click) the app and choose **Open**,
  then **Open** again in the dialog. You only need to do this once.
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

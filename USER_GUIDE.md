# DwellLink — User Guide

**Resident Connectivity Management, powered by RUCKUS One.**

A guide for front desk staff and property managers using DwellLink day to
day. For installation/build details for IT staff, see
[README.md](README.md).

---

## Contents

1. [Opening the app for the first time](#opening-the-app-for-the-first-time)
2. [Signing in](#signing-in)
3. [First-time setup (admin)](#first-time-setup-admin)
4. [Managing multiple properties (admin)](#managing-multiple-properties-admin)
5. [Navigation and dark mode](#navigation-and-dark-mode)
6. [Managing property units](#managing-property-units)
    - [Bulk actions](#bulk-actions)
7. [Moving a unit out (turnover)](#moving-a-unit-out-turnover)
8. [Importing units from a CSV file](#importing-units-from-a-csv-file)
9. [Exporting units to a CSV file](#exporting-units-to-a-csv-file)
10. [Unit & Guest Wi-Fi](#unit--guest-wi-fi)
11. [Additional Residents](#additional-residents)
12. [Resident directory](#resident-directory)
13. [Wi-Fi QR codes](#wi-fi-qr-codes)
14. [The resident portal link](#the-resident-portal-link)
15. [Connected devices](#connected-devices)
16. [Staff accounts (admin)](#staff-accounts-admin)
    - [Restricting front desk access to specific properties](#restricting-front-desk-access-to-specific-properties)
17. [Audit log (admin)](#audit-log-admin)
18. [Security: auto sign-out (admin)](#security-auto-sign-out-admin)
19. [Software updates (admin)](#software-updates-admin)
20. [Appearance (admin)](#appearance-admin)
21. [Backup & Restore (admin)](#backup--restore-admin)
22. [Troubleshooting](#troubleshooting)

---

## Opening the app for the first time

This app isn't distributed through the Mac App Store, so the first time you
open it, macOS will likely warn that it's "from an unidentified developer."

1. Copy **DwellLink.app** to your **Applications** folder (or open it
   straight from the installer `.dmg`).
2. **Right-click** (or Control-click) the app icon and choose **Open**.
3. Click **Open** again in the dialog that appears.

You only need to do this once — after that, it opens normally by
double-clicking like any other app.

> If macOS says the app "is damaged and can't be opened," it usually means
> the file lost its safety approval in transit (e.g. it was zipped and
> emailed). Ask whoever built the app to re-share it, or see your IT contact.

---

## Signing in

Each staff member should have their own account. Enter your **username**
and **password** on the sign-in screen and click **Sign in**.

You can change your own password any time from **Settings → Change your
password**. If you're locked out, ask an admin to reset it for you from
the **Staff** tab — see [Staff accounts](#staff-accounts-admin). After an
admin-initiated reset, you'll be asked to set your own new password
immediately after signing in with the temporary one, before you can do
anything else in the app.

---

## First-time setup (admin)

If this is a brand new install, you'll see a **Welcome** screen instead of
a sign-in form — no staff accounts exist yet. Create the first one here;
it's automatically a property manager (admin) account.

Once signed in, go to **Settings**:

1. Under **RUCKUS One API connection**, fill in the Tenant ID, Client ID,
   and Client Secret (RUCKUS One → Administration → Account Management →
   Settings → create an Application Token), and click **Save connection
   settings**.
2. Under **Properties**, click **+ Add Property**, then **Load from RUCKUS
   One** to populate the dropdowns — pick your building, its DPSK Pool (the
   one linked to your venue is marked "recommended"), and its Wi-Fi network
   (SSID). Click **Add property**.

The app is now ready to use. See
[Managing multiple properties](#managing-multiple-properties-admin) if you
look after more than one building.

---

## Managing multiple properties (admin)

One DwellLink install can manage several RUCKUS venues ("properties") —
useful if you're a property manager across more than one building. The
sidebar always shows which property you're currently working in, under the
logo.

Under **Settings → Properties**:

- **+ Add Property** — connect another RUCKUS venue, the same way as
  [first-time setup](#first-time-setup-admin): pick the venue, its DPSK
  Pool, and its Wi-Fi network.
- **Set active** — switches the *entire app* to that property — Units,
  Directory, Additional Residents, everything. Front desk staff see
  whichever property is currently active; they can't switch it themselves.
  The sidebar's property dropdown (visible once you have 2+ properties) does
  the same thing without leaving whatever screen you're on.
- **Edit** — change a property's DPSK Pool or Wi-Fi network, or rename how
  it appears in DwellLink (this doesn't rename anything in RUCKUS One
  itself).
- **Remove** — stops DwellLink from managing that property. This only
  affects this install; nothing changes in RUCKUS One.

---

## Navigation and dark mode

The left sidebar is how you move between **Units**, **Directory**,
**Staff** (admin only), **Audit Log** (admin only), **Settings**, and
**Help**. At the bottom of the sidebar, the light/dark switch toggles the
whole app's theme — it's remembered per device, not shared across staff
accounts.

If you manage 2+ properties, the property name at the top of the sidebar
becomes a dropdown you can use to switch properties directly, without
going into Settings (see [Managing multiple
properties](#managing-multiple-properties-admin)).

A small number badge appears on the **Directory** tab whenever any
resident's access is expiring within the next 7 days — a heads-up to check
the Directory's [Expiring soon](#resident-directory) filter without having
to click in first.

---

## Managing property units

The **Units** tab is the home screen — every unit and conference room in
the building, with quick counts at the top (total, active, suspended,
conference rooms), a search box, and filter chips to narrow the list to
just units or just conference rooms.

The first time you sign in, this list is fetched live from RUCKUS One and
can take a little while to populate — a spinner and "Loading units from
RUCKUS One…" message show while it's working, rather than the screen just
looking empty.

- **+ Add Unit** — create a new residential unit. Fill in the unit
  name/number and the resident's name (required), plus email and phone
  (optional, used for Wi-Fi credential notifications and account contact).
- **+ Add Conference Room** — same form, but the unit is created as a
  conference room instead of a residential unit. This can't be changed
  later, so pick the right button up front.
- **Search** — matches unit name, resident name, email, or phone number.
  Try searching an email address to find which unit a person lives in.
- Click any row to open that unit's detail page.
- Conference rooms show a blue **Conference room** tag next to their name
  in the list, so they're easy to tell apart from residential units at a
  glance.

### Bulk actions

Check the box next to any unit (or **select all** in the header) to reveal
a bulk actions bar for everything currently checked:

- **Resend access details** — re-sends each selected unit's Wi-Fi
  credentials by email/SMS, same as doing it one at a time from each unit's
  page.
- **Move-in sheets** — click to choose how you want a move-in Wi-Fi sheet
  (logo, unit, resident name, QR code, network name/password) for every
  selected unit:
  - **Print** — sends them all to your printer as one job, one page per
    unit.
  - **Save as one PDF** — the same sheets as a single PDF file with one page
    per unit, e.g. to file away or hand off as one document.
  - **Save as separate PDFs** — the same sheets as individual PDF files, one
    per unit, e.g. to email each resident their own sheet.

  All three are handy for a whole batch of welcome packets for a new
  building or a bulk move-in day, instead of opening each unit
  individually. A unit with no Wi-Fi network configured or no passphrase
  set yet is skipped in any of the three, and you're told which ones and
  why so nothing silently goes missing from the batch.
- **Suspend** / **Reactivate** — temporarily disable or re-enable every
  selected unit.
- **Delete** (admin only) — permanently deletes every selected unit. This
  cannot be undone in RUCKUS One.

Each action runs across the whole selection and reports how many succeeded
if any individual one failed, rather than stopping at the first problem.

### On a unit's detail page

- **Save changes** — updates the unit name and resident contact info.
- **Resend access details** — has RUCKUS One re-send the resident's Wi-Fi
  passphrase and resident portal link by email/SMS. Useful if a resident
  says they never got their welcome message, or lost it.
- **Suspend unit** / **Reactivate unit** — temporarily disables the unit
  without deleting it.
- **Move out / Turnover** (admin only) — see
  [Moving a unit out](#moving-a-unit-out-turnover) below.
- **Delete unit** (admin only) — permanently removes the unit from RUCKUS
  One. This cannot be undone.
- **Type / Category / PMS unit ID** — shown as read-only text if set;
  RUCKUS doesn't allow changing these after a unit is created.

---

## Moving a unit out (turnover)

When a resident moves out, **Move out / Turnover** (admin only, on the
unit's detail page) does the whole handoff in one step instead of several
manual ones:

- Revokes the unit's owner and guest Wi-Fi access (the departing
  resident's login stops working immediately).
- Removes and deletes every Additional Resident on the unit.
- Clears the resident name, email, and phone so the unit is ready for the
  next tenant's info.

It does **not** suspend the unit itself — a vacant unit between tenants
isn't the same as a suspended one, so suspend separately if you actually
need to. This cannot be undone; confirm you have the right unit before
clicking through the warning.

---

## Importing units from a CSV file

For move-in day or setting up a whole building at once, use **Import CSV**
on the Units tab instead of adding units one at a time.

1. Click **Import CSV**.
2. Click **Download CSV template** to get a starter file with the right
   column headers.
3. Fill it in in Excel/Numbers/Google Sheets — one row per unit:

   | Column | Required? | Notes |
   |---|---|---|
   | `name` | Yes | Unit name/number, or room name for a conference room |
   | `resident_name` | Yes | Resident's or contact's name |
   | `resident_email` | No | |
   | `resident_phone` | No | |
   | `category` | No | `UNIT` (default) or `CONFERENCEROOM` |
   | `pms_unit_id` | No | Your property-management-system's own unit ID, if you track one |
   | `vlan` | No | Owner Wi-Fi VLAN (1-4094) |
   | `description` | No | Owner Wi-Fi description |
   | `passphrase` | No | Owner Wi-Fi passphrase (8-63 characters). Leave blank to set one later from the unit's page instead |
   | `guest_vlan` | No | Guest Wi-Fi VLAN (1-4094) — only applies if this property has guest Wi-Fi configured |
   | `guest_passphrase` | No | Guest Wi-Fi passphrase (8-63 characters) |

4. Save as **.csv** and select it in the app. You'll see a **preview**
   of everything about to be created, including a **Wi-Fi** column
   summarizing any VLAN/passphrase values — check it before importing.
   Rows missing a required column are automatically skipped and listed so
   nothing silently fails; an out-of-range VLAN or too-short passphrase
   doesn't skip the whole row, just that one value (also called out in the
   preview), since the unit and resident are still good without it.
5. Click **Start import**. Units are created one at a time with a live
   progress list; if one row fails (e.g. an invalid phone number format),
   the rest keep going and the failure is reported clearly instead of
   stopping the whole batch. VLAN/description/passphrase values finish
   applying in the background a few seconds after each unit is created
   (RUCKUS processes unit creation asynchronously), so they may not be set
   yet the instant the row shows "created."

---

## Exporting units to a CSV file

**Export CSV** on the Units tab downloads every currently-listed unit
(name, category, resident contact info, status, and RUCKUS ID) as a
spreadsheet — for record-keeping, reporting, or moving data elsewhere. The
first six columns match the import template exactly, so a trimmed export
can be edited and re-imported unchanged.

---

## Unit & Guest Wi-Fi

Every unit has two built-in Wi-Fi logins, shown together with the unit's
Details on its detail page:

- **Unit (owner) Wi-Fi** — the resident's own passphrase.
- **Guest Wi-Fi** — a separate passphrase for their guests, if the venue
  has guest Wi-Fi configured.

For each, you can view/edit the **Passphrase**, **VLAN**, and
**Description**, see which devices are currently connected under it, and:

- **Save details** — saves passphrase/VLAN/description changes.
- **Generate new passphrase** — immediately replaces the current
  passphrase with a new one (the old one stops working). Matches whatever
  passphrase format the property's DPSK service is configured for (e.g.
  numbers-only, dictionary words) rather than a generic random string.
- **QR code** — shows a scannable Wi-Fi QR code for that passphrase (see
  [Wi-Fi QR codes](#wi-fi-qr-codes)).

---

## Additional Residents

For units with more than one person needing their own separate Wi-Fi
login (roommates, etc.), use the **Additional Residents** table on the
unit's detail page.

- **+ Add Resident** — creates a new resident with their own name,
  email, phone, VLAN, description, and expiration date, and their own
  Wi-Fi passphrase.
- **Edit** / **QR** (each row) — change a resident's details, or get a
  scannable Wi-Fi QR code for their passphrase.
- Select one or more residents with the checkboxes to reveal bulk
  actions: **New passphrase**, **Revoke** / **Unrevoke**, and (admin
  only) **Remove** — handle several residents (e.g. a whole roommate
  group moving out) in one action instead of one at a time.

The **Devices** column shows what's actually connected right now under
each resident's login — this is live data from RUCKUS One, refreshed
each time you open the unit.

---

## Resident directory

The **Directory** tab lists every unit's **owner** (the resident of
record) and every **Additional Resident**, across the whole property, in
one place — useful for "a resident calls in, who are they and which unit"
without opening each unit one by one. The **Type** column tags each row
Owner or Resident so the two aren't confused.

- **Search** — matches name, email, phone, unit, or description, across
  both owners and residents.
- **Expiring soon** — shows only residents whose access expires within
  the next 7 days (owners don't have an expiration date, so they're never
  included here).
- **Revoked** — shows only currently-blocked residents (same — owners
  aren't tracked as revocable here).
- Click any row to jump straight to that person's unit. If the row belongs
  to a different property than the one you're currently in, DwellLink
  switches to that property first.
- **Search across all properties** (admin, only shown once you manage 2+
  properties) — expands the list to every property at once, adding a
  **Property** column so you can tell rows apart. Handy when a resident
  calls in and you're not sure which building they're in.
- **Export CSV** — downloads whatever's currently shown (respecting the
  search box and any active filters) as a spreadsheet, including the
  Property column when searching across properties.

---

## Wi-Fi QR codes

Any QR code shown in the app (owner, guest, or additional resident) can
be scanned directly with a phone camera to join Wi-Fi automatically, or
downloaded as a PNG image (**Download** button in the QR window) — handy
for printing a welcome card or including in an email.

For a ready-to-hand-over move-in sheet, use the two buttons next to
Download:

- **Print move-in sheet** — opens your printer dialog with a one-page
  sheet: property logo, unit, resident's name, the QR code, and the Wi-Fi
  network name/password spelled out — nothing else from the app is
  included on the page.
- **Save as PDF** — generates the same sheet as a PDF file you can email or
  save, without needing to go through a printer dialog.

Need sheets for several units at once (a new building, a bulk move-in day)?
Select them from the Units list instead — see [Bulk actions](#bulk-actions)
— which can print them all in one job, save them as one combined PDF, or
save one PDF per unit, rather than doing them one at a time here.

---

## The resident portal link

Each unit has a **Resident portal link** on its Details card — a direct
link to that resident's self-service portal in RUCKUS One, where they can
view their own Wi-Fi details and manage their own connected devices.

- **Copy link** — copies it to your clipboard to paste into an email or
  message.
- **Open** — opens it in your default web browser.

---

## Connected devices

The **Connected devices** card on a unit's page shows every device
currently on Wi-Fi under that unit (owner, guest, or any additional
resident). Click **Check status** to refresh it.

For each connected device:

- **Details** — full information: hostname, operating system, IP
  address, which access point it's connected to, signal health, and how
  long it's been connected.
- **Remove from network** — disconnects that device right now. Note this
  is a one-time kick — the device can reconnect on its own afterward
  unless you also block the identity (below).
- **Block identity** — revokes that resident's entire Wi-Fi passphrase,
  blocking *all* of their devices, not just the one you clicked from.
  RUCKUS doesn't support blocking a single device permanently — blocking
  the identity is the only real way to keep someone off Wi-Fi going
  forward.

---

## Staff accounts (admin)

The **Staff** tab (admin only) lists everyone with access to the app.

- **+ Add Staff Account** — create a new login, choosing **Front desk**
  (day-to-day unit/resident management) or **Property manager (admin)**
  (everything, plus staff accounts, settings, and unit deletion). For a
  front desk account, check off which properties they should have access
  to — see [Restricting front desk access to specific
  properties](#restricting-front-desk-access-to-specific-properties) below.
- **Edit access** (front desk accounts only) — change which properties an
  existing account can see and manage, without having to recreate it.
- **Reset password** — generates a new temporary password for that person
  and shows it to you once so you can share it with them directly (it
  won't be shown again). They should change it from Settings after
  signing in. You can't reset your own password this way — use **Settings
  → Change your password** for that.
- **Delete** — remove an account (you can't delete your own).

Each staff member should have their own account rather than sharing one —
actions are logged per username.

### Restricting front desk access to specific properties

If your team runs multiple properties from one shared workstation, you can
limit each front desk account to only the buildings it should work with —
they won't see, search, or manage any property outside that list, and
properties they don't have access to don't show up anywhere in the app for
them (not just the switcher — the Directory, Units, and everywhere else too).

- When adding or editing a front desk account's access, check the
  properties it should be able to use. Leaving all boxes unchecked means
  that account can't do anything until access is granted.
- A front desk account assigned 2+ properties gets its own sidebar
  quick-switcher (same as an admin's), scoped to only the properties it's
  allowed to use.
- Property managers (admin) are never restricted — they always have access
  to every property, and this doesn't apply to them.
- If the shared workstation's currently-active property isn't one a
  signing-in front desk account has access to, DwellLink automatically
  switches them to one they do have access to rather than showing an error.

---

## Audit log (admin)

The **Audit Log** tab (admin only) shows every account and RUCKUS-affecting
action taken in the app — unit and resident changes, staff account changes,
settings changes, sign-ins, and more — most recent first, with who did it and
when. It shows the last 1000 entries.

- **Search** — filters by username, action, or anything in the detail.
- **Action filter** — narrows to one type of action.
- Click any row to see its full detail.
- **Export CSV** — downloads the currently loaded log as a spreadsheet.
- **Refresh** — reloads the latest entries.

---

## Security: auto sign-out (admin)

Under **Settings → Security**, set how many minutes of inactivity (no mouse
or keyboard use) before the app automatically signs out — useful for a
shared front-desk terminal. This applies to every account on this install,
including admins. Set it to **0** to disable auto sign-out.

---

## Software updates (admin)

Under **Settings → Software Updates**, click **Check for updates** to see
whether a newer build of the app is available and what version you're
currently running. If one exists, **Download update** opens the download
page — updates aren't installed automatically; download and run the new
installer yourself, the same way you installed this one.

---

## Appearance (admin)

Under **Settings → Appearance**, customize the app for your property:

- **App name** — replaces "DwellLink" throughout the app.
- **Logo** — shown on the sign-in screen and in the top bar. Upload a PNG,
  JPEG, SVG, or WebP file.
- **Primary color** / **Accent color** — used for buttons, highlights, and
  the active tab indicator.
- **Login screen message (optional)** — a short note (up to 500 characters)
  shown to staff below the logo on the sign-in screen, e.g. "Building office
  closed Dec 25 - Jan 1." This is only visible on the sign-in screen and is
  never sent to residents — see [Resident directory](#resident-directory)
  and the note on resident announcements in Troubleshooting if you're
  looking to notify residents instead.

Changes apply immediately and to every staff account using this
installation (it's a setting for the install, not per-user).
**Reset to default** restores the original RUCKUS branding.

---

## Backup & Restore (admin)

Under **Settings → Backup & Restore**:

- **Export config backup** — downloads a JSON file with this install's
  RUCKUS connection settings, venue/DPSK/network selection, and
  appearance. Useful before making changes you might want to undo, or
  when setting up a second workstation with the same configuration.

  > **This file contains your RUCKUS API client secret in plain text.**
  > Store it somewhere secure — a password manager, not a shared drive or
  > email — the same way you'd protect any other credential.

- **Restore from backup file** — pick a previously exported file to
  restore all of the above. You'll be asked to confirm, since this
  overwrites your current settings.

This does **not** back up your property units, residents, or anything
else stored in RUCKUS One itself — only this app's own local
configuration. Your actual property data always lives in RUCKUS One.

---

## Troubleshooting

**"RUCKUS One API credentials are not configured yet"**
Go to Settings and fill in the Tenant ID / Client ID / Client Secret
under RUCKUS One API connection, then Save.

**A unit I just created doesn't show up immediately**
RUCKUS One processes new units in the background; click **Refresh** on
the Units tab after a few seconds if it doesn't appear right away.

**"Changing unit category is not supported"**
Type and category can only be set when a unit is first created (via the
right button: Add Unit vs. Add Conference Room) — RUCKUS doesn't allow
changing them afterward.

**A resident's passphrase/VLAN change didn't seem to save**
Some fields on this API take a few seconds to apply in RUCKUS One even
though the app shows success right away. Re-open the unit after a moment
to confirm.

**Search isn't finding someone**
Search matches unit name, PMS unit ID, resident name, email, and phone —
check for typos, or try searching just part of the name or a full email
address.

**I don't see the Staff/Settings tabs, or can't delete a unit**
Those require a **Property manager (admin)** account — a Front desk
account won't have them. Ask an admin to either do it for you or upgrade
your role.

**Can I send a custom announcement to owners/residents?**
Not through RUCKUS One's API today — the only resident-facing notification
it exposes is a fixed, RUCKUS-templated Wi-Fi credential email/SMS
(**Resend access details**), with no field for custom text. RUCKUS does
have one passive option: a per-property "announcement" banner shown on the
resident self-service portal itself (not pushed via email/SMS — residents
only see it if they open the portal), which isn't currently exposed in
DwellLink. Sending genuinely custom messages (email/SMS/push) to residents
would need a separate integration outside RUCKUS One entirely.

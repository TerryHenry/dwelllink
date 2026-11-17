'use strict';

// electron-builder's afterSign hook, run once per macOS build (arm64 and
// x64 separately) right after the .app is assembled but *before* it gets
// packaged into a .dmg/.zip. Ad-hoc signs it here — the same fix already
// needed for the local dev Electron.app (see fix-electron-gatekeeper.js) —
// so the .app inside every packaged artifact is signed from the start.
//
// This matters beyond just avoiding Gatekeeper warnings: electron-builder
// computes each artifact's SHA512 (written into latest-mac.yml, which
// electron-updater checks against the downloaded file before accepting an
// update) from whatever .dmg/.zip it actually builds. Signing the .app
// *after* packaging (the old manual process — build, then codesign, then
// manually rebuild the .dmg/.zip from the signed .app) leaves the update
// feed's hashes describing the *unsigned* artifact, not the one anyone
// actually downloads — a real update would fail electron-updater's
// integrity check. Signing here, before packaging, means the hashes
// electron-builder generates always match the final signed file.
//
// No-op on Windows/Linux (this project doesn't code-sign those either, and
// electron-builder only ever calls afterSign for darwin builds anyway).

const { execFileSync } = require('child_process');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  execFileSync('xattr', ['-cr', appPath]);
  execFileSync('codesign', ['--force', '--deep', '-s', '-', appPath]);
  console.log(`[afterSign] Ad-hoc signed ${appPath}`);
};

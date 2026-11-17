'use strict';

// macOS Gatekeeper/XProtect frequently flags a freshly npm-installed, unsigned
// Electron.app binary as malware (it has been seen outright deleting it, not
// just blocking the launch). Clearing the quarantine attribute and ad-hoc
// signing the binary locally resolves it for local development use. This is
// a no-op on other platforms.

if (process.platform !== 'darwin') process.exit(0);

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app');

if (!fs.existsSync(appPath)) {
  console.warn(`[fix-electron-gatekeeper] ${appPath} not found, skipping.`);
  process.exit(0);
}

try {
  execFileSync('xattr', ['-cr', appPath]);
  execFileSync('codesign', ['--force', '--deep', '-s', '-', appPath]);
  console.log('[fix-electron-gatekeeper] Cleared quarantine and ad-hoc signed the local Electron.app.');
} catch (err) {
  console.warn('[fix-electron-gatekeeper] Could not fix Electron.app automatically:', err.message);
  console.warn('If macOS blocks/deletes Electron.app as malware, run manually:');
  console.warn(`  xattr -cr "${appPath}" && codesign --force --deep -s - "${appPath}"`);
}

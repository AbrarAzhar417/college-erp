// Import this FIRST in every test file: it points the app at a throw-away database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-'));
process.env.NO_LISTEN = '1';
// Every test file runs with the same database guards the real server installs (after all schema modules have loaded).
setTimeout(() => { Promise.all([import('../src/integrity.js'), import('../src/upgrade.js')]).then(([i, u]) => { u.upgradeDatabase(); i.installGuards(); }).catch(() => { /* a test that never loads the database */ }); }, 0);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALL_FILES, updateInstallation } from '../update.js';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

// C1: the updater used to ship the eight 0.1.x files only, so every install
// landed a store.js whose `import ./lib/schema.js` could not resolve.
test('INSTALL_FILES covers every module the runtime imports', () => {
  for (const entry of ['store.js', 'collect.js', 'migrate-v2.js', 'x-session.sh',
    'lib', 'collectors']) {
    assert.ok(INSTALL_FILES.includes(entry), `${entry} must be installed`);
  }
});

test('a fresh install can run store.js and collect.js without a missing module', () => {
  const target = join(mkdtempSync(join(tmpdir(), 'xt-install-')), 'skill');
  updateInstallation({ sourceDir: REPO, targetDir: target });

  for (const entry of INSTALL_FILES) {
    assert.ok(existsSync(join(target, entry)), `${entry} missing from install`);
  }
  assert.ok(existsSync(join(target, 'lib/schema.js')), 'lib copied recursively');
  assert.ok(existsSync(join(target, 'collectors/x.js')), 'collectors copied recursively');

  for (const exe of ['store.js', 'collect.js', 'migrate-v2.js', 'x-session.sh']) {
    assert.equal(statSync(join(target, exe)).mode & 0o111, 0o111, `${exe} must be executable`);
  }

  const base = mkdtempSync(join(tmpdir(), 'xt-base-'));
  const out = execFileSync('node', [join(target, 'store.js'), 'stats'], {
    encoding: 'utf8', env: { ...process.env, XTIPS_BASE: base },
  });
  assert.match(out, /^total: 0$/m);

  // collect.js resolves lib/noise.js at import time; a missing kind exits 1
  // long before any network call, which is enough to prove the import worked.
  assert.throws(() => execFileSync('node', [join(target, 'collect.js')], {
    encoding: 'utf8', stdio: 'pipe',
  }), (err) => {
    assert.doesNotMatch(String(err.stderr), /ERR_MODULE_NOT_FOUND/);
    assert.match(String(err.stderr), /usage: collect\.js/);
    return true;
  });
});

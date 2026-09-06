import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { INSTALL_FILES } from '../update.js';

test('install.sh installs from a local source dir into the requested target', () => {
  const root = mkTempRoot();
  const sourceDir = join(root, 'source');
  const targetDir = join(root, 'target');

  try {
    mkdirSync(sourceDir, { recursive: true });
    for (const file of INSTALL_FILES) {
      writeFileSync(join(sourceDir, file), `new ${file}\n`);
    }
    writeFileSync(join(sourceDir, 'update.js'), readFileSync('update.js', 'utf8'));
    writeFileSync(join(sourceDir, 'package.json'), readFileSync('package.json', 'utf8'));

    execFileSync('bash', ['install.sh'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        X_CLAUDE_TIPS_SOURCE_DIR: sourceDir,
        X_CLAUDE_TIPS_TARGET_DIR: targetDir,
      },
      stdio: 'pipe',
    });

    assert.equal(readFileSync(join(targetDir, 'SKILL.md'), 'utf8'), 'new SKILL.md\n');
    assert.equal(readFileSync(join(targetDir, 'install.sh'), 'utf8'), 'new install.sh\n');
    assert.equal(statSync(join(targetDir, 'install.sh')).mode & 0o111, 0o111);
    assert.equal(statSync(join(targetDir, 'update.js')).mode & 0o111, 0o111);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('README documents the curl pipe install command', () => {
  const readme = readFileSync('README.md', 'utf8');

  assert.match(
    readme,
    /curl -fsSL https:\/\/raw\.githubusercontent\.com\/mshegolev\/x-claude-tips\/main\/install\.sh \| bash/,
  );
});

test('install.sh dry-run does not create the target directory', () => {
  const root = mkTempRoot();
  const sourceDir = join(root, 'source');
  const targetDir = join(root, 'target');

  try {
    mkdirSync(sourceDir, { recursive: true });
    for (const file of INSTALL_FILES) {
      writeFileSync(join(sourceDir, file), `new ${file}\n`);
    }
    writeFileSync(join(sourceDir, 'update.js'), readFileSync('update.js', 'utf8'));
    writeFileSync(join(sourceDir, 'package.json'), readFileSync('package.json', 'utf8'));

    execFileSync('bash', ['install.sh'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        X_CLAUDE_TIPS_SOURCE_DIR: sourceDir,
        X_CLAUDE_TIPS_TARGET_DIR: targetDir,
        X_CLAUDE_TIPS_DRY_RUN: '1',
      },
      stdio: 'pipe',
    });

    assert.equal(existsSync(targetDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function mkTempRoot() {
  const root = join(tmpdir(), `x-tips-install-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

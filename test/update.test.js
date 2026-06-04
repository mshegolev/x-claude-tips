import assert from 'node:assert/strict';
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

import {
  INSTALL_FILES,
  parseUpdateArgs,
  updateInstallation,
} from '../update.js';

test('parseUpdateArgs supports dry-run, source, target, and from-git options', () => {
  const parsed = parseUpdateArgs([
    '--dry-run',
    '--source',
    '/tmp/source',
    '--target',
    '/tmp/target',
    '--from-git',
    '--repo',
    'https://example.invalid/repo.git',
    '--ref',
    'main',
  ]);

  assert.deepEqual(parsed, {
    dryRun: true,
    sourceDir: '/tmp/source',
    targetDir: '/tmp/target',
    fromGit: true,
    repoUrl: 'https://example.invalid/repo.git',
    ref: 'main',
    help: false,
  });
});

test('updateInstallation backs up the target and copies installable files', () => {
  const root = mkTempRoot();
  const sourceDir = join(root, 'source');
  const targetDir = join(root, 'target');
  const backupDir = join(root, 'target.backup-test');

  try {
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    for (const file of INSTALL_FILES) {
      writeFileSync(join(sourceDir, file), `new ${file}\n`);
    }
    writeFileSync(join(targetDir, 'SKILL.md'), 'old skill\n');
    mkdirSync(join(targetDir, 'knowledge/x-tips'), { recursive: true });
    writeFileSync(join(targetDir, 'knowledge/x-tips/rules.jsonl'), 'keep me\n');

    const result = updateInstallation({ sourceDir, targetDir, backupDir });

    assert.equal(result.dryRun, false);
    assert.equal(readFileSync(join(targetDir, 'SKILL.md'), 'utf8'), 'new SKILL.md\n');
    assert.equal(readFileSync(join(backupDir, 'SKILL.md'), 'utf8'), 'old skill\n');
    assert.equal(readFileSync(join(targetDir, 'knowledge/x-tips/rules.jsonl'), 'utf8'), 'keep me\n');
    assert.equal(statSync(join(targetDir, 'store.js')).mode & 0o111, 0o111);
    assert.equal(statSync(join(targetDir, 'refresh_creds.js')).mode & 0o111, 0o111);
    assert.equal(statSync(join(targetDir, 'update.js')).mode & 0o111, 0o111);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateInstallation dry-run reports actions without writing target files', () => {
  const root = mkTempRoot();
  const sourceDir = join(root, 'source');
  const targetDir = join(root, 'target');

  try {
    mkdirSync(sourceDir, { recursive: true });
    for (const file of INSTALL_FILES) {
      writeFileSync(join(sourceDir, file), `new ${file}\n`);
    }

    const result = updateInstallation({ sourceDir, targetDir, dryRun: true });

    assert.equal(result.dryRun, true);
    assert.equal(result.backupDir, null);
    assert.equal(existsSync(targetDir), false);
    assert.equal(result.actions.some((action) => action.type === 'copy' && action.file === 'SKILL.md'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function mkTempRoot() {
  const root = join(tmpdir(), `x-tips-update-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

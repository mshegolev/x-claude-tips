import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateRule, backupPath } from '../migrate-v2.js';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const legacy = {
  id: 'r_0001',
  hash: 'abc123',
  text: 'Use /clear between unrelated tasks.',
  target: 'workflow',
  status: 'adopted',
  seen: 2,
  sources: [
    { id: '111', author: 'a', url: 'u1', likes: 1200, retweets: 40, bookmarks: 0, date: '2026-06-01' },
    { id: '222', author: 'b', url: 'u2', likes: 300, retweets: 200, bookmarks: 0, date: '2026-06-02' },
  ],
  first_seen: '2026-06-01',
  last_seen: '2026-06-02',
  likes_max: 1200,
  bookmarks_max: 0,
  retweets_max: 200,
};

test('migrateRule stamps kind x on every legacy source', () => {
  const r = migrateRule(legacy);
  assert.deepEqual(r.sources.map((s) => s.kind), ['x', 'x']);
});

test('migrateRule moves twitter metrics into metrics object', () => {
  const r = migrateRule(legacy);
  assert.deepEqual(r.sources[0].metrics, { likes: 1200, retweets: 40 });
  assert.equal(r.sources[0].bookmarks, undefined);
});

test('migrateRule sets authority 1 and consensus from source count', () => {
  const r = migrateRule(legacy);
  assert.equal(r.authority, 1);
  assert.equal(r.consensus, 2);
  assert.deepEqual(r.kinds, ['x']);
});

test('migrateRule drops seen and bookmarks_max', () => {
  const r = migrateRule(legacy);
  assert.equal(r.seen, undefined);
  assert.equal(r.bookmarks_max, undefined);
});

test('migrateRule preserves status, notes and identity', () => {
  const r = migrateRule(legacy);
  assert.equal(r.status, 'adopted');
  assert.equal(r.id, 'r_0001');
  assert.equal(r.text, legacy.text);
  assert.equal(r.likes_max, 1200);
});

test('migrateRule is idempotent', () => {
  const once = migrateRule(legacy);
  const twice = migrateRule(once);
  assert.deepEqual(twice, once);
});

test('backupPath creates date-stamped backup when none exists', () => {
  const tmpDir = tmpdir();
  const source = join(tmpDir, `test-source-${Date.now()}.txt`);
  const sourceContent = 'original data';
  writeFileSync(source, sourceContent);

  const bakPath = backupPath(source);

  try {
    assert(bakPath.includes('.bak-'), 'backup path includes .bak- marker');
    assert(bakPath.match(/\d{4}-\d{2}-\d{2}$/), 'backup has date stamp YYYY-MM-DD');
    const bakContent = readFileSync(bakPath, 'utf8');
    assert.equal(bakContent, sourceContent, 'backup contains source content');
  } finally {
    try { unlinkSync(source); } catch {}
    try { unlinkSync(bakPath); } catch {}
  }
});

test('backupPath creates timestamped backup when date backup exists', () => {
  const tmpDir = tmpdir();
  const source = join(tmpDir, `test-source-${Date.now()}.txt`);
  const sourceContent1 = 'first backup';
  const sourceContent2 = 'second backup';

  writeFileSync(source, sourceContent1);
  const first = backupPath(source);

  writeFileSync(source, sourceContent2);
  const second = backupPath(source);

  try {
    // First backup should be date-stamped
    assert(first.match(/\d{4}-\d{2}-\d{2}$/), 'first has date stamp');
    assert.equal(readFileSync(first, 'utf8'), sourceContent1, 'first unchanged');

    // Second backup should be timestamped (different name)
    assert.notEqual(first, second, 'second backup has different name');
    assert(second.match(/T\d{2}-\d{2}-\d{2}$/), 'second has timestamp');
    assert.equal(readFileSync(second, 'utf8'), sourceContent2, 'second contains new content');

    // First must remain untouched
    assert.equal(readFileSync(first, 'utf8'), sourceContent1, 'first still has original content');
  } finally {
    unlinkSync(source);
    try { unlinkSync(first); } catch {}
    try { unlinkSync(second); } catch {}
  }
});

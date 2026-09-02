import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateRule } from '../migrate-v2.js';

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

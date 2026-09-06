import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kind, tier, useNoiseFilter, toItems, collect } from '../collectors/docs.js';

const FIXTURE = readFileSync(
  new URL('./fixtures/docs-hooks.md', import.meta.url), 'utf8');
const URL_ = 'https://code.claude.com/docs/en/hooks.md';

test('declares tier 3 and opts out of the noise filter', () => {
  assert.equal(kind, 'docs');
  assert.equal(tier, 3);
  assert.equal(useNoiseFilter, false);
});

test('toItems turns sections into items with heading as ref', () => {
  const items = toItems(URL_, FIXTURE);
  assert.ok(items.length >= 5);
  const one = items[0];
  assert.equal(one.kind, 'docs');
  assert.equal(one.url, URL_);
  assert.ok(one.ref.length > 0, 'ref must carry the section heading');
  assert.equal(one.metrics, null, 'docs sources have no engagement metrics');
  assert.equal(one.truncated, false, 'markdown sources are never truncated');
  assert.match(one.id, /^docs:[0-9a-f]{12}$/);
});

test('ids are stable across runs and distinct per section', () => {
  const a = toItems(URL_, FIXTURE);
  const b = toItems(URL_, FIXTURE);
  assert.deepEqual(a.map((i) => i.id), b.map((i) => i.id));
  assert.equal(new Set(a.map((i) => i.id)).size, a.length, 'ids must be unique');
});

test('collect gathers every source and records per-source errors', async () => {
  const seen = [];
  const fetchFn = (url) => {
    seen.push(url);
    if (seen.length === 2) throw new Error('boom');
    return FIXTURE;
  };
  const r = await collect({ since: '2026-08-01', fetchFn });
  assert.equal(r.total, seen.length, 'total must count every attempted source');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].error, /boom/);
  assert.ok(r.errors[0].query.startsWith('https://'), 'query holds the source URL');
  assert.ok(r.items.length > 0, 'a failed source must not discard the others');
});

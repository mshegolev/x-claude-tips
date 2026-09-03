import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, tierOf, sourceId, makeSource, deriveRuleFields } from '../lib/schema.js';

test('tierOf returns documented tiers', () => {
  assert.equal(tierOf('docs'), 3);
  assert.equal(tierOf('changelog'), 3);
  assert.equal(tierOf('lessons'), 3);
  assert.equal(tierOf('github'), 2);
  assert.equal(tierOf('x'), 1);
});

test('tierOf rejects unknown kind', () => {
  assert.throws(() => tierOf('mastodon'), /unknown kind/);
});

test('sourceId is stable and namespaced by kind', () => {
  const a = sourceId('docs', 'https://docs.claude.com/hooks', 'PreToolUse');
  const b = sourceId('docs', 'https://docs.claude.com/hooks', 'PreToolUse');
  const c = sourceId('docs', 'https://docs.claude.com/hooks', 'PostToolUse');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^docs:[0-9a-f]{12}$/);
});

// The old name claimed kind-conditional nulling that lib/schema.js has never
// implemented; it only passed because it passed no metrics. makeSource is
// deliberately kind-agnostic — stage-3 github sources carry {stars, forks}.
test('makeSource defaults metrics to null when the caller supplies none', () => {
  const s = makeSource({ id: 'docs:abc', kind: 'docs', url: 'u', ref: 'r' });
  assert.equal(s.metrics, null);
  assert.equal(s.kind, 'docs');
  assert.ok(s.collected_at);
});

test('makeSource passes metrics through for any kind', () => {
  const gh = makeSource({
    id: 'github:abc', kind: 'github', metrics: { stars: 900, forks: 40 },
  });
  assert.deepEqual(gh.metrics, { stars: 900, forks: 40 });
  const docs = makeSource({ id: 'docs:abc', kind: 'docs', metrics: { likes: 5 } });
  assert.deepEqual(docs.metrics, { likes: 5 });
});

test('makeSource keeps a caller-supplied collected_at', () => {
  const s = makeSource({ id: 'x:1', kind: 'x', collectedAt: '2026-09-01' });
  assert.equal(s.collected_at, '2026-09-01');
});

test('deriveRuleFields takes max tier and counts distinct sources', () => {
  const sources = [
    makeSource({ id: '1', kind: 'x', metrics: { likes: 9000, retweets: 800 } }),
    makeSource({ id: '2', kind: 'x', metrics: { likes: 10, retweets: 1 } }),
    makeSource({ id: '3', kind: 'x', metrics: { likes: 20, retweets: 2 } }),
  ];
  assert.deepEqual(deriveRuleFields(sources), {
    authority: 1, consensus: 3, kinds: ['x'],
  });
});

test('one docs source outranks three x sources', () => {
  const docs = deriveRuleFields([makeSource({ id: 'd', kind: 'docs' })]);
  const x3 = deriveRuleFields([
    makeSource({ id: '1', kind: 'x' }),
    makeSource({ id: '2', kind: 'x' }),
    makeSource({ id: '3', kind: 'x' }),
  ]);
  assert.ok(docs.authority > x3.authority);
});

test('deriveRuleFields rejects empty source list', () => {
  assert.throws(() => deriveRuleFields([]), /at least one source/);
});

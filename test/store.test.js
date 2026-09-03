import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STORE = new URL('../store.js', import.meta.url).pathname;

function runIn(base, args) {
  return execFileSync('node', [STORE, ...args], {
    encoding: 'utf8', env: { ...process.env, XTIPS_BASE: base },
  });
}

test('add stores kind, authority and consensus', () => {
  const base = mkdtempSync(join(tmpdir(), 'xt-'));
  runIn(base, ['add', '--text', 'Use /clear between tasks.', '--target', 'workflow',
    '--source', '111', '--kind', 'x', '--likes', '1200', '--retweets', '40']);
  const rules = readFileSync(join(base, 'rules.jsonl'), 'utf8')
    .trim().split('\n').map(JSON.parse);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].authority, 1);
  assert.equal(rules[0].consensus, 1);
  assert.deepEqual(rules[0].kinds, ['x']);
  assert.deepEqual(rules[0].sources[0].metrics, { likes: 1200, retweets: 40 });
});

test('docs source yields authority 3 and null metrics', () => {
  const base = mkdtempSync(join(tmpdir(), 'xt-'));
  runIn(base, ['add', '--text', 'Register hooks in settings.json.', '--target', 'hook',
    '--source', 'docs:abc123def456', '--kind', 'docs',
    '--url', 'https://docs.claude.com/hooks', '--ref', 'PreToolUse']);
  const r = JSON.parse(readFileSync(join(base, 'rules.jsonl'), 'utf8').trim());
  assert.equal(r.authority, 3);
  assert.equal(r.sources[0].metrics, null);
  assert.equal(r.sources[0].ref, 'PreToolUse');
});

test('second source raises consensus, not authority', () => {
  const base = mkdtempSync(join(tmpdir(), 'xt-'));
  const args = ['--text', 'Use /clear between tasks.', '--target', 'workflow', '--kind', 'x'];
  runIn(base, ['add', ...args, '--source', '111', '--likes', '1200']);
  const out = runIn(base, ['add', ...args, '--source', '222', '--likes', '50']);
  assert.match(out, /DUPE .* consensus=2/);
  const r = JSON.parse(readFileSync(join(base, 'rules.jsonl'), 'utf8').trim());
  assert.equal(r.consensus, 2);
  assert.equal(r.authority, 1);
});

test('list sorts authority first, consensus second', () => {
  const base = mkdtempSync(join(tmpdir(), 'xt-'));
  const x = ['--target', 'workflow', '--kind', 'x'];
  runIn(base, ['add', '--text', 'Rule from x one.', ...x, '--source', '1', '--likes', '9000']);
  runIn(base, ['add', '--text', 'Rule from x one.', ...x, '--source', '2', '--likes', '10']);
  runIn(base, ['add', '--text', 'Rule from x one.', ...x, '--source', '3', '--likes', '10']);
  runIn(base, ['add', '--text', 'Rule from the official docs.', '--target', 'hook',
    '--kind', 'docs', '--source', 'docs:zzz', '--url', 'u']);
  const out = runIn(base, ['list', '--json']);
  const rules = JSON.parse(out);
  assert.equal(rules[0].kinds[0], 'docs', 'docs rule with consensus 1 must come first');
  assert.equal(rules[1].consensus, 3);
});

test('index has no bookmarks column', () => {
  const base = mkdtempSync(join(tmpdir(), 'xt-'));
  runIn(base, ['add', '--text', 'Some rule text.', '--target', 'other',
    '--source', '1', '--kind', 'x', '--likes', '5']);
  runIn(base, ['index']);
  const idx = readFileSync(join(base, 'INDEX.md'), 'utf8');
  assert.ok(!idx.includes('bookmarks'), 'bookmarks column must be gone');
  assert.ok(idx.includes('auth'), 'auth column must be present');
  assert.ok(idx.includes('kinds'), 'kinds column must be present');
});

// MINOR: --kind was not validated like --target/--status, so `--kind mastodon`
// printed a raw `unknown kind` stack out of tierOf().
test('unknown kind is rejected with a usage error, not a stack', () => {
  const base = mkdtempSync(join(tmpdir(), 'xt-'));
  let err;
  try {
    runIn(base, ['add', '--text', 'Some rule.', '--target', 'other',
      '--source', '1', '--kind', 'mastodon']);
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'must exit non-zero');
  assert.equal(err.status, 2);
  assert.match(String(err.stderr), /invalid choice: 'mastodon'/);
  assert.doesNotMatch(String(err.stderr), /at .*schema\.js/);
});

// MINOR: store.js reintroduced `kind === 'x' ? {...} : null`, the branch the
// Task-2 ruling removed because stage-3 github sources need {stars, forks}.
test('metrics are passed through regardless of kind', () => {
  const base = mkdtempSync(join(tmpdir(), 'xt-'));
  runIn(base, ['add', '--text', 'A docs rule with metrics.', '--target', 'hook',
    '--source', 'docs:m1', '--kind', 'docs', '--likes', '7', '--retweets', '3']);
  const r = JSON.parse(readFileSync(join(base, 'rules.jsonl'), 'utf8').trim());
  assert.deepEqual(r.sources[0].metrics, { likes: 7, retweets: 3 });
});

// MINOR: the staging item's collected_at was discarded and today() stamped
// instead, so a rule extracted the morning after a run got the wrong date.
test('add uses the source timestamp when the caller supplies one', () => {
  const base = mkdtempSync(join(tmpdir(), 'xt-'));
  runIn(base, ['add', '--text', 'A rule collected yesterday.', '--target', 'other',
    '--source', '42', '--kind', 'x', '--likes', '1200',
    '--collected-at', '2026-09-01T23:41:02']);
  const r = JSON.parse(readFileSync(join(base, 'rules.jsonl'), 'utf8').trim());
  assert.equal(r.sources[0].collected_at, '2026-09-01T23:41:02');
});

test('bookmarks flag is rejected', () => {
  const base = mkdtempSync(join(tmpdir(), 'xt-'));
  assert.throws(() => runIn(base, ['add', '--text', 'x', '--target', 'other',
    '--source', '1', '--bookmarks', '300']));
});

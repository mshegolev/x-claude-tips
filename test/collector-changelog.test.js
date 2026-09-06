import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  kind, tier, useNoiseFilter, parseReleases, toItems, lastSeenVersion, collect,
} from '../collectors/changelog.js';

const FIXTURE = readFileSync(
  new URL('./fixtures/changelog.md', import.meta.url), 'utf8');
const URL_ = 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md';

const SAMPLE = `# Changelog

## 2.1.0

- Added a thing
- Fixed another thing

## 2.0.9

- Older entry
`;

test('declares tier 3 and opts out of the noise filter', () => {
  assert.equal(kind, 'changelog');
  assert.equal(tier, 3);
  assert.equal(useNoiseFilter, false);
});

test('parseReleases pulls version headings in document order', () => {
  const r = parseReleases(SAMPLE);
  assert.deepEqual(r.map((x) => x.version), ['2.1.0', '2.0.9']);
  assert.match(r[0].text, /Added a thing/);
  assert.ok(!r[0].text.includes('Older entry'));
});

test('parseReleases handles the real changelog fixture', () => {
  const r = parseReleases(FIXTURE);
  assert.ok(r.length >= 5, `expected several releases, got ${r.length}`);
  assert.ok(r.every((x) => /\d/.test(x.version)), 'every version must contain a digit');
});

test('toItems stops at the last seen version', () => {
  const all = toItems(URL_, SAMPLE, null);
  assert.deepEqual(all.map((i) => i.ref), ['2.1.0', '2.0.9']);
  const fresh = toItems(URL_, SAMPLE, '2.0.9');
  assert.deepEqual(fresh.map((i) => i.ref), ['2.1.0'],
    'entries at or below the last seen version must not be re-emitted');
});

test('items carry the documented shape', () => {
  const [one] = toItems(URL_, SAMPLE, null);
  assert.equal(one.kind, 'changelog');
  assert.equal(one.metrics, null);
  assert.equal(one.truncated, false);
  assert.equal(one.ref, '2.1.0');
  assert.match(one.id, /^changelog:[0-9a-f]{12}$/);
});

test('lastSeenVersion reads the newest previous staging run', () => {
  const base = mkdtempSync(join(tmpdir(), 'xt-cl-'));
  const dir = join(base, 'staging', 'changelog');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '2026-09-01T00-00-00.json'),
    JSON.stringify({ items: [{ ref: '2.0.5' }] }));
  writeFileSync(join(dir, '2026-09-05T00-00-00.json'),
    JSON.stringify({ items: [{ ref: '2.1.0' }, { ref: '2.0.9' }] }));
  assert.equal(lastSeenVersion(base), '2.1.0');
});

test('lastSeenVersion skips empty runs and keeps the watermark', () => {
  const base = mkdtempSync(join(tmpdir(), 'xt-cl-'));
  const dir = join(base, 'staging', 'changelog');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '2026-09-05T00-00-00.json'),
    JSON.stringify({ items: [{ ref: '2.1.0' }] }));
  // Прогон, не нашедший ничего нового, пишет пустой items. Он не должен
  // стирать водяной знак — иначе следующий запуск застейджит всё заново.
  writeFileSync(join(dir, '2026-09-06T00-00-00.json'),
    JSON.stringify({ items: [] }));
  assert.equal(lastSeenVersion(base), '2.1.0');
});

test('lastSeenVersion returns null on a first ever run', () => {
  assert.equal(lastSeenVersion(mkdtempSync(join(tmpdir(), 'xt-cl-'))), null);
});

test('collect records a fetch failure without throwing', async () => {
  const base = mkdtempSync(join(tmpdir(), 'xt-cl-'));
  const r = await collect({
    fetchFn: () => { throw new Error('down'); }, baseDir: base,
  });
  assert.equal(r.items.length, 0);
  assert.equal(r.errors.length, 1);
  assert.equal(r.total, 1);
  assert.match(r.errors[0].error, /down/);
});

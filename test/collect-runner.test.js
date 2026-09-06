import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// Собираем временный коллектор и запускаем реальный collect.js против него.
function runCollector({ kind, body }) {
  const base = mkdtempSync(join(tmpdir(), 'xt-run-'));
  const dir = join(ROOT, 'collectors');
  const file = join(dir, `${kind}.js`);
  writeFileSync(file, body);
  try {
    const out = execFileSync('node', [join(ROOT, 'collect.js'), kind], {
      encoding: 'utf8', env: { ...process.env, XTIPS_BASE: base },
    });
    const staged = join(base, 'staging', kind);
    const f = readFileSync(join(staged, readdirSync(staged)[0]), 'utf8');
    return { out, staging: JSON.parse(f) };
  } finally {
    rmSync(file, { force: true });
  }
}

const ITEM = (text) => `{
  id: 'i1', kind: KIND, author: '', url: 'u', ref: 'r',
  text: ${JSON.stringify(text)}, metrics: null, truncated: false,
  collected_at: '2026-09-06T00:00:00',
}`;

test('a collector opting out keeps items the noise filter would drop', () => {
  const kind = 'tmpoptout';
  const body = `const KIND = '${kind}';
export const kind = KIND;
export const tier = 3;
export const useNoiseFilter = false;
export async function collect() {
  return { items: [${ITEM('Announcing plugins. Short.')}], errors: [], total: 1 };
}`;
  const { staging } = runCollector({ kind, body });
  assert.equal(staging.items.length, 1, 'opted-out collector must keep the item');
  assert.equal(staging.dropped.length, 0);
});

test('a collector that does not opt out still gets filtered', () => {
  const kind = 'tmpoptin';
  const body = `const KIND = '${kind}';
export const kind = KIND;
export const tier = 3;
export async function collect() {
  return { items: [${ITEM('Announcing plugins. Short.')}], errors: [], total: 1 };
}`;
  const { staging } = runCollector({ kind, body });
  assert.equal(staging.items.length, 0, 'default must remain filter-on');
  assert.equal(staging.dropped[0].reason, 'announcement');
});

test('staging records tier from the collector', () => {
  const kind = 'tmptier';
  const body = `const KIND = '${kind}';
export const kind = KIND;
export const tier = 3;
export const useNoiseFilter = false;
export async function collect() {
  return { items: [${ITEM('A long enough sentence that survives every noise rule easily.')}], errors: [], total: 1 };
}`;
  const { staging } = runCollector({ kind, body });
  assert.equal(staging.tier, 3);
  assert.equal(staging.collected, 1);
});

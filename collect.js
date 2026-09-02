#!/usr/bin/env node
// Раннер коллекторов: запускает префлайт, собирает сырьё, пишет стейджинг.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { filterItems } from './lib/noise.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.XTIPS_BASE || join(homedir(), '.claude/knowledge/x-tips');

function runId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function defaultSince(days) {
  const d = new Date(Date.now() - days * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    since: { type: 'string' },
    days: { type: 'string', default: '14' },
    'no-filter': { type: 'boolean', default: false },
  },
});

const kind = positionals[0];
if (!kind) {
  process.stderr.write('usage: collect.js <kind> [--since YYYY-MM-DD] [--days N] [--no-filter]\n');
  process.exit(1);
}

const since = values.since || defaultSince(Number(values.days));

if (kind === 'x') {
  execFileSync(join(HERE, 'x-session.sh'), { stdio: 'inherit' });
}

const mod = await import(join(HERE, 'collectors', `${kind}.js`));
const { items: raw, errors, total } = await mod.collect({ since });
const { kept, dropped } = values['no-filter']
  ? { kept: raw, dropped: [] }
  : filterItems(raw);

const dir = join(BASE, 'staging', kind);
mkdirSync(dir, { recursive: true });
const out = join(dir, `${runId()}.json`);
writeFileSync(out, JSON.stringify({
  kind, tier: mod.tier, since, collected: raw.length,
  items: kept, dropped, errors,
}, null, 2));

console.log(`${kind}: collected ${raw.length}, kept ${kept.length}, dropped ${dropped.length}`);
if (errors.length > 0) {
  console.log(`${kind}: ${errors.length} of ${total} queries failed (see staging file)`);
}
console.log(`staging -> ${out}`);

// Every query failed: this is a real failure, not partial success.
if (total > 0 && errors.length === total) {
  process.exit(1);
}

#!/usr/bin/env node
// Раннер коллекторов: запускает префлайт, собирает сырьё, пишет стейджинг.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DROP_REASONS, dropEntry, filterItems } from './lib/noise.js';

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

const USAGE =
  'usage: collect.js <kind> [--since YYYY-MM-DD] [--days N] [--no-filter]\n';

let values;
let positionals;
try {
  // parseArgs бросает на неизвестном флаге и на `--days -5` (минус читается
  // как начало опции; работает форма `--days=-5`). Без перехвата это сырой
  // стек вместо сообщения.
  ({ values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      since: { type: 'string' },
      days: { type: 'string', default: '14' },
      'no-filter': { type: 'boolean', default: false },
    },
  }));
} catch (err) {
  process.stderr.write(`collect.js: ${err.message}\n${USAGE}`);
  process.exit(2);
}

const kind = positionals[0];
if (!kind) {
  process.stderr.write(USAGE);
  process.exit(1);
}

// --days abc сделало бы since:NaN-NaN-NaN и потратило бы живой запрос из
// бюджета 8 поисков / 10 минут. Проверяем до любого обращения к сети.
const days = Number(values.days);
if (!Number.isFinite(days) || days <= 0) {
  process.stderr.write(
    `collect.js: --days must be a positive number, got '${values.days}'\n`);
  process.exit(2);
}

const since = values.since || defaultSince(days);

if (kind === 'x') {
  execFileSync(join(HERE, 'x-session.sh'), { stdio: 'inherit' });
}

const mod = await import(join(HERE, 'collectors', `${kind}.js`));
const { items: raw, errors, total } = await mod.collect({ since });

// Порог вовлечённости — такой же фильтр, как шумовой, и отбраковка по нему
// должна быть видна в стейджинге: раньше он применялся внутри коллектора,
// посты исчезали без единой записи, и это был единственный слой, который
// нельзя было перенастроить офлайн. --no-filter снимает ОБА фильтра.
const passesEngagement = typeof mod.passesEngagement === 'function'
  ? mod.passesEngagement
  : () => true;

let kept = raw;
let dropped = [];
if (!values['no-filter']) {
  const survivors = [];
  for (const item of raw) {
    if (passesEngagement(item)) survivors.push(item);
    else dropped.push(dropEntry(item, DROP_REASONS.ENGAGEMENT));
  }
  const noise = filterItems(survivors);
  kept = noise.kept;
  dropped = dropped.concat(noise.dropped);
}

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

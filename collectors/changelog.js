// Коллектор changelog Claude Code. Диф против прошлого прогона: заново
// стейджить весь файл на каждом запуске бессмысленно — правило из релиза
// извлекается один раз.
//
// Источник — CHANGELOG.md на GitHub, а не страница документации: последняя
// является его сгенерированным рендером, где версии превращены в MDX-теги
// <Update label="…">, тогда как исходник даёт разбираемые заголовки `## версия`.
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceId } from '../lib/schema.js';
import { fetchText } from '../lib/fetch-text.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export const kind = 'changelog';
export const tier = 3;
export const useNoiseFilter = false;

export const SOURCES = JSON.parse(
  readFileSync(join(HERE, 'sources.json'), 'utf8')).changelog;

function nowIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function parseReleases(markdown) {
  const lines = String(markdown).split('\n');
  const out = [];
  let current = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) out.push(current);
      current = { version: m[1], lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) out.push(current);
  return out.map((r) => ({ version: r.version, text: r.lines.join('\n').trim() }))
    .filter((r) => r.text.length > 0);
}

export function toItems(url, markdown, sinceVersion) {
  const collected = nowIso();
  const items = [];
  for (const r of parseReleases(markdown)) {
    // Файл идёт от новых к старым: встретив уже виденную версию, дальше
    // всё старее — останавливаемся.
    if (sinceVersion && r.version === sinceVersion) break;
    items.push({
      id: sourceId(kind, url, r.version),
      kind,
      author: 'anthropic',
      url,
      ref: r.version,
      text: r.text,
      metrics: null,
      truncated: false,
      collected_at: collected,
    });
  }
  return items;
}

export function lastSeenVersion(baseDir) {
  const dir = join(baseDir, 'staging', kind);
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return null;
  }
  // Идём от новых прогонов к старым: прогон, не нашедший ничего нового,
  // пишет пустой items и водяного знака не несёт. Останавливаться на нём
  // значило бы потерять отметку и застейджить весь файл заново.
  for (let i = files.length - 1; i >= 0; i--) {
    try {
      const prev = JSON.parse(readFileSync(join(dir, files[i]), 'utf8'));
      const ref = prev.items?.[0]?.ref;
      if (ref) return ref;
    } catch {
      // повреждённый файл прогона — пробуем предыдущий
    }
  }
  return null;
}

export async function collect({
  fetchFn = fetchText,
  baseDir = process.env.XTIPS_BASE || join(homedir(), '.claude/knowledge/x-tips'),
} = {}) {
  const since = lastSeenVersion(baseDir);
  const items = [];
  const errors = [];
  for (const url of SOURCES) {
    try {
      items.push(...toItems(url, fetchFn(url), since));
    } catch (err) {
      errors.push({ query: url, error: err.message });
    }
  }
  return { items, errors, total: SOURCES.length };
}

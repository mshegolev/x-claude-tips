// Коллектор официальной документации Claude Code.
// Источник — markdown-версии страниц (суффикс .md): HTML-версия весит около
// 2.8 МБ JS-разметки и парсить её незачем.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceId } from '../lib/schema.js';
import { splitSections } from '../lib/markdown-sections.js';
import { fetchText } from '../lib/fetch-text.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export const kind = 'docs';
export const tier = 3;
// Шумовой фильтр писался под X: короткая секция ушла бы как link-only,
// «Introducing …» — как announcement. К документации он неприменим.
export const useNoiseFilter = false;

const MIN_SECTION_CHARS = 200;

export const SOURCES = JSON.parse(
  readFileSync(join(HERE, 'sources.json'), 'utf8')).docs;

function nowIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function toItems(url, markdown) {
  const collected = nowIso();
  return splitSections(markdown, { minChars: MIN_SECTION_CHARS }).map((s) => ({
    id: sourceId(kind, url, s.heading),
    kind,
    author: 'anthropic',
    url,
    ref: s.heading,
    text: s.text,
    metrics: null,
    truncated: false,
    collected_at: collected,
  }));
}

// `since` не применяется: документация не датирована по секциям, и отбор
// свежего делается человеком на ревью. Параметр принимается ради единого
// контракта коллектора.
export async function collect({ fetchFn = fetchText } = {}) {
  const items = [];
  const errors = [];
  for (const url of SOURCES) {
    try {
      items.push(...toItems(url, fetchFn(url)));
    } catch (err) {
      errors.push({ query: url, error: err.message });
    }
  }
  return { items, errors, total: SOURCES.length };
}

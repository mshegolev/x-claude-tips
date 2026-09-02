// Тиры источников и вывод полей правила. Без сети и файлов.
import { createHash } from 'node:crypto';

export const TIERS = Object.freeze({
  docs: 3, changelog: 3, lessons: 3, github: 2, x: 1,
});

export function tierOf(kind) {
  const t = TIERS[kind];
  if (t === undefined) throw new Error(`unknown kind: ${kind}`);
  return t;
}

export function sourceId(kind, url, ref = '') {
  tierOf(kind);
  const h = createHash('sha256').update(`${url}#${ref}`).digest('hex');
  return `${kind}:${h.slice(0, 12)}`;
}

function nowIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function makeSource({
  id, kind, author = '', url = '', ref = '', metrics = null, collectedAt = null,
}) {
  tierOf(kind);
  if (!id) throw new Error('source id is required');
  return {
    id,
    kind,
    author,
    url,
    ref,
    metrics: metrics ?? null,
    collected_at: collectedAt || nowIso(),
  };
}

export function deriveRuleFields(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('deriveRuleFields needs at least one source');
  }
  const kinds = [...new Set(sources.map((s) => s.kind))].sort();
  const authority = Math.max(...sources.map((s) => tierOf(s.kind)));
  return { authority, consensus: sources.length, kinds };
}

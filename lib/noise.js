// Детерминированный шумовой фильтр. Отброшенное не удаляется, а помечается.

export const DROP_REASONS = Object.freeze({
  ENGAGEMENT: 'engagement',
  BAIT: 'bait',
  LISTICLE: 'listicle',
  ANNOUNCEMENT: 'announcement',
  LINK_ONLY: 'link-only',
  CLONE: 'clone',
});

const URL_RE = /https?:\/\/\S+/g;

// Отрезаем ведущие эмодзи и пунктуацию, чтобы "🚨 BREAKING" и "BREAKING" совпадали.
function lead(text) {
  return String(text).replace(/^[^\p{L}\p{N}]+/u, '');
}

const BAIT_RE = /^(?:BREAKING NEWS|Holy shit)/i;
const LISTICLE_RE = /\b\d+\s+(?:[\w-]+\s+){0,3}(?:add-ons|tools|repos|skills|prompts)\b/i;
const ANNOUNCE_RE = /^(?:Announcing|Introducing|Today,?\s+I['’]?m\s+open-sourcing|We['’]?re\s+(?:launching|rolling out))/i;

function visibleLength(text) {
  return String(text)
    .replace(URL_RE, ' ')
    .replace(/[\p{Extended_Pictographic}️]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

export function classify(text) {
  const head = lead(text);
  if (BAIT_RE.test(head)) return DROP_REASONS.BAIT;
  if (LISTICLE_RE.test(text)) return DROP_REASONS.LISTICLE;
  if (ANNOUNCE_RE.test(head)) return DROP_REASONS.ANNOUNCEMENT;
  if (visibleLength(text) < 80) return DROP_REASONS.LINK_ONLY;
  return null;
}

function cloneKey(text) {
  return String(text)
    .toLowerCase()
    .replace(URL_RE, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// Аудит по одному id невозможен: SKILL.md просит просматривать dropped на
// ложные срабатывания, а без текста это требует повторного запроса к X —
// ровно того, ради чего существует стейджинг. author дешёв и делает список
// читаемым. Общая форма для всех причин, включая engagement из collect.js.
export function dropEntry(item, reason) {
  return {
    id: item.id,
    reason,
    author: item.author || '',
    text: item.text || '',
  };
}

export function filterItems(items) {
  const kept = [];
  const dropped = [];
  const seen = new Set();
  for (const item of items) {
    const reason = classify(item.text);
    if (reason) {
      dropped.push(dropEntry(item, reason));
      continue;
    }
    const key = cloneKey(item.text);
    if (seen.has(key)) {
      dropped.push(dropEntry(item, DROP_REASONS.CLONE));
      continue;
    }
    seen.add(key);
    kept.push(item);
  }
  return { kept, dropped };
}

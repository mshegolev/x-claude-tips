// Коллектор X. Бьёт в REST локального x-browser-mcp.
import { execFileSync } from 'node:child_process';

export const kind = 'x';
export const tier = 1;

const API = 'http://127.0.0.1:18110/api/v1/search';
const MIN_INTERVAL_MS = 18000; // MinSearchInterval сервера 15s, берём запас
const TRUSTED = new Set(['AnthropicAI', 'alexalbert__', '_catwu', 'Sauers_', 'sauers_']);

export function QUERIES(since) {
  return [
    `"CLAUDE.md" min_faves:500 since:${since} lang:en`,
    `"claude code" (subagent OR agent) min_faves:500 since:${since} lang:en`,
    `"claude code" (hook OR skill OR "slash command") min_faves:500 since:${since} lang:en`,
    `"claude code" (tip OR trick OR workflow OR config) min_faves:1000 since:${since} lang:en`,
    `from:AnthropicAI claude code since:${since}`,
    `from:alexalbert__ OR from:_catwu OR from:sauers_ claude since:${since}`,
  ];
}

export function passesEngagement(item) {
  const likes = item.metrics?.likes ?? 0;
  const retweets = item.metrics?.retweets ?? 0;
  if (TRUSTED.has(item.author)) return likes >= 200;
  return likes >= 1000 || retweets >= 150;
}

// Сервер отдаёт видимый текст карточки (~280 символов), поэтому длинные
// треды приходят обрезанными. Помечаем, чтобы извлечение не достраивало смысл.
export function toItem(post) {
  const text = post.text || '';
  const truncated = text.length > 200 && !/[.!?)"'’]\s*$/.test(text.trim());
  return {
    id: post.id,
    kind,
    author: post.author?.screen_name || '',
    url: post.url || '',
    ref: '',
    text,
    metrics: {
      likes: post.metrics?.likes ?? 0,
      retweets: post.metrics?.reposts ?? 0,
    },
    truncated,
    collected_at: new Date().toISOString().slice(0, 19),
  };
}

function search(query, limit) {
  const body = JSON.stringify({ query, mode: 'Top', limit });
  const out = execFileSync('curl', [
    '-s', '--noproxy', '*', '--max-time', '120', '-X', 'POST',
    '-H', 'Content-Type: application/json', '-d', body, API,
  ], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  if (parsed.error) throw new Error(`x search failed: ${parsed.error}`);
  return parsed.data?.posts ?? [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function collect({ since, limit = 30 }) {
  const items = [];
  const queries = QUERIES(since);
  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(MIN_INTERVAL_MS);
    for (const post of search(queries[i], limit)) {
      items.push(toItem(post));
    }
  }
  return items.filter(passesEngagement);
}

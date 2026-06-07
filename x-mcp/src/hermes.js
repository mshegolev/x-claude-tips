// Optional Hermes Tweet / Xquik backend for read-only X tools.

const DEFAULT_BASE_URL = 'https://xquik.com';
const DEFAULT_TIMEOUT_MS = 20_000;

export function hermesEnabled() {
  return ['hermes', 'xquik'].includes(String(process.env.X_MCP_BACKEND ?? '').toLowerCase());
}

export function hermesAuthStatus() {
  return {
    backend: 'hermes',
    configured: Boolean(getApiKey()),
    logged_in: Boolean(getApiKey()),
    base_url: getBaseUrl(),
  };
}

export async function searchHermes(query, count, sort = 'Latest') {
  const payload = await requestJson('/x/tweets/search', {
    q: String(query),
    queryType: String(sort || 'Latest'),
    limit: String(clamp(count)),
  });
  return extractTweets(payload).map(normalizeTweet).filter(Boolean).slice(0, clamp(count));
}

export async function userTweetsHermes(username, count) {
  const handle = String(username).replace(/^@+/, '');
  return searchHermes(`from:${handle}`, count, 'Latest');
}

export async function tweetHermes(url) {
  const id = extractTweetId(url);
  if (!id) throw new Error('Hermes Tweet requires a tweet URL or tweet id.');
  const payload = await requestJson(`/x/tweets/${id}`, {});
  const [first] = extractTweets(payload).map(normalizeTweet).filter(Boolean);
  return first ?? null;
}

function getApiKey() {
  return (
    process.env.HERMES_TWEET_API_KEY ??
    process.env.XQUIK_API_KEY ??
    ''
  ).trim();
}

function getBaseUrl() {
  return (
    process.env.HERMES_TWEET_BASE_URL ??
    process.env.XQUIK_BASE_URL ??
    DEFAULT_BASE_URL
  ).replace(/\/+$/, '');
}

function getTimeoutMs() {
  const raw =
    process.env.X_MCP_HERMES_TIMEOUT_MS ??
    process.env.HERMES_TWEET_TIMEOUT_MS ??
    process.env.XQUIK_TIMEOUT_MS ??
    String(DEFAULT_TIMEOUT_MS);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function buildApiUrl(path, params) {
  const base = new URL(`${getBaseUrl()}/`);
  const cleanPath = base.pathname.replace(/\/$/, '');
  const prefix = cleanPath.endsWith('/api/v1') ? '' : '/api/v1';
  base.pathname = `${cleanPath}${prefix}${path}`;
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      base.searchParams.set(key, String(value));
    }
  }
  return base;
}

async function requestJson(path, params) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Set HERMES_TWEET_API_KEY or XQUIK_API_KEY when X_MCP_BACKEND=hermes.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const response = await fetch(buildApiUrl(path, params), {
      headers: authHeaders(apiKey),
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? safeJson(text) : {};
    if (!response.ok) {
      throw new Error(errorMessage(payload, text, response.status));
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Hermes Tweet request timed out after ${getTimeoutMs()}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function authHeaders(apiKey) {
  if (apiKey.startsWith('xq_')) return { 'x-api-key': apiKey };
  return { authorization: `Bearer ${apiKey}` };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function errorMessage(payload, text, status) {
  const message =
    payload?.error?.message ??
    payload?.error ??
    payload?.message;
  return message || text || `Hermes Tweet request failed with HTTP ${status}.`;
}

function extractTweets(payload) {
  if (Array.isArray(payload)) return payload;
  for (const value of [
    payload?.tweets,
    payload?.data?.tweets,
    payload?.data?.items,
    payload?.data?.results,
    payload?.items,
    payload?.results,
  ]) {
    if (Array.isArray(value)) return value;
  }
  for (const value of [payload?.tweet, payload?.data, payload?.result]) {
    if (value && typeof value === 'object') return [value];
  }
  return [];
}

function normalizeTweet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const author = raw.user ?? raw.author ?? raw.account ?? {};
  const handle = normalizeHandle(
    raw.handle ??
      raw.username ??
      raw.screen_name ??
      raw.author_username ??
      author.username ??
      author.screen_name ??
      author.handle,
  );
  const id = String(raw.id ?? raw.tweet_id ?? raw.tweetId ?? raw.rest_id ?? '');
  const permalink =
    raw.permalink ??
    raw.url ??
    raw.tweet_url ??
    raw.link ??
    (handle && id ? `https://x.com/${handle.slice(1)}/status/${id}` : '');

  return {
    text: String(raw.text ?? raw.full_text ?? raw.content ?? raw.body ?? ''),
    created: String(raw.created ?? raw.created_at ?? raw.createdAt ?? raw.timestamp ?? ''),
    permalink: String(permalink ?? ''),
    handle,
    display_name: String(
      raw.display_name ??
        raw.name ??
        raw.author_name ??
        author.display_name ??
        author.name ??
        '',
    ),
    stats: normalizeStats(raw),
  };
}

function normalizeHandle(value) {
  const handle = String(value ?? '').trim().replace(/^@+/, '');
  return handle ? `@${handle}` : '';
}

function normalizeStats(raw) {
  const stats = raw.stats ?? raw.public_metrics ?? raw.metrics ?? {};
  return {
    like: stringifyStat(stats.like ?? stats.likes ?? raw.likes ?? raw.like_count),
    repost: stringifyStat(
      stats.repost ??
        stats.reposts ??
        stats.retweet ??
        stats.retweets ??
        raw.retweets ??
        raw.retweet_count,
    ),
    reply: stringifyStat(stats.reply ?? stats.replies ?? raw.replies ?? raw.reply_count),
    view: stringifyStat(stats.view ?? stats.views ?? raw.views ?? raw.view_count),
    bookmark: stringifyStat(stats.bookmark ?? stats.bookmarks ?? raw.bookmarks),
  };
}

function stringifyStat(value) {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

function extractTweetId(value) {
  const input = String(value ?? '').trim();
  return input.match(/status\/(\d+)/)?.[1] ?? input.match(/^\d+$/)?.[0] ?? '';
}

function clamp(n) {
  const i = Number.parseInt(n, 10);
  if (!Number.isFinite(i)) return 20;
  return Math.max(1, Math.min(100, i));
}

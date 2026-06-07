import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  hermesAuthStatus,
  hermesEnabled,
  searchHermes,
  tweetHermes,
  userTweetsHermes,
} from '../x-mcp/src/hermes.js';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
});

test('hermes backend is opt-in and reports API-key readiness', () => {
  delete process.env.X_MCP_BACKEND;
  delete process.env.HERMES_TWEET_API_KEY;

  assert.equal(hermesEnabled(), false);

  process.env.X_MCP_BACKEND = 'hermes';
  process.env.HERMES_TWEET_API_KEY = 'xq_test';

  assert.equal(hermesEnabled(), true);
  assert.deepEqual(hermesAuthStatus(), {
    backend: 'hermes',
    configured: true,
    logged_in: true,
    base_url: 'https://xquik.com',
  });
});

test('searchHermes calls the Xquik search endpoint and normalizes tweets', async () => {
  process.env.X_MCP_BACKEND = 'hermes';
  process.env.HERMES_TWEET_API_KEY = 'xq_test';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return response({
      tweets: [
        {
          id: '123',
          text: 'Use focused agents.',
          created_at: '2026-06-01T00:00:00Z',
          user: { username: 'alice', name: 'Alice' },
          likes: 12,
          retweets: 3,
          bookmarks: 5,
        },
      ],
    });
  };

  const tweets = await searchHermes('"claude code"', 5, 'Top');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, 'https://xquik.com');
  assert.equal(calls[0].url.pathname, '/api/v1/x/tweets/search');
  assert.equal(calls[0].url.searchParams.get('q'), '"claude code"');
  assert.equal(calls[0].url.searchParams.get('queryType'), 'Top');
  assert.equal(calls[0].url.searchParams.get('limit'), '5');
  assert.deepEqual(calls[0].options.headers, { 'x-api-key': 'xq_test' });
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
  assert.deepEqual(tweets, [
    {
      text: 'Use focused agents.',
      created: '2026-06-01T00:00:00Z',
      permalink: 'https://x.com/alice/status/123',
      handle: '@alice',
      display_name: 'Alice',
      stats: {
        like: '12',
        repost: '3',
        reply: undefined,
        view: undefined,
        bookmark: '5',
      },
    },
  ]);
});

test('userTweetsHermes searches from the requested handle', async () => {
  process.env.X_MCP_BACKEND = 'hermes';
  process.env.HERMES_TWEET_API_KEY = 'xq_test';
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return response({ tweets: [] });
  };

  await userTweetsHermes('@alice', 10);

  assert.equal(requestedUrl.searchParams.get('q'), 'from:alice');
  assert.equal(requestedUrl.searchParams.get('queryType'), 'Latest');
});

test('tweetHermes accepts tweet URLs and bearer-style keys', async () => {
  process.env.X_MCP_BACKEND = 'hermes';
  process.env.HERMES_TWEET_API_KEY = 'plain-token';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return response({ tweet: { id: '123', text: 'Tip', username: 'alice' } });
  };

  const tweet = await tweetHermes('https://x.com/alice/status/123');

  assert.equal(request.url.pathname, '/api/v1/x/tweets/123');
  assert.deepEqual(request.options.headers, { authorization: 'Bearer plain-token' });
  assert.equal(tweet.permalink, 'https://x.com/alice/status/123');
});

function response(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

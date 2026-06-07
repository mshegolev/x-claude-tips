#!/usr/bin/env node
// MCP stdio server for X/Twitter scraping. Exposes 4 tools.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { BrowserSession } from './browser.js';
import {
  hermesAuthStatus,
  hermesEnabled,
  searchHermes,
  tweetHermes,
  userTweetsHermes,
} from './hermes.js';
import { search, userTweets, tweet } from './parser.js';

const log = (...a) => process.stderr.write(`${new Date().toISOString()} server ${a.join(' ')}\n`);

const TOOLS = [
  {
    name: 'x_search',
    description:
      'Search tweets on X (Twitter). Supports operators: "exact phrase", since:YYYY-MM-DD, until:YYYY-MM-DD, min_faves:N, min_retweets:N, from:@user, to:@user, lang:en, -excluded, A OR B.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query with optional operators.' },
        count: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        sort: { type: 'string', enum: ['Latest', 'Top'], default: 'Latest' },
      },
      required: ['query'],
    },
  },
  {
    name: 'x_user_tweets',
    description: "Fetch recent tweets from a user's timeline.",
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'X handle with or without leading @.' },
        count: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['username'],
    },
  },
  {
    name: 'x_tweet',
    description: 'Fetch a single tweet by its URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full tweet URL, e.g. https://x.com/user/status/123...' },
      },
      required: ['url'],
    },
  },
  {
    name: 'x_auth_status',
    description:
      'Check whether the active X backend is ready. Browser mode checks X login; Hermes mode checks API key configuration.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function jsonResult(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

async function withPage(fn) {
  const sess = await BrowserSession.get();
  const page = await sess.newPage();
  try {
    return await fn(sess, page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function handleCall(name, args) {
  switch (name) {
    case 'x_search': {
      const query = String(args.query ?? '');
      const count = clamp(args.count ?? 20);
      const sort = args.sort ?? 'Latest';
      const tweets = hermesEnabled()
        ? await searchHermes(query, count, sort)
        : await withPage((_, page) => search(page, query, count, sort));
      return jsonResult({ query, count: tweets.length, tweets });
    }
    case 'x_user_tweets': {
      const username = String(args.username ?? '');
      const count = clamp(args.count ?? 20);
      const tweets = hermesEnabled()
        ? await userTweetsHermes(username, count)
        : await withPage((_, page) => userTweets(page, username, count));
      return jsonResult({ username, count: tweets.length, tweets });
    }
    case 'x_tweet': {
      const url = String(args.url ?? '');
      const tw = hermesEnabled()
        ? await tweetHermes(url)
        : await withPage((_, page) => tweet(page, url));
      return jsonResult(tw ?? {});
    }
    case 'x_auth_status': {
      if (hermesEnabled()) return jsonResult(hermesAuthStatus());
      const ok = await withPage((sess, page) => sess.isLoggedIn(page));
      return jsonResult({ logged_in: ok });
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function clamp(n) {
  const i = Number.parseInt(n, 10);
  if (!Number.isFinite(i)) return 20;
  return Math.max(1, Math.min(100, i));
}

async function main() {
  const server = new Server(
    { name: 'x-browser', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
      return await handleCall(name, args);
    } catch (e) {
      log(`tool ${name} failed: ${e.stack || e.message}`);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: String(e.message || e) }) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('x-browser MCP ready on stdio');
}

main().catch((e) => {
  log(`fatal: ${e.stack || e.message}`);
  process.exit(1);
});

# x-mcp

Local MCP server for X/Twitter scraping via headless Chromium. Node.js port of the original Python implementation.

Exposes four tools to Claude Code over stdio:

- `x_search(query, count=20, sort="Latest")` — supports Twitter operators (`since:`, `min_faves:`, `lang:`, `"exact"`, `OR`, `from:`, etc.)
- `x_user_tweets(username, count=20)`
- `x_tweet(url)`
- `x_auth_status()`

## Auth

Auth is cookie-based — login flow is intentionally **not** implemented (X blocks it with captcha). Set in `~/.x-creds`:

```bash
export TWITTER_AUTH_TOKEN=...  # auth_token cookie from x.com
export TWITTER_CT0=...         # ct0 cookie from x.com
```

Values come from DevTools → Application → Cookies → `https://x.com` on a logged-in browser session. When `x_auth_status` returns `{"logged_in": false}` they expired — refresh from browser.

## Install

```bash
cd x-mcp
npm install
npx playwright install chromium
```

## Smoke test (CLI, no MCP transport)

```bash
source ~/.x-creds
node src/cli.js auth
node src/cli.js search '"CLAUDE.md" min_faves:500 since:2026-05-01' --count 10
node src/cli.js user elonmusk --count 5
node src/cli.js tweet https://x.com/user/status/1234567890
```

## Register with Claude Code

```bash
claude mcp add x-browser \
  bash -c "source ~/.x-creds && exec node /opt/develop/x-claude-tips/x-mcp/src/server.js"
```

Tools then appear as `mcp__x-browser__x_search`, `mcp__x-browser__x_user_tweets`, `mcp__x-browser__x_tweet`, `mcp__x-browser__x_auth_status`.

## Architecture

Four files in `src/`:

- `server.js` — MCP stdio server (`@modelcontextprotocol/sdk`). Each tool opens a fresh page from the singleton `BrowserSession`, delegates to `parser`, returns JSON.
- `browser.js` — `BrowserSession` singleton. Persistent Chromium context at `~/.config/x-mcp/profile`. Tries real Chrome (`channel: 'chrome'`) first, falls back to bundled chromium. Stealth applied per-page via `addInitScript` (UA / platform / vendor / webdriver overrides).
- `parser.js` — `EXTRACT_JS` runs in the page to pull article fields (text, time, permalink, handle, stats). `scrollAndCollect` deduplicates by permalink, scrolls 4000px/tick, bails after 3 stagnant iterations or 25 max scrolls.
- `cli.js` — Standalone runner: `auth` / `search` / `user` / `tweet` / `import-profile`.

Lifecycle: the MCP server keeps one Chromium alive for the whole process. The CLI tears down on exit.

## Things that bite

- **DOM changes on x.com break the parser silently** — `EXTRACT_JS` relies on `data-testid="tweet"`, `data-testid="tweetText"`, `data-testid="User-Name"`, and aria-label text in English. If selectors change or page loads in another locale, you get `[]` with no error.
- **`count` is clamped to 1–100.** Lazy-loading caps actual yield.
- **`sort` maps to URL `f=live|top`** — anything other than `"Latest"` falls through to `top`.
- **Stealth is per-page.** New page paths must go through `BrowserSession.newPage()` or X will flag the session.

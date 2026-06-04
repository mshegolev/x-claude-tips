# x-claude-tips

A Claude Code skill that mines X (Twitter) for high-signal Claude Code / `CLAUDE.md` / agent / hook / skill tips, deduplicates them into a local rules database, and helps you review and apply them. Ships with a local Node.js MCP server (`x-mcp`) for scraping X via headless Chromium — no official X API call path.

## What it does

1. **Fetch** — pulls fresh, high-engagement tweets about Claude Code via the bundled `x-browser` MCP server and extracts one-line, imperative rule statements from each.
2. **Dedupe** — every rule is hashed, and near-duplicates (Jaccard ≥ 0.7) are flagged for manual merge so the database stays clean across repeated runs.
3. **Review** — surfaces the queue of `review`-status rules sorted by consensus (how many independent tweets mentioned the same thing).
4. **Apply** — proposes concrete diffs to your `CLAUDE.md`, settings, hooks, agents, or skills — never auto-edits.

## Repo layout

Skill files at root (this is what `install.sh` / `update.js` deploys to `~/.claude/skills/x-claude-tips/`). The MCP server lives in `x-mcp/` and is installed separately.

```
x-claude-tips/
├── SKILL.md              # Skill manifest read by Claude Code
├── store.js              # JSONL rule store with dedup + near-dup detection
├── refresh_creds.js      # Multi-browser cookie extractor (Chrome / Firefox / Safari)
├── update.js             # Self-update helper
├── install.sh            # curl | bash installer
├── test/                 # Node test suite
└── x-mcp/                # Local MCP server (Node.js + Playwright)
    ├── src/
    │   ├── server.js     # MCP stdio entry — 4 tools
    │   ├── browser.js    # Singleton Playwright persistent context
    │   ├── parser.js     # DOM extraction + scroll-collect
    │   └── cli.js        # Standalone smoke-test CLI
    ├── package.json
    └── README.md
```

## Install

Requirements: macOS or Linux, Node.js ≥ 22.12, Chrome installed (recommended) or Playwright's bundled Chromium.

### 1. Install the skill

Quick install:

```bash
curl -fsSL https://raw.githubusercontent.com/mshegolev/x-claude-tips/main/install.sh | bash
```

Or manually:

```bash
git clone https://github.com/mshegolev/x-claude-tips.git /opt/develop/x-claude-tips
cd /opt/develop/x-claude-tips
node update.js --target ~/.claude/skills/x-claude-tips
```

### 2. Install the MCP server

```bash
cd /opt/develop/x-claude-tips/x-mcp
npm install
npx playwright install chromium     # optional — only needed if you don't have Chrome
```

### 3. Provide X cookies

Create `~/.x-creds` (chmod 600):

```bash
export TWITTER_AUTH_TOKEN=...  # auth_token cookie from x.com
export TWITTER_CT0=...         # ct0 cookie from x.com
```

Values come from DevTools → Application → Cookies → `https://x.com` on a logged-in browser session. On macOS run `node refresh_creds.js` to extract them from Chrome / Firefox / Safari automatically.

### 4. Register the MCP with Claude Code

```bash
claude mcp add x-browser \
  bash -c "source ~/.x-creds && exec node /opt/develop/x-claude-tips/x-mcp/src/server.js"
```

Tools then appear as `mcp__x-browser__x_search`, `mcp__x-browser__x_user_tweets`, `mcp__x-browser__x_tweet`, `mcp__x-browser__x_auth_status`.

## Usage

In Claude Code:

```
/x-claude-tips fetch 14    # pull recent high-engagement tweets, extract rules
/x-claude-tips review      # walk the review queue
/x-claude-tips apply r_XYZ # apply one rule (asks before any file change)
/x-claude-tips stats       # totals
```

Standalone smoke-test of the MCP (without Claude):

```bash
source ~/.x-creds
node x-mcp/src/cli.js auth
node x-mcp/src/cli.js search '"CLAUDE.md" min_faves:500 since:2026-05-01' --count 10
```

## Auth refresh

When `x_auth_status` returns `{"logged_in": false}` the cookies expired:

```bash
node refresh_creds.js                  # auto-detect: tries Chrome, then Firefox, then Safari
node refresh_creds.js --browser chrome # force one browser
```

macOS only. On Linux: refresh cookies manually from DevTools.

## Knowledge base

User-specific rules and decisions live in `~/.claude/knowledge/x-tips/` (outside this repo). They are intentionally not committed — they're personal usage data.

- `rules.jsonl` — canonical rule store
- `INDEX.md` — human-readable table
- `decisions.jsonl` — audit log of status changes / merges

## Development

```bash
npm test                     # skill tests
cd x-mcp && node src/cli.js  # MCP smoke-test
```

## License

MIT — see [LICENSE](./LICENSE).

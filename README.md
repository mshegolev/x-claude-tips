# x-claude-tips

A Claude Code skill that mines X (Twitter) for high-signal Claude Code / `CLAUDE.md` / agent / hook tips, deduplicates them into a local rules database, and helps you review and apply them.

## What it does

1. **Fetch** — `node collect.js x` drives the local `x-browser-mcp` server over its REST API on `127.0.0.1:18110` to pull fresh, high-engagement tweets about Claude Code, then extracts one-line, imperative rule statements from each.
2. **Dedupe** — every rule is hashed, and near-duplicates (Jaccard ≥ 0.7) are flagged for manual merge so the database stays clean across repeated runs.
3. **Review** — surfaces the queue of `review`-status rules sorted by consensus (how many independent tweets mentioned the same thing).
4. **Apply** — proposes concrete diffs to your `CLAUDE.md`, settings, hooks, agents, or skills — never auto-edits.

## Why

Twitter is the de facto release notes channel for Claude Code tips, but signal-to-noise is bad. This skill mechanically filters for engagement, deduplicates across sources, and turns hype tweets into a structured, auditable knowledge base you actually re-read.

## Install

### Requirements

- macOS (the `refresh_creds.js` helper is macOS-specific; the skill itself works anywhere Claude Code runs)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and working
- **Node.js 20.19+** (uses built-in `node:crypto` and `util.parseArgs` — zero npm dependencies; the branch is developed and tested on 20.19.6)
- The `sqlite3` command-line tool, used by `lib/chrome-cookies.js` to read Chrome's cookie DB (`brew install sqlite` on macOS, or MacPorts' `sqlite3`). `node:sqlite` is deliberately not used — it does not exist on Node 20.
- The `x-browser-mcp` server binary (Go), installed locally so `collect.js` can drive it over REST on `127.0.0.1:18110` — not an MCP server registered in Claude Code
- A logged-in X (Twitter) session in Chrome (`x-session.sh` reads Chrome's cookie DB to seed `x-browser-mcp`'s session; if that fails it falls back to an interactive login in an opened Chrome window)

### Step 1 — Verify Node version

```bash
node --version     # must be >= v20.19.0
sqlite3 --version  # any 3.x
```

If Node is older, install a current LTS via [nvm](https://github.com/nvm-sh/nvm), Homebrew (`brew install node`), or your distro's package manager.

### Step 2 — Install the skill

Quick install:

```bash
curl -fsSL https://raw.githubusercontent.com/mshegolev/x-claude-tips/main/install.sh | bash
```

This clones the repo into a temporary directory, installs the skill into `~/.claude/skills/x-claude-tips`, and keeps your `~/.x-creds` plus `~/.claude/knowledge/x-tips` untouched.

Preview without writing:

```bash
curl -fsSL https://raw.githubusercontent.com/mshegolev/x-claude-tips/main/install.sh | X_CLAUDE_TIPS_DRY_RUN=1 bash
```

Install a specific branch/ref or target directory:

```bash
curl -fsSL https://raw.githubusercontent.com/mshegolev/x-claude-tips/main/install.sh | X_CLAUDE_TIPS_REF=main bash
curl -fsSL https://raw.githubusercontent.com/mshegolev/x-claude-tips/main/install.sh | X_CLAUDE_TIPS_TARGET_DIR=~/.claude/skills/x-claude-tips bash
```

Set the default browser that `refresh_creds.js` reads cookies from. Defaults
to `firefox`; `X_CLAUDE_TIPS_BROWSER` accepts `chrome`, `firefox`, `safari`,
or `auto`. The choice is recorded in `~/.x-creds` (bash-exported each session)
and is still overridable per-run with `--browser`:

```bash
curl -fsSL https://raw.githubusercontent.com/mshegolev/x-claude-tips/main/install.sh | X_CLAUDE_TIPS_BROWSER=chrome bash
```

Manual install from a local clone:

```bash
git clone https://github.com/mshegolev/x-claude-tips.git
cd x-claude-tips
# Skill goes here so Claude Code auto-discovers it on next start
mkdir -p ~/.claude/skills/x-claude-tips
cp -R SKILL.md store.js collect.js migrate-v2.js x-session.sh \
      lib collectors refresh_creds.js update.js install.sh \
      package.json README.md LICENSE \
      ~/.claude/skills/x-claude-tips/
chmod +x ~/.claude/skills/x-claude-tips/store.js \
         ~/.claude/skills/x-claude-tips/collect.js \
         ~/.claude/skills/x-claude-tips/migrate-v2.js \
         ~/.claude/skills/x-claude-tips/x-session.sh \
         ~/.claude/skills/x-claude-tips/refresh_creds.js \
         ~/.claude/skills/x-claude-tips/update.js \
         ~/.claude/skills/x-claude-tips/install.sh
```

No `npm install` needed — the scripts use only Node built-ins.

### Step 3 — The knowledge base

Nothing to do. The repo ships no `knowledge/` directory: `store.js` creates
`~/.claude/knowledge/x-tips/` with empty `rules.jsonl` and `decisions.jsonl`
on the first command that touches the store.

If you are carrying a knowledge base over from a 0.1.x install, copy your own
files into `~/.claude/knowledge/x-tips/` and then run the schema migration —
see "Upgrading from the 0.1.x (Python) version" below.

### Step 4 — Provide X credentials

> **Внимание:** `refresh_creds.js` и `~/.x-creds` относятся к twikit-варианту
> MCP-сервера. Go-сервер `x-browser-mcp`, на который рассчитан текущий
> `collect.js`, переменные `TWITTER_AUTH_TOKEN` / `TWITTER_CT0` не читает —
> он берёт сессию из `x_session_cookies.json` (см. `x-session.sh`).
> Файлы оставлены для совместимости со старой установкой.

**Easier path on macOS:** log in to x.com in Chrome, Firefox, or Safari, then run:

```bash
node ~/.claude/skills/x-claude-tips/refresh_creds.js
```

Firefox is the default (set at install time via `X_CLAUDE_TIPS_BROWSER`, stored
in `~/.x-creds`). To load cookies from another browser for a single run, pass
`--browser`:

```bash
node ~/.claude/skills/x-claude-tips/refresh_creds.js --browser chrome
node ~/.claude/skills/x-claude-tips/refresh_creds.js --browser safari
node ~/.claude/skills/x-claude-tips/refresh_creds.js --browser auto
```

Supported choices are `chrome`, `firefox`, `safari`, and `auto`. `auto` tries Chrome, then Firefox, then Safari.

For Chrome, the helper reads the Chrome cookies SQLite DB, derives the Chrome Safe Storage key from the macOS Keychain (you'll be prompted to allow `security` access once), decrypts the cookies, and writes them into `~/.x-creds`. Firefox reads `cookies.sqlite` from the best matching Firefox profile. Safari reads `Cookies.binarycookies` from Safari's macOS cookie locations. If `~/.x-creds` does not exist yet, the helper creates it from this template first:

```bash
# X (Twitter) credentials for mcp-twikit.
# Chmod 600. Never commit. Values are bash-exported on every Claude Code
# session start when the twikit MCP subprocess spawns.
#
# Fill these in with your THROWAWAY X account (not your main one).
# If you have 2FA enabled, disable it or use a dedicated login session.
export TWITTER_USERNAME=
export TWITTER_EMAIL=
export TWITTER_PASSWORD=

export TWITTER_AUTH_TOKEN=
export TWITTER_CT0=
```

Re-run the helper any time the cookies expire.

For manual setup, create or edit `~/.x-creds` with the same template, fill in the values, then lock down the file:

```bash
chmod 600 ~/.x-creds
```

### Step 5 — Install x-browser-mcp

There is no MCP server to register in Claude Code — `collect.js x` talks to
a local REST service instead. Install the `x-browser-mcp` binary (Go) at
`$XTIPS_SERVER_DIR` (default `~/.config/opencode/tools/x-browser-mcp`; the
binary itself is `x-browser-mcp` inside that directory).

Session bootstrap is fully automatic — `collect.js x` runs `x-session.sh`
as an idempotent preflight before every collection:

1. Confirms Google Chrome is installed at the expected macOS path
   (`ROD_BROWSER_BIN` must point at Chrome — Firefox makes the underlying
   `rod` browser driver fail before any network call).
2. Makes sure the cookie file's directory exists with mode `0700`, and
   migrates an old cookie file if it finds one (see "Where the session
   cookies live" below).
3. Health-checks `http://127.0.0.1:18110/health`; if the server isn't up,
   starts it with `ROD_BROWSER_BIN` set to Chrome, `X_BROWSER_PROXY` taken
   from `$HTTPS_PROXY`, `-user-data-dir ""` — the empty user-data-dir is
   what puts the server into cookie mode (a non-empty value makes it ignore
   the cookie file) — and `-cookies <path>` so the server reads exactly the
   file the preflight writes.
4. Reads `session_file` from `/api/v1/login/status` and compares it with
   that path. `/health` answers `"ok":true` for a server in profile mode or
   on an older cookie path too, and such a server silently ignores the
   cookies we write — so on a mismatch the preflight says what was wrong on
   stderr, stops the process listening on port 18110, and starts a correctly
   configured one.
5. Checks `/api/v1/login/status` for `"state":"ready"`. If it's already
   ready, nothing further happens.
6. If not ready, imports cookies from your live, logged-in Chrome profile
   via `lib/chrome-cookies.js` into the cookie file, then re-checks status.
7. Only if that import doesn't produce a ready session does it fall back to
   an interactive login: it calls `/api/v1/login/start`, which opens a
   Chrome window for you to log into X in. Close that window, then re-run
   `collect.js`. This is the one case where the preflight exits non-zero
   (code 2) and needs you to act before continuing.

#### Where the session cookies live

The cookie file holds a live X session — anyone who reads it is logged in as
you. It is written to `~/.config/x-claude-tips/x_session_cookies.json`
(directory `0700`, file `0600`), deliberately **outside every git working
tree**: it used to sit next to the server binary in `$XTIPS_SERVER_DIR`,
whose `.gitignore` does not cover it, so a single `git add -A` there would
have committed your account credentials. If the preflight still finds a file
at the old location it *moves* it to the new path — a move, not a copy, so
nothing is left behind. Override the path with `XTIPS_COOKIES` if you need
to; keep it out of a repository.

### Step 6 — Verify

```bash
node ~/.claude/skills/x-claude-tips/store.js stats
```

Should print totals (zero if you skipped step 3). Then, inside Claude Code:

```
/x-claude-tips stats
```

Should produce the same output. You're set.

## Update

From a local clone:

```bash
git pull
node update.js
```

The updater copies the installable files into `~/.claude/skills/x-claude-tips`, creates a sibling backup such as `~/.claude/skills/x-claude-tips.backup-2026-06-03T10-00-00-000Z`, and leaves `~/.x-creds` plus `~/.claude/knowledge/x-tips` untouched.

Preview without writing:

```bash
node update.js --dry-run
```

If you only have the installed skill and no local clone, update from GitHub:

```bash
node ~/.claude/skills/x-claude-tips/update.js --from-git
```

Useful options:

```bash
node update.js --source /path/to/x-claude-tips --target ~/.claude/skills/x-claude-tips
node ~/.claude/skills/x-claude-tips/update.js --from-git --ref main
```

## Usage

Inside Claude Code:

```
/x-claude-tips fetch 14         # pull tweets from last 14 days
/x-claude-tips review           # walk the review queue
/x-claude-tips show r_0008      # inspect one rule
/x-claude-tips apply r_0008     # propose diff to CLAUDE.md / settings / etc.
/x-claude-tips status r_0008 adopted --note "where it landed"
/x-claude-tips index            # regenerate INDEX.md
/x-claude-tips stats            # totals by status / target
```

Or use the `store.js` CLI directly:

```bash
node ~/.claude/skills/x-claude-tips/store.js list --status review
node ~/.claude/skills/x-claude-tips/store.js show r_0008
node ~/.claude/skills/x-claude-tips/store.js status r_0008 adopted --note "applied to ~/.claude/CLAUDE.md"
```

## Knowledge base

Files in `~/.claude/knowledge/x-tips/`:

| File | Purpose |
| --- | --- |
| `rules.jsonl` | Canonical store, one JSON record per rule |
| `INDEX.md` | Human-readable table, regenerated by `store.js index` |
| `decisions.jsonl` | Append-only audit log of status changes / merges |
| `sources/<tweet_id>.json` | Optional raw tweet snapshots |

Each rule has a `target` classifier (`CLAUDE.md`, `agent`, `hook`, `settings`, `slash`, `workflow`, `mcp`, `other`) and a `status` (`review` → `adopted` / `rejected` / `removed`).

These files are yours alone — the repo ships no knowledge base of its own, and
neither `install.sh` nor `update.js` writes into this directory.

## Hard rules

- Never copy full tweet bodies into the DB. Only the extracted rule line + metadata + source URL.
- Never auto-apply rules to `CLAUDE.md` / settings / agents. Always show a diff and ask first.
- Keep rule text terse and imperative. No "I think", no emojis, no hashtags.
- Dedup is the point: running `fetch` twice over the same window does not create duplicates. A source already on a rule is a no-op; a new distinct source raises that rule's `consensus`. (`seen` was a 0.1.x field and was removed by the v2 migration — `consensus` replaced it.)

## Legacy scripts

These ship alongside the skill from the opencode-fork consolidation but are
not part of the `collect.js` flow and need updating before use — see the
header comment in each file for the specific breakage:

| Script | Status |
| --- | --- |
| `add_opencode_tips.js` | Targets the pre-v2 `store.js` schema; its `--bookmarks` flag is rejected by the current `store.js add`. |
| `generate_qwen_rules.js` | Parses `INDEX.md` by column index; `parts[4]` used to be `likes`, is now `target`. |
| `diagnose.sh` | Starts `x-browser-mcp` with `ROD_BROWSER_BIN` pointing at Firefox, which `x-session.sh` documents as fatal. |

## Upgrading from the 0.1.x (Python) version

0.1.x shipped `store.py` and `refresh_creds.py`. 0.2.0 replaces them with Node.js equivalents and drops the `cryptography` dependency.

**The `rules.jsonl` record shape changed.** Rule hashes, IDs, `text`, `target` and `status` are stable, but v2 gives every source a `kind` and a `metrics` object, derives `authority` / `consensus` / `kinds` per rule, and drops the `seen` and `bookmarks_max` fields. Existing data is **not** byte-compatible; run the one-shot, idempotent migration below (step 4), which writes a timestamped `.bak-` backup next to your store before touching it.

```bash
# 1. Remove the old Python scripts
rm ~/.claude/skills/x-claude-tips/store.py \
   ~/.claude/skills/x-claude-tips/refresh_creds.py

# 2. (optional) Uninstall the now-unneeded cryptography package
pip3 uninstall cryptography

# 3. Install the new files (from a fresh clone of this repo)
cp -R SKILL.md store.js collect.js migrate-v2.js x-session.sh \
      lib collectors refresh_creds.js update.js install.sh \
      package.json README.md LICENSE \
      ~/.claude/skills/x-claude-tips/
chmod +x ~/.claude/skills/x-claude-tips/store.js \
         ~/.claude/skills/x-claude-tips/collect.js \
         ~/.claude/skills/x-claude-tips/migrate-v2.js \
         ~/.claude/skills/x-claude-tips/x-session.sh \
         ~/.claude/skills/x-claude-tips/refresh_creds.js \
         ~/.claude/skills/x-claude-tips/update.js \
         ~/.claude/skills/x-claude-tips/install.sh

# 4. Migrate rules.jsonl to the v2 record shape (idempotent, backs up first)
node ~/.claude/skills/x-claude-tips/migrate-v2.js

# 5. Restart Claude Code so the updated SKILL.md is picked up.
```

Known cosmetic differences vs the Python version (functionally identical):

- `decisions.jsonl` lines and `store.js stats` output use compact JSON (`{"a":1}`) instead of Python's spaced form (`{"a": 1}`). Both parse identically.
- Error messages on bad CLI input phrase things differently from `argparse`. Exit codes match: `2` for usage/SIMILAR, `1` for "not found", `0` on success.

## License

MIT — see `LICENSE`.

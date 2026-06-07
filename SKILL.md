---
name: x-claude-tips
description: Mine X/Twitter for high-signal Claude Code / CLAUDE.md / agent / hook tips via mcp__x-browser__, dedupe into a rules DB, and help the user review/apply them. Use when the user says "search X for claude tips", "find new CLAUDE.md ideas", "/x-claude-tips", or asks to update claude tips knowledge base.
argument-hint: "fetch [days] | review | show <id> | apply <id> | status <id> <state> | index | stats | update"
---

# x-claude-tips

Mine X (Twitter) for actionable Claude Code improvements. Deduplicate across sources. Track `seen` count and engagement max. Only concrete rules, no fluff.

## Knowledge base layout

- `~/.claude/knowledge/x-tips/rules.jsonl` — canonical rule store (one JSON per line)
- `~/.claude/knowledge/x-tips/INDEX.md` — human table, regenerated
- `~/.claude/knowledge/x-tips/decisions.jsonl` — audit log of status changes / merges
- `~/.claude/knowledge/x-tips/sources/<tweet_id>.json` — raw tweet snapshot (optional)

## Store CLI

All DB ops go through `store.js` colocated with this skill at
`~/.claude/skills/x-claude-tips/store.js`. Run with
`node ~/.claude/skills/x-claude-tips/store.js <subcmd>`.

Subcommands: `add`, `merge`, `list`, `show`, `status`, `index`, `stats`. Run `... store.js <subcmd> --help` if unsure.

## Update CLI

Installed skill updates go through `update.js` colocated with this skill at
`~/.claude/skills/x-claude-tips/update.js`.

Common paths:

```bash
# from a local repo clone after git pull
node update.js

# from the installed skill without a local clone
node ~/.claude/skills/x-claude-tips/update.js --from-git

# preview
node ~/.claude/skills/x-claude-tips/update.js --from-git --dry-run
```

The updater copies only installable skill files, creates a sibling backup of the installed directory, and does not touch `~/.x-creds` or `~/.claude/knowledge/x-tips`.

## Subcommand: fetch [days=14]

Goal: pull fresh high-engagement tweets, extract concrete rule lines, store with dedup.

### Steps

1. Call `mcp__x-browser__x_auth_status`. If it returns `{"backend":"hermes"}`, continue when `configured` is true; otherwise tell the user to set `HERMES_TWEET_API_KEY` or `XQUIK_API_KEY` in the MCP launch environment. In browser mode, if not logged in, tell the user to refresh `~/.x-creds` (run `node ~/.claude/skills/x-claude-tips/refresh_creds.js`; it creates a fill-in template if `~/.x-creds` is missing). If the user logged in through a non-default browser, pass `--browser firefox`, `--browser safari`, or `--browser auto`. Stop after giving the refresh instruction.

2. Compute `since = today - days` (default 14). Run `mcp__x-browser__x_search` with `sort="Top"` for each query below. Cap `count=30`. Replace `<SINCE>` with the iso date.

   - `"CLAUDE.md" min_faves:500 since:<SINCE> lang:en`
   - `"claude code" (subagent OR agent) min_faves:500 since:<SINCE> lang:en`
   - `"claude code" (hook OR skill OR "slash command") min_faves:500 since:<SINCE> lang:en`
   - `"claude code" (tip OR trick OR workflow OR config) min_faves:1000 since:<SINCE> lang:en`
   - `from:AnthropicAI claude code since:<SINCE>` (no min_faves — staff signal)
   - `from:alexalbert__ OR from:_catwu OR from:sauers_ claude since:<SINCE>` (known practitioners)

3. For each returned tweet, apply the **engagement filter**:
   - keep if `likes >= 1000` OR `retweets >= 150` OR `bookmarks >= 300`
   - for Anthropic staff / known practitioners: keep if `likes >= 200`
   - skip if no concrete instruction (pure hype, screenshots only, announcements)

4. For each kept tweet, **extract rule lines** — one concrete, self-contained instruction per rule. No fluff, no "I think", no "maybe". Rewrite in imperative if needed but keep as close to the source as possible. Examples:
   - Tweet: "pro tip — always add `/clear` between unrelated tasks, context stays fresh" → rule: `Use /clear between unrelated tasks to keep context fresh.`
   - Tweet: "put your agent invocation rules in CLAUDE.md not in prompts" → rule: `Put agent invocation rules in CLAUDE.md, not in individual prompts.`
   - Thread with 5 bullets → 5 separate rules.

5. Classify `target` for each rule (pick one):
   - `CLAUDE.md` — text for a CLAUDE.md file (conventions, behavior rules)
   - `agent` — subagent design / when-to-spawn rule
   - `hook` — PreToolUse / PostToolUse / Stop hooks
   - `settings` — settings.json fields, permissions, env vars
   - `slash` — slash command / skill design
   - `workflow` — human workflow tip (when to /clear, how to structure sessions)
   - `mcp` — MCP server config or usage
   - `other`

6. For each rule call:
   ```
   node ~/.claude/skills/x-claude-tips/store.js add \
     --text "<rule line>" \
     --target <target> \
     --source <tweet_id_or_permalink_tail> \
     --author <handle> \
     --url <tweet_url> \
     --likes <N> --retweets <N> --bookmarks <N>
   ```
   The store returns `NEW r_XXXX` / `DUPE r_XXXX seen=N` / exits with `SIMILAR r_XXXX(0.xx)` on stderr (code 2) if near-duplicate.

7. On `SIMILAR`: show the user both texts (`store.js show <existing>` vs. the new one) and ask: merge (variant), add separately (`--force`), or skip. Default action: show, don't auto-decide.

8. After the loop, run `store.js index` to regenerate `INDEX.md` and `store.js stats` to print totals. Report to user: `N new / M dupes-incremented / K similar-pending`.

### Engagement threshold rationale

10k likes is too strict — filters out ~90% of useful Claude Code tips (audience is relatively small). Defaults are chosen so that a tweet with genuine adoption signal passes:

- `likes >= 1000` = clear resonance
- `bookmarks >= 300` = "I want to apply this" (strongest signal for actionable content)
- `retweets >= 150` = amplification
- Lower bar for Anthropic staff / repeat practitioners (trusted source)

The user can override per-run: `fetch 30 --min-likes 2000` etc. (extend search queries accordingly).

## Subcommand: review

Show the review queue, prioritized by consensus:

```
node ~/.claude/skills/x-claude-tips/store.js list --status review --min-seen 1 --limit 40
```

Then present to the user as a numbered list sorted by `seen` desc. For each entry under review, the user decides `adopt` / `reject` / `skip`. On decision:
- adopt: `store.js status <id> adopted --note "<where applied>"`
- reject: `store.js status <id> rejected --note "<reason>"`

Do not auto-apply — always ask user before changing `CLAUDE.md` / settings / creating agents.

## Subcommand: show <id>

`node ~/.claude/skills/x-claude-tips/store.js show <id>` — full record incl. sources.

## Subcommand: apply <id>

Load the rule with `store.js show <id>`. Based on `target`:
- `CLAUDE.md`: propose an edit to `~/.claude/CLAUDE.md` or project `CLAUDE.md` (ask user which). Show diff before writing.
- `settings`: invoke the `update-config` skill.
- `hook`: invoke `update-config` to write the hook entry.
- `agent`: propose a new file under `~/.claude/agents/` or project `.claude/agents/`.
- `slash`: propose a new skill dir under `~/.claude/skills/<name>/`.
- `workflow`: explain the workflow — no file change — and mark `adopted` with a note.
- `mcp` / `other`: explain, ask the user how to integrate.

After the user confirms the change, set status `adopted` with a `--note` pointing at the target file / line.

## Subcommand: status <id> <state>

Pass-through to `store.js status`. States: `review`, `adopted`, `rejected`, `removed`.

## Subcommand: index

`store.js index` — regenerate `INDEX.md`.

## Subcommand: stats

`store.js stats` — totals by status and target.

## Subcommand: prune

Find rules in the current global `~/.claude/CLAUDE.md` that correspond to `rejected` or `removed` entries in the DB and propose deletions. Heuristic: for each `rejected`/`removed` rule, grep `~/.claude/CLAUDE.md` for overlapping tokens (≥ 60% Jaccard). Show matches to the user, never delete without confirmation.

## Hard rules

- Never copy full tweet bodies into the DB. Only the extracted rule line + metadata + source link.
- Never auto-apply rules to `CLAUDE.md` / settings / agents. Always show diff, ask user.
- When `store.js add` prints `SIMILAR`, always surface to user; never silently `--force`.
- Keep rule text terse and imperative. No "I think", no emojis, no hashtags.
- Deduplication is the point: running `fetch` twice over the same window must increment `seen` on existing rules, not create duplicates.

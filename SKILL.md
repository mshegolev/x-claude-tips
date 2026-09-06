---
name: x-claude-tips
description: Mine X/Twitter for high-signal Claude Code / CLAUDE.md / agent / hook tips via `node collect.js x`, dedupe into a multi-source rules DB, and help the user review/apply them. Use when the user says "search X for claude tips", "find new CLAUDE.md ideas", "/x-claude-tips", or asks to update claude tips knowledge base.
argument-hint: "fetch [days] | review | show <id> | apply <id> | status <id> <state> | index | stats | update"
---

# x-claude-tips

Mine X (Twitter) for actionable Claude Code improvements. Deduplicate across sources. Track `consensus` (distinct-source count) and engagement max. Only concrete rules, no fluff.

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

1. Выбери источник и запусти коллектор (путь абсолютный: скилл
   работает с cwd пользовательского проекта):
   - `node ~/.claude/skills/x-claude-tips/collect.js docs` — официальная
     документация Claude Code (tier 3). Список страниц — в
     `collectors/sources.json`, пополняется вручную по индексу
     https://code.claude.com/docs/llms.txt.
   - `node ~/.claude/skills/x-claude-tips/collect.js changelog` — релизы
     Claude Code (tier 3), источник — CHANGELOG.md на GitHub. Диф против
     прошлого прогона: уже виденные версии повторно не стейджатся, поэтому
     второй запуск подряд штатно даёт `collected 0`.
   - `node ~/.claude/skills/x-claude-tips/collect.js x --days <days>` — X
     (tier 1, по умолчанию 14 дней). Раннер сам поднимет сервер, подложит
     куки и отработает лимиты; отдельно проверять авторизацию не нужно.
     Ненулевой код возврата означает, что нужен интерактивный логин —
     сообщение скажет, что делать, и на этом остановись.

   Префлайт сессии нужен только источнику `x`; `docs` и `changelog` ходят
   в сеть напрямую, без прокси и без браузера.

   У `docs` и `changelog` шумовой фильтр отключён (`useNoiseFilter = false`):
   его правила писались под X и на документации дают ложные срабатывания —
   короткая секция ушла бы как `link-only`, «Introducing …» как
   `announcement`. Поэтому у этих источников `dropped` всегда пуст.

2. Прочитай свежий файл стейджинга из
   `~/.claude/knowledge/x-tips/staging/x/<run-id>.json`. Поля:
   - `collected` — сколько постов пришло от коллектора ДО любых фильтров;
   - `items` — прошедшее оба фильтра;
   - `dropped` — отброшенное, по записи `{id, reason, author, text}` на
     каждый пост. `text` лежит здесь именно для того, чтобы аудит фильтра
     не требовал повторного запроса к X. Причины: `engagement` (не добрал
     порог вовлечённости), `bait`, `listicle`, `announcement`, `link-only`,
     `clone`;
   - `errors` — список `{query, error}`.

   `collected` = `items` + `dropped`, сходится всегда. Просмотри `dropped`
   на ложные срабатывания (текст рядом — читать можно прямо там) и скажи о
   них пользователю. Если `errors` непустой, скажи, какие запросы не
   отработали — сбор продолжился и всё равно застейджил то, что собрал по
   остальным.

3. Из `items` извлеки правила. Для записей с `truncated: true` не достраивай
   смысл за обрывом текста: правило либо выводится из уцелевшей части, либо
   не выводится. Одно правило — одна конкретная, самодостаточная инструкция.
   Без воды, без "I think", без "maybe". Формулируй в императиве, но держись
   как можно ближе к источнику. Примеры:
   - Tweet: "pro tip — always add `/clear` between unrelated tasks, context stays fresh" → rule: `Use /clear between unrelated tasks to keep context fresh.`
   - Tweet: "put your agent invocation rules in CLAUDE.md not in prompts" → rule: `Put agent invocation rules in CLAUDE.md, not in individual prompts.`
   - Thread with 5 bullets → 5 separate rules.

4. Classify `target` for each rule (pick one):
   - `CLAUDE.md` — text for a CLAUDE.md file (conventions, behavior rules)
   - `agent` — subagent design / when-to-spawn rule
   - `hook` — PreToolUse / PostToolUse / Stop hooks
   - `settings` — settings.json fields, permissions, env vars
   - `slash` — slash command / skill design
   - `workflow` — human workflow tip (when to /clear, how to structure sessions)
   - `mcp` — MCP server config or usage
   - `other`

5. For each rule call:
   ```
   node ~/.claude/skills/x-claude-tips/store.js add \
     --text "<rule line>" \
     --target <target> \
     --source <tweet_id_or_permalink_tail> \
     --author <handle> \
     --url <tweet_url> \
     --likes <N> --retweets <N> \
     --kind x \
     --collected-at <collected_at элемента из стейджинга>
   ```
   Для источников `docs` и `changelog` метрик вовлечённости нет, поэтому
   `--likes` / `--retweets` не передавай, а `--ref` обязателен — он отличает
   секции одной страницы друг от друга:

   ```
   node ~/.claude/skills/x-claude-tips/store.js add \
     --text "<rule line>" \
     --target <target> \
     --kind docs \
     --ref "<заголовок секции>" \
     --source <id элемента из стейджинга> \
     --url <url страницы> \
     --author anthropic \
     --collected-at <collected_at элемента из стейджинга>
   ```

   `--collected-at` передавай всегда: без него источник получит сегодняшнюю
   дату, а не дату прогона (правило, извлечённое наутро, записало бы чужой
   день). `--kind` принимает только `docs`, `changelog`, `lessons`,
   `github`, `x`.

   The store returns `NEW r_XXXX` / `DUPE r_XXXX consensus=N` / exits with `SIMILAR r_XXXX(0.xx)` on stderr (code 2) if near-duplicate.

6. On `SIMILAR`: show the user both texts (`store.js show <existing>` vs. the new one) and ask: merge (variant), add separately (`--force`), or skip. Default action: show, don't auto-decide.

7. After the loop, run `store.js index` to regenerate `INDEX.md` and `store.js stats` to print totals. Report to user: `N new / M dupes-incremented / K similar-pending`.

### Engagement threshold rationale

`collect.js` applies the engagement threshold (`passesEngagement`, exported
from `collectors/x.js`) as the first of two filters, and records every
rejection in `dropped` with reason `engagement` — the collector itself no
longer drops anything silently, so the threshold can be retuned from a
staging file without re-querying X:

- `likes >= 1000` OR `retweets >= 150` = clear resonance / amplification
- `likes >= 200` for Anthropic staff and named practitioners (trusted source, lower bar)
- `bookmarks` is not a threshold input — the server this collector talks to never returns that metric

There is no per-run threshold override; adjust the window instead with
`--since YYYY-MM-DD` / `--days N`, or pass `--no-filter` to skip BOTH the
engagement filter and the noise filter and stage everything the collector
returned.

## Subcommand: review

Show the review queue, prioritized by consensus:

```
node ~/.claude/skills/x-claude-tips/store.js list --status review --min-consensus 1 --limit 40
```

(`--min-seen` is accepted as an alias for `--min-consensus`.) The list is already sorted by `authority` desc, then `consensus` desc, then `likes_max` desc — present it to the user in that order. For each entry under review, the user decides `adopt` / `reject` / `skip`. On decision:
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
- Deduplication is the point: running `fetch` twice over the same window must not create duplicate rules — a repeated source is a no-op `DUPE (source already present)`, a new distinct source on an existing rule bumps its `consensus`.

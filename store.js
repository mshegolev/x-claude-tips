#!/usr/bin/env node
// JSONL store for x-tips rules with dedup + near-dup detection.

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { makeSource, deriveRuleFields } from './lib/schema.js';

const BASE = process.env.XTIPS_BASE || join(homedir(), '.claude/knowledge/x-tips');
const RULES = join(BASE, 'rules.jsonl');
const INDEX = join(BASE, 'INDEX.md');
const DECISIONS = join(BASE, 'decisions.jsonl');
const SOURCES_DIR = join(BASE, 'sources');

const TARGETS = ['CLAUDE.md', 'agent', 'hook', 'settings', 'slash', 'workflow', 'mcp', 'other'];
const STATUSES = ['review', 'adopted', 'rejected', 'removed'];

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'is', 'are', 'be', 'so', 'that',
  'for', 'at', 'with', 'by', 'and', 'or', 'not', 'if', 'it', 'this', 'these',
  'those', 'its', 'from', 'as', 'into', 'than', 'then', 'when', 'while',
  'but', 'also', 'may', 'can', 'will', 'shall', 'should', 'would', 'do',
  'does', 'has', 'have', 'had', 'you', 'your', 'we', 'our', 'i', 'my',
  'just', 'always', 'every', 'any', 'some', 'all', 'such', 'no', 'yes',
  'them', 'they', 'he', 'she', 'his', 'her', 'me', 'us',
]);

const SIMILARITY_THRESHOLD = 0.7;

function ensureDirs() {
  mkdirSync(BASE, { recursive: true });
  mkdirSync(SOURCES_DIR, { recursive: true });
  for (const p of [RULES, DECISIONS]) {
    if (!existsSync(p)) writeFileSync(p, '');
  }
}

function normalize(text) {
  let t = String(text).toLowerCase().trim();
  t = t.replace(/[`'"\u2018\u2019\u201c\u201d]/g, '');
  t = t.replace(/[^\w\s]/g, ' ');
  t = t.replace(/\s+/g, ' ');
  return t.trim();
}

function hashKey(text) {
  return createHash('sha1').update(normalize(text)).digest('hex').slice(0, 12);
}

function tokens(text) {
  const out = new Set();
  for (const t of normalize(text).split(' ')) {
    if (t && !STOP_WORDS.has(t) && t.length > 1) out.add(t);
  }
  return out;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function loadRules() {
  ensureDirs();
  const text = readFileSync(RULES, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s) out.push(JSON.parse(s));
  }
  return out;
}

function saveRules(rules) {
  const tmp = RULES + '.tmp';
  const body = rules.map((r) => JSON.stringify(r)).join('\n') + (rules.length ? '\n' : '');
  writeFileSync(tmp, body);
  renameSync(tmp, RULES);
}

function nextId(rules) {
  let max = 0;
  for (const r of rules) {
    if (typeof r.id === 'string' && r.id.startsWith('r_')) {
      const n = parseInt(r.id.split('_')[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return 'r_' + String(max + 1).padStart(4, '0');
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function die(msg, code = 1) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

// ---- subcommands ----

function cmdAdd(opts) {
  const rules = loadRules();
  const key = hashKey(opts.text);
  const date = today();
  const kind = opts.kind || 'x';
  const source = makeSource({
    id: opts.source,
    kind,
    author: opts.author || '',
    url: opts.url || '',
    ref: opts.ref || '',
    metrics: kind === 'x'
      ? { likes: opts.likes | 0, retweets: opts.retweets | 0 }
      : null,
    collectedAt: date,
  });

  for (const r of rules) {
    if (r.hash === key) {
      const existingIds = r.sources.map((s) => s.id);
      if (opts.source && !existingIds.includes(opts.source)) {
        r.sources.push(source);
        Object.assign(r, deriveRuleFields(r.sources));
        r.last_seen = date;
        r.likes_max = Math.max(r.likes_max || 0, source.metrics?.likes || 0);
        r.retweets_max = Math.max(r.retweets_max || 0, source.metrics?.retweets || 0);
        saveRules(rules);
        console.log(`DUPE ${r.id} consensus=${r.consensus}`);
      } else {
        console.log(`DUPE ${r.id} consensus=${r.consensus} (source already present)`);
      }
      return;
    }
  }

  const newToks = tokens(opts.text);
  const similar = [];
  for (const r of rules) {
    const sim = jaccard(newToks, tokens(r.text));
    if (sim >= SIMILARITY_THRESHOLD) similar.push([r.id, sim]);
  }
  if (similar.length && !opts.force) {
    die('SIMILAR ' + similar.map(([i, s]) => `${i}(${s.toFixed(2)})`).join(', ')
      + " -- rerun with --force to add anyway, or use 'merge'", 2);
  }

  const rid = nextId(rules);
  const rule = {
    id: rid,
    hash: key,
    text: opts.text,
    target: opts.target,
    status: 'review',
    sources: [source],
    ...deriveRuleFields([source]),
    first_seen: date,
    last_seen: date,
    likes_max: source.metrics?.likes || 0,
    retweets_max: source.metrics?.retweets || 0,
  };
  if (similar.length) rule.similar_to = similar.map(([i]) => i);
  rules.push(rule);
  saveRules(rules);
  console.log(`NEW ${rid}`);
}

function cmdMerge(opts) {
  const rules = loadRules();
  const src = rules.find((r) => r.id === opts.src);
  const dst = rules.find((r) => r.id === opts.dst);
  if (!src || !dst) die('src or dst not found');
  const seenIds = new Set(dst.sources.map((s) => s.id));
  for (const s of src.sources) {
    if (!seenIds.has(s.id)) dst.sources.push(s);
  }
  Object.assign(dst, deriveRuleFields(dst.sources));
  dst.likes_max = Math.max(dst.likes_max || 0, src.likes_max || 0);
  dst.retweets_max = Math.max(dst.retweets_max || 0, src.retweets_max || 0);
  if (!dst.variants) dst.variants = [];
  dst.variants.push(src.text);
  dst.last_seen = (dst.last_seen || '') > (src.last_seen || '') ? dst.last_seen : src.last_seen;
  const remaining = rules.filter((r) => r.id !== opts.src);
  saveRules(remaining);
  appendFileSync(
    DECISIONS,
    JSON.stringify({ ts: nowIso(), action: 'merge', src: opts.src, dst: opts.dst }) + '\n',
  );
  console.log(`merged ${opts.src} -> ${opts.dst} (consensus=${dst.consensus})`);
}

function cmdList(opts) {
  let rules = loadRules();
  if (opts.status) rules = rules.filter((r) => r.status === opts.status);
  if (opts.target) rules = rules.filter((r) => r.target === opts.target);
  if (opts.minConsensus) rules = rules.filter((r) => r.consensus >= opts.minConsensus);
  rules.sort((a, b) =>
    (b.authority - a.authority)
    || (b.consensus - a.consensus)
    || ((b.likes_max || 0) - (a.likes_max || 0)));
  if (opts.limit) rules = rules.slice(0, opts.limit);
  if (opts.json) {
    console.log(JSON.stringify(rules, null, 2));
    return;
  }
  if (rules.length === 0) {
    console.log('(no rules match)');
    return;
  }
  const pl = (s, n) => String(s).padStart(n);
  const pr = (s, n) => String(s).padEnd(n);
  console.log(`${pl('auth', 4)} ${pl('cons', 4)} ${pr('status', 8)} ${pr('target', 10)} ${pr('kinds', 12)} ${pr('id', 7)} text`);
  for (const r of rules) {
    const text = r.text.length <= 66 ? r.text : r.text.slice(0, 63) + '...';
    console.log(
      `${pl(r.authority, 4)} ${pl(r.consensus, 4)} ${pr(r.status, 8)} ${pr(r.target, 10)} ${pr((r.kinds || []).join(','), 12)} ${pr(r.id, 7)} ${text}`,
    );
  }
}

function cmdShow(opts) {
  const rules = loadRules();
  const r = rules.find((x) => x.id === opts.id);
  if (!r) die(`not found: ${opts.id}`);
  console.log(JSON.stringify(r, null, 2));
}

function cmdStatus(opts) {
  const rules = loadRules();
  const r = rules.find((x) => x.id === opts.id);
  if (!r) die(`not found: ${opts.id}`);
  const old = r.status;
  r.status = opts.newStatus;
  saveRules(rules);
  appendFileSync(
    DECISIONS,
    JSON.stringify({
      ts: nowIso(),
      action: 'status',
      id: opts.id,
      from: old,
      to: opts.newStatus,
      note: opts.note || '',
    }) + '\n',
  );
  console.log(`${opts.id}: ${old} -> ${opts.newStatus}`);
}

function cmdIndex() {
  const rules = loadRules();
  rules.sort((a, b) =>
    (b.authority - a.authority)
    || (b.consensus - a.consensus)
    || ((b.likes_max || 0) - (a.likes_max || 0)));
  const now = nowIso();
  const header = [
    '# X-Tips Knowledge Index',
    '',
    `_Regenerated: ${now} — ${rules.length} rules_`,
    '',
    'Sort: authority desc, consensus desc, likes desc. `authority 3` = официальный источник.',
    '',
    '| auth | cons | status | target | kinds | id | rule |',
    '|-----:|-----:|--------|--------|-------|----|------|',
  ];
  const rows = [];
  for (const r of rules) {
    let text = r.text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    if (text.length > 110) text = text.slice(0, 107) + '...';
    rows.push(
      `| ${r.authority} | ${r.consensus} | ${r.status} | ${r.target} | ${(r.kinds || []).join(',')} | ${r.id} | ${text} |`,
    );
  }
  mkdirSync(dirname(INDEX), { recursive: true });
  writeFileSync(INDEX, header.concat(rows).join('\n') + '\n');
  console.log(`wrote ${INDEX} (${rules.length} rules)`);
}

function cmdStats() {
  const rules = loadRules();
  const byStatus = {};
  const byTarget = {};
  for (const r of rules) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byTarget[r.target] = (byTarget[r.target] || 0) + 1;
  }
  console.log(`total: ${rules.length}`);
  console.log('by status:', JSON.stringify(byStatus));
  console.log('by target:', JSON.stringify(byTarget));
}

// ---- dispatcher ----

function requireOne(val, name) {
  if (val == null || val === '') die(`store.js: error: the following arguments are required: --${name}`, 2);
  return val;
}

function checkChoice(val, name, choices) {
  if (val != null && !choices.includes(val)) {
    die(`store.js: error: argument --${name}: invalid choice: '${val}' (choose from ${choices.map((c) => `'${c}'`).join(', ')})`, 2);
  }
}

function intOpt(v, def = 0) {
  if (v == null) return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function dispatch(argv) {
  const cmd = argv[2];
  const rest = argv.slice(3);

  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log('usage: store.js {add,merge,list,show,status,index,stats} ...');
    process.exit(cmd ? 0 : 2);
  }

  switch (cmd) {
    case 'add': {
      const { values } = parseArgs({
        args: rest,
        options: {
          text: { type: 'string' },
          target: { type: 'string', default: 'other' },
          source: { type: 'string' },
          author: { type: 'string', default: '' },
          url: { type: 'string', default: '' },
          likes: { type: 'string', default: '0' },
          retweets: { type: 'string', default: '0' },
          kind: { type: 'string', default: 'x' },
          ref: { type: 'string', default: '' },
          force: { type: 'boolean', default: false },
        },
        strict: true,
      });
      requireOne(values.text, 'text');
      requireOne(values.source, 'source');
      checkChoice(values.target, 'target', TARGETS);
      cmdAdd({
        text: values.text,
        target: values.target,
        source: values.source,
        author: values.author,
        url: values.url,
        likes: intOpt(values.likes),
        retweets: intOpt(values.retweets),
        kind: values.kind,
        ref: values.ref,
        force: values.force,
      });
      break;
    }
    case 'merge': {
      const { positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {},
        strict: true,
      });
      if (positionals.length < 2) die('usage: store.js merge <src> <dst>', 2);
      cmdMerge({ src: positionals[0], dst: positionals[1] });
      break;
    }
    case 'list': {
      const { values } = parseArgs({
        args: rest,
        options: {
          status: { type: 'string' },
          target: { type: 'string' },
          'min-consensus': { type: 'string' },
          'min-seen': { type: 'string' }, // алиас для мышечной памяти
          limit: { type: 'string', default: '0' },
          json: { type: 'boolean', default: false },
        },
        strict: true,
      });
      checkChoice(values.status, 'status', STATUSES);
      checkChoice(values.target, 'target', TARGETS);
      cmdList({
        status: values.status,
        target: values.target,
        minConsensus: intOpt(values['min-consensus'] ?? values['min-seen']),
        limit: intOpt(values.limit),
        json: values.json,
      });
      break;
    }
    case 'show': {
      const { positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {},
        strict: true,
      });
      if (positionals.length < 1) die('usage: store.js show <id>', 2);
      cmdShow({ id: positionals[0] });
      break;
    }
    case 'status': {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { note: { type: 'string', default: '' } },
        strict: true,
      });
      if (positionals.length < 2) die('usage: store.js status <id> <new_status>', 2);
      const [id, newStatus] = positionals;
      checkChoice(newStatus, 'new_status', STATUSES);
      cmdStatus({ id, newStatus, note: values.note });
      break;
    }
    case 'index':
      cmdIndex();
      break;
    case 'stats':
      cmdStats();
      break;
    default:
      die(`store.js: error: unknown subcommand '${cmd}'`, 2);
  }
}

dispatch(process.argv);

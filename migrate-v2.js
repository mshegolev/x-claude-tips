#!/usr/bin/env node
// Одноразовая миграция rules.jsonl на схему v2. Идемпотентна.
import { copyFileSync, readFileSync, writeFileSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deriveRuleFields } from './lib/schema.js';

const BASE = join(homedir(), '.claude/knowledge/x-tips');
const RULES = join(BASE, 'rules.jsonl');

export function migrateRule(rule) {
  const sources = rule.sources.map((s) => {
    if (s.kind) return s;
    const { likes = 0, retweets = 0, bookmarks, date, ...rest } = s;
    return {
      id: rest.id,
      kind: 'x',
      author: rest.author || '',
      url: rest.url || '',
      ref: '',
      metrics: { likes, retweets },
      collected_at: date || '',
    };
  });
  const { authority, consensus, kinds } = deriveRuleFields(sources);
  const out = { ...rule, sources, authority, consensus, kinds };
  delete out.seen;
  delete out.bookmarks_max;
  return out;
}

export function backupPath(rulesPath) {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const dateBak = `${rulesPath}.bak-${dateStamp}`;

  try {
    copyFileSync(rulesPath, dateBak, constants.COPYFILE_EXCL);
    return dateBak;
  } catch (err) {
    if (err.code === 'EEXIST') {
      const timeStamp = new Date().toISOString()
        .slice(0, 19)
        .replace(/:/g, '-');
      const timeBak = `${rulesPath}.bak-${timeStamp}`;
      copyFileSync(rulesPath, timeBak, constants.COPYFILE_EXCL);
      return timeBak;
    }
    throw err;
  }
}

function main() {
  const backupLocation = backupPath(RULES);
  const lines = readFileSync(RULES, 'utf8').split('\n').filter((l) => l.trim());
  const migrated = lines.map((l) => migrateRule(JSON.parse(l)));
  writeFileSync(RULES, migrated.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`migrated ${migrated.length} rules; backup at ${backupLocation}`);
}

if (process.argv[1] && process.argv[1].endsWith('migrate-v2.js')) main();

#!/usr/bin/env node
// Update an installed x-claude-tips skill from a local checkout or a fresh git clone.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TARGET_DIR = join(homedir(), '.claude/skills/x-claude-tips');
const DEFAULT_REPO_URL = 'https://github.com/mshegolev/x-claude-tips.git';

export const INSTALL_FILES = [
  'SKILL.md',
  'store.js',
  'refresh_creds.js',
  'update.js',
  'install.sh',
  'package.json',
  'README.md',
  'LICENSE',
];

const EXECUTABLE_FILES = new Set(['store.js', 'refresh_creds.js', 'update.js', 'install.sh']);

export function parseUpdateArgs(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      'dry-run': { type: 'boolean', default: false },
      source: { type: 'string' },
      target: { type: 'string' },
      'from-git': { type: 'boolean', default: false },
      repo: { type: 'string', default: DEFAULT_REPO_URL },
      ref: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  return {
    dryRun: values['dry-run'],
    sourceDir: values.source,
    targetDir: values.target,
    fromGit: values['from-git'],
    repoUrl: values.repo,
    ref: values.ref,
    help: values.help,
  };
}

function usage() {
  return `usage: update.js [--dry-run] [--source <dir>] [--target <dir>] [--from-git] [--repo <url>] [--ref <name>]

Examples:
  node update.js
  node update.js --dry-run
  node update.js --target ~/.claude/skills/x-claude-tips
  node ~/.claude/skills/x-claude-tips/update.js --from-git
`;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function nextBackupDir(targetDir) {
  let candidate = `${targetDir}.backup-${timestamp()}`;
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = `${targetDir}.backup-${timestamp()}-${suffix}`;
    suffix++;
  }
  return candidate;
}

function validateSource(sourceDir) {
  const missing = INSTALL_FILES.filter((file) => !existsSync(join(sourceDir, file)));
  if (missing.length) {
    throw new Error(`source is missing installable files: ${missing.join(', ')}`);
  }
}

export function updateInstallation({
  sourceDir = SELF_DIR,
  targetDir = DEFAULT_TARGET_DIR,
  backupDir,
  dryRun = false,
} = {}) {
  const resolvedSource = resolve(sourceDir);
  const resolvedTarget = resolve(targetDir);
  validateSource(resolvedSource);

  if (resolvedSource === resolvedTarget) {
    throw new Error('source and target are the same; use --from-git or pass --source <repo-checkout>');
  }

  const targetExists = existsSync(resolvedTarget);
  const resolvedBackup = backupDir ? resolve(backupDir) : nextBackupDir(resolvedTarget);
  const actions = [];

  if (targetExists) {
    actions.push({ type: 'backup', from: resolvedTarget, to: resolvedBackup });
  }
  for (const file of INSTALL_FILES) {
    actions.push({
      type: 'copy',
      file,
      from: join(resolvedSource, file),
      to: join(resolvedTarget, file),
      executable: EXECUTABLE_FILES.has(file),
    });
  }

  if (dryRun) {
    return {
      dryRun: true,
      sourceDir: resolvedSource,
      targetDir: resolvedTarget,
      backupDir: targetExists ? resolvedBackup : null,
      actions,
    };
  }

  mkdirSync(dirname(resolvedTarget), { recursive: true });
  if (targetExists) {
    cpSync(resolvedTarget, resolvedBackup, { recursive: true, errorOnExist: true });
  }
  mkdirSync(resolvedTarget, { recursive: true });

  for (const file of INSTALL_FILES) {
    const target = join(resolvedTarget, file);
    cpSync(join(resolvedSource, file), target, { force: true });
    if (EXECUTABLE_FILES.has(file)) chmodSync(target, 0o755);
  }

  return {
    dryRun: false,
    sourceDir: resolvedSource,
    targetDir: resolvedTarget,
    backupDir: existsSync(resolvedBackup) ? resolvedBackup : null,
    actions,
  };
}

function cloneFromGit({ repoUrl, ref }) {
  const dir = mkdtempSync(join(tmpdir(), 'x-claude-tips-update-'));
  const args = ['clone', '--depth', '1'];
  if (ref) args.push('--branch', ref);
  args.push(repoUrl, dir);
  execFileSync('git', args, { stdio: 'inherit' });
  return dir;
}

function printResult(result) {
  console.log(`${result.dryRun ? 'dry-run' : 'updated'} ${result.targetDir}`);
  console.log(`source: ${result.sourceDir}`);
  if (result.backupDir) console.log(`backup: ${result.backupDir}`);
  for (const action of result.actions) {
    if (action.type === 'backup') {
      console.log(`backup ${action.from} -> ${action.to}`);
    } else if (action.type === 'copy') {
      console.log(`copy ${action.file}`);
    }
  }
}

function die(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function main() {
  let options;
  try {
    options = parseUpdateArgs(process.argv.slice(2));
  } catch (e) {
    die(`update.js: ${e.message}`, 2);
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  let clonedDir = null;
  try {
    const sourceDir = options.fromGit
      ? (clonedDir = cloneFromGit({ repoUrl: options.repoUrl, ref: options.ref }))
      : (options.sourceDir || SELF_DIR);
    const result = updateInstallation({
      sourceDir,
      targetDir: options.targetDir || DEFAULT_TARGET_DIR,
      dryRun: options.dryRun,
    });
    printResult(result);
  } catch (e) {
    die(`update.js: ${e.message}`);
  } finally {
    if (clonedDir) rmSync(clonedDir, { recursive: true, force: true });
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main();
}

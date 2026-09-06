#!/usr/bin/env node
// Standalone smoke-test CLI. Subcommands: auth, search, user, tweet, import-profile.

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { BrowserSession, CHROME_PROFILE_SRC, PROFILE_DIR } from './browser.js';
import { search, tweet, userTweets } from './parser.js';

// Files copied from Chrome profile for fingerprint + preferences. Cookies and
// Login Data are skipped: macOS Keychain ties their encryption to the original
// profile path so they won't decrypt after a copy. Auth still comes from
// TWITTER_AUTH_TOKEN/TWITTER_CT0 env vars.
const FINGERPRINT_ITEMS = [
  'Preferences',
  'Secure Preferences',
  'Bookmarks',
  'History',
  'Favicons',
  'Web Data',
  'Extensions',
  'Local Extension Settings',
  'Sync Extension Settings',
  'Shared Dictionary',
];

function chromeRunning() {
  try {
    execFileSync('pgrep', ['-xf', 'Google Chrome'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function importProfile(force) {
  if (!existsSync(CHROME_PROFILE_SRC)) {
    process.stderr.write(`error: Chrome profile not found at ${CHROME_PROFILE_SRC}\n`);
    process.exit(1);
  }
  if (chromeRunning() && !force) {
    process.stderr.write(
      'error: Chrome is running. Quit Chrome fully (\u2318Q) then retry, or pass --force to copy anyway (some files will be locked).\n',
    );
    process.exit(1);
  }
  mkdirSync(PROFILE_DIR, { recursive: true });
  const copied = [];
  const skipped = [];
  for (const name of FINGERPRINT_ITEMS) {
    const src = join(CHROME_PROFILE_SRC, name);
    if (!existsSync(src)) continue;
    const dst = join(PROFILE_DIR, name);
    try {
      const st = statSync(src);
      if (st.isDirectory()) {
        if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
        cpSync(src, dst, { recursive: true, dereference: false });
      } else {
        copyFileSync(src, dst);
      }
      copied.push(name);
    } catch (e) {
      skipped.push(`${name} (${e.message})`);
    }
  }
  // Local State sits in the profile parent — tracks profile-wide settings.
  const localStateSrc = join(dirname(CHROME_PROFILE_SRC), 'Local State');
  if (existsSync(localStateSrc)) {
    try {
      copyFileSync(localStateSrc, join(PROFILE_DIR, 'Local State'));
      copied.push('Local State');
    } catch (e) {
      skipped.push(`Local State (${e.message})`);
    }
  }
  process.stdout.write(
    `${JSON.stringify({ copied, skipped, profile_dir: PROFILE_DIR }, null, 2)}\n`,
  );
}

function parseFlag(argv, name, defVal) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return defVal;
  return argv[i + 1];
}

function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}

function usage(code = 1) {
  process.stderr.write(
    'usage: x-mcp-cli <auth|search|user|tweet|import-profile> [args]\n' +
      '  auth\n' +
      '  search <query> [--count N] [--sort Latest|Top]\n' +
      '  user <username> [--count N]\n' +
      '  tweet <url>\n' +
      '  import-profile [--force]\n',
  );
  process.exit(code);
}

async function runBrowserCmd(cmd, argv) {
  const sess = await BrowserSession.get();
  const page = await sess.newPage();
  try {
    if (cmd === 'auth') {
      const ok = await sess.isLoggedIn(page);
      process.stdout.write(`${JSON.stringify({ logged_in: ok })}\n`);
      return ok ? 0 : 2;
    }
    let data;
    if (cmd === 'search') {
      const query = argv[0];
      if (!query) usage();
      const count = Number.parseInt(parseFlag(argv, 'count', '10'), 10);
      const sort = parseFlag(argv, 'sort', 'Latest');
      data = await search(page, query, count, sort);
    } else if (cmd === 'user') {
      const username = argv[0];
      if (!username) usage();
      const count = Number.parseInt(parseFlag(argv, 'count', '10'), 10);
      data = await userTweets(page, username, count);
    } else if (cmd === 'tweet') {
      const url = argv[0];
      if (!url) usage();
      data = await tweet(page, url);
    } else {
      usage();
    }
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return 0;
  } finally {
    await page.close().catch(() => {});
    await sess.close().catch(() => {});
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();
  if (cmd === 'import-profile') {
    importProfile(hasFlag(rest, 'force'));
    return;
  }
  const code = await runBrowserCmd(cmd, rest);
  process.exit(code);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e.stack || e.message}\n`);
  process.exit(1);
});

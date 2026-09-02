#!/usr/bin/env node
// Refresh ~/.x-creds with auth_token and ct0 from a local browser on macOS.
//
// Chrome reads its encrypted Cookies SQLite DB and decrypts values using the
// AES-128-CBC key derived from the macOS Keychain "Chrome Safe Storage" entry.
// Firefox reads cookies.sqlite from the selected profile. Safari reads
// Cookies.binarycookies. All modes rewrite the TWITTER_AUTH_TOKEN /
// TWITTER_CT0 lines in ~/.x-creds. If ~/.x-creds is missing, creates a chmod
// 600 template first.
//
// Works for Chrome v10 cookies on macOS. v20 (app-bound) cookies are reported
// and skipped — those require Chrome to be quit + a different unwrap path.

import { execFileSync, spawnSync } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// node:sqlite is a built-in only since Node 22.5. This script's shebang
// (`#!/usr/bin/env node`) inherits whatever node is first on PATH, which may
// be an older LTS (e.g. v20) that lacks it. Load it lazily via createRequire
// — that runs in module-body order, so the re-exec guard below gets a chance
// to relaunch us under a capable node before we ever touch node:sqlite.
const SCRIPT_PATH = fileURLToPath(import.meta.url);

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(SCRIPT_PATH);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

// Find a node >= 22.5 and re-exec this script under it. Returns (caller then
// throws) only when no capable node is found. Guarded by X_CLAUDE_TIPS_REEXEC
// so the relaunched child never loops.
function reExecUnderCapableNode() {
  const candidates = [];
  if (process.env.X_CLAUDE_TIPS_NODE) candidates.push(process.env.X_CLAUDE_TIPS_NODE);
  try {
    const out = execFileSync('/usr/bin/which', ['-a', 'node'], { encoding: 'utf8' });
    for (const line of out.split('\n')) if (line.trim()) candidates.push(line.trim());
  } catch {
    // `which` missing — fall back to the well-known locations below.
  }
  candidates.push('/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node');

  const current = process.execPath;
  const seen = new Set();
  for (const bin of candidates) {
    if (!bin || bin === current || seen.has(bin) || !existsSync(bin)) continue;
    seen.add(bin);
    let version;
    try {
      version = execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
    } catch {
      continue;
    }
    const m = /^v(\d+)\.(\d+)\.\d+/.exec(version);
    if (!m) continue;
    const [major, minor] = [Number(m[1]), Number(m[2])];
    if (major > 22 || (major === 22 && minor >= 5)) {
      process.stderr.write(
        `refresh_creds: node ${process.version} lacks node:sqlite; ` +
          `re-exec under ${bin} (${version})\n`,
      );
      const res = spawnSync(bin, [SCRIPT_PATH, ...process.argv.slice(2)], {
        stdio: 'inherit',
        env: { ...process.env, X_CLAUDE_TIPS_REEXEC: '1' },
      });
      process.exit(res.status == null ? 1 : res.status);
    }
  }
}

const require = createRequire(import.meta.url);
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  if (isMainModule() && process.env.X_CLAUDE_TIPS_REEXEC !== '1') {
    reExecUnderCapableNode();
  }
  throw new Error(
    `node:sqlite is unavailable under ${process.version} (need Node >= 22.5).\n` +
      'Run with a newer node (e.g. /usr/local/bin/node refresh_creds.js) or ' +
      'set X_CLAUDE_TIPS_NODE to a >= 22 node binary.\n' +
      `Original error: ${err.message}`,
  );
}

const CHROME_DIR = join(homedir(), 'Library/Application Support/Google/Chrome');
const FIREFOX_DIR = join(homedir(), 'Library/Application Support/Firefox/Profiles');
const SAFARI_COOKIE_FILES = [
  join(homedir(), 'Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies'),
  join(homedir(), 'Library/Cookies/Cookies.binarycookies'),
];
const CREDS_FILE = join(homedir(), '.x-creds');
const TMP_DIR = '/tmp';
const HOST_LIKE = ['%x.com', '%twitter.com'];
const NAMES = ['auth_token', 'ct0'];
const BROWSER_CHOICES = ['chrome', 'firefox', 'safari', 'auto'];

export const X_CREDS_TEMPLATE = `# X (Twitter) credentials for mcp-twikit.
# Chmod 600. Never commit. Values are bash-exported on every Claude Code
# session start when the twikit MCP subprocess spawns.
#
# Fill these in with your THROWAWAY X account (not your main one).
# If you have 2FA enabled, disable it or use a dedicated login session.
#
# Default browser for refresh_creds.js (chrome | firefox | safari | auto).
# Overridable per-run with --browser. Set by install.sh.
export X_CLAUDE_TIPS_BROWSER=firefox

export TWITTER_USERNAME=
export TWITTER_EMAIL=
export TWITTER_PASSWORD=

export TWITTER_AUTH_TOKEN=
export TWITTER_CT0=
`;

export function ensureCredsFile(credsFile = CREDS_FILE) {
  if (existsSync(credsFile)) return false;
  writeFileSync(credsFile, X_CREDS_TEMPLATE, { mode: 0o600 });
  chmodSync(credsFile, 0o600);
  return true;
}

export function parseBrowserOption(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      browser: { type: 'string', short: 'b' },
    },
    allowPositionals: false,
    strict: true,
  });
  // Precedence: explicit --browser flag > X_CLAUDE_TIPS_BROWSER env > firefox.
  const browser =
    values.browser || process.env.X_CLAUDE_TIPS_BROWSER || 'firefox';
  if (!BROWSER_CHOICES.includes(browser)) {
    throw new Error(
      `invalid --browser '${browser}' (choose from ${BROWSER_CHOICES.join(', ')})`,
    );
  }
  return browser;
}

function die(msg, code = 1) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

function keychainPassword() {
  try {
    return execFileSync('security', ['find-generic-password', '-wa', 'Chrome'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8').trim();
  } catch (e) {
    const stderr = (e.stderr && e.stderr.toString('utf8').trim()) || e.message;
    throw new Error(`keychain read failed: ${stderr}`);
  }
}

function deriveKey(pw) {
  return pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1');
}

function decryptV10(blob, key) {
  const body = blob.subarray(0, 3).toString() === 'v10' ? blob.subarray(3) : blob;
  const d = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  d.setAutoPadding(false);
  let dec = Buffer.concat([d.update(body), d.final()]);
  const pad = dec[dec.length - 1];
  if (pad < 1 || pad > 16) throw new Error(`bad PKCS7 padding byte ${pad}`);
  dec = dec.subarray(0, dec.length - pad);
  // Chrome 80+ on macOS prepends SHA256(domain) (32 bytes) to the plaintext.
  if (dec.length > 32) {
    let nonAscii = false;
    for (let i = 0; i < 32; i++) {
      if (dec[i] < 0x20 || dec[i] > 0x7e) { nonAscii = true; break; }
    }
    if (nonAscii) dec = dec.subarray(32);
  }
  return dec.toString('utf8');
}

function scanChromeProfiles() {
  const found = [];
  let entries;
  try {
    entries = readdirSync(CHROME_DIR, { withFileTypes: true });
  } catch (e) {
    return found;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    if (name !== 'Default' && !name.startsWith('Profile')) continue;
    const cookies = join(CHROME_DIR, name, 'Cookies');
    if (!existsSync(cookies)) continue;
    const probe = join(TMP_DIR, `_xprobe_${name.replace(/ /g, '_')}.sqlite`);
    try {
      copyFileSync(cookies, probe);
      const db = new DatabaseSync(probe);
      const row = db
        .prepare(
          'SELECT COUNT(*) AS n FROM cookies ' +
            'WHERE (host_key LIKE ? OR host_key LIKE ?) AND name IN (?, ?)',
        )
        .get(...HOST_LIKE, ...NAMES);
      db.close();
      const n = row && row.n ? Number(row.n) : 0;
      if (n) found.push({ name, n, cookies });
    } catch {
      // ignore unreadable profiles
    } finally {
      rmSync(probe, { force: true });
    }
  }
  return found;
}

function readChromeCookies(cookiesPath) {
  const snap = join(TMP_DIR, `_xchrome_${process.pid}_${Date.now()}.sqlite`);
  copyFileSync(cookiesPath, snap);
  try {
    const db = new DatabaseSync(snap);
    const rows = db
      .prepare(
        'SELECT host_key, name, encrypted_value, expires_utc ' +
          'FROM cookies ' +
          'WHERE (host_key LIKE ? OR host_key LIKE ?) AND name IN (?, ?) ' +
          'ORDER BY expires_utc DESC',
      )
      .all(...HOST_LIKE, ...NAMES);
    db.close();
    return rows;
  } finally {
    rmSync(snap, { force: true });
  }
}

export function readFirefoxCookies(cookiesPath) {
  const snap = join(TMP_DIR, `_xfirefox_${process.pid}_${Date.now()}.sqlite`);
  copyFileSync(cookiesPath, snap);
  try {
    const db = new DatabaseSync(snap);
    const rows = db
      .prepare(
        'SELECT host AS host_key, name, value, expiry AS expires_utc ' +
          'FROM moz_cookies ' +
          'WHERE (host LIKE ? OR host LIKE ?) AND name IN (?, ?) ' +
          'ORDER BY expiry DESC',
      )
      .all(...HOST_LIKE, ...NAMES);
    db.close();
    return rows;
  } finally {
    rmSync(snap, { force: true });
  }
}

function scanFirefoxProfiles() {
  const found = [];
  let entries;
  try {
    entries = readdirSync(FIREFOX_DIR, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const cookies = join(FIREFOX_DIR, ent.name, 'cookies.sqlite');
    if (!existsSync(cookies)) continue;
    try {
      const n = readFirefoxCookies(cookies).length;
      if (n) found.push({ name: ent.name, n, cookies });
    } catch {
      // ignore unreadable profiles
    }
  }
  return found;
}

function readNullTerminated(buffer, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= buffer.length) return '';
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end++;
  return buffer.subarray(offset, end).toString('utf8');
}

function isTargetCookieHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'x.com' || h.endsWith('.x.com') || h === 'twitter.com' || h.endsWith('.twitter.com');
}

export function parseSafariBinaryCookies(buffer) {
  if (buffer.length < 12 || buffer.subarray(0, 4).toString('ascii') !== 'cook') {
    throw new Error('not a Safari Cookies.binarycookies file');
  }

  const pageCount = buffer.readUInt32BE(4);
  const pageSizesOffset = 8;
  let pageOffset = pageSizesOffset + pageCount * 4;
  const rows = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const pageSize = buffer.readUInt32BE(pageSizesOffset + pageIndex * 4);
    if (pageSize < 8 || pageOffset + pageSize > buffer.length) break;
    const page = buffer.subarray(pageOffset, pageOffset + pageSize);
    const cookieCount = page.readUInt32LE(4);

    for (let i = 0; i < cookieCount; i++) {
      const offsetPosition = 8 + i * 4;
      if (offsetPosition + 4 > page.length) break;
      const cookieOffset = page.readUInt32LE(offsetPosition);
      if (cookieOffset + 32 > page.length) continue;
      const cookieSize = page.readUInt32LE(cookieOffset);
      if (cookieSize <= 0 || cookieOffset + cookieSize > page.length) continue;
      const cookie = page.subarray(cookieOffset, cookieOffset + cookieSize);

      const host = readNullTerminated(cookie, cookie.readUInt32LE(16));
      const name = readNullTerminated(cookie, cookie.readUInt32LE(20));
      const path = readNullTerminated(cookie, cookie.readUInt32LE(24));
      const value = readNullTerminated(cookie, cookie.readUInt32LE(28));
      if (!NAMES.includes(name) || !isTargetCookieHost(host)) continue;
      rows.push({ host_key: host, name, path, value });
    }

    pageOffset += pageSize;
  }

  return rows;
}

function readSafariCookies(cookiesPath) {
  return parseSafariBinaryCookies(readFileSync(cookiesPath));
}

function scanSafariCookieFiles() {
  const found = [];
  for (const cookies of SAFARI_COOKIE_FILES) {
    if (!existsSync(cookies)) continue;
    try {
      const n = readSafariCookies(cookies).length;
      if (n) found.push({ name: cookies, n, cookies });
    } catch {
      // ignore unreadable cookie files
    }
  }
  return found;
}

function pickPlainCredentials(rows, label) {
  let authToken = null;
  let ct0 = null;
  for (const row of rows) {
    const host = row.host_key;
    const name = row.name;
    const val = row.value || '';
    console.log(`  ${host}/${name}: ${val.slice(0, 8)}...(${val.length} chars)`);
    if (name === 'auth_token' && !authToken) authToken = val;
    else if (name === 'ct0' && !ct0) ct0 = val;
  }
  if (!authToken || !ct0) {
    throw new Error(
      `${label} missing: auth_token=${authToken ? 'OK' : 'MISS'}, ct0=${ct0 ? 'OK' : 'MISS'}`,
    );
  }
  return { authToken, ct0 };
}

function readChromeCredentials() {
  const profiles = scanChromeProfiles();
  if (profiles.length === 0) {
    throw new Error('no Chrome profile has x.com cookies — log in via Chrome first');
  }

  console.log('Chrome profiles with x.com cookies:');
  for (const p of profiles) console.log(`  ${p.name}: ${p.n} cookies`);
  const best = profiles.reduce((a, b) => (b.n > a.n ? b : a));
  console.log(`using: ${best.name}\n`);

  const key = deriveKey(keychainPassword());
  let authToken = null;
  let ct0 = null;
  let v20Count = 0;
  for (const row of readChromeCookies(best.cookies)) {
    const host = row.host_key;
    const name = row.name;
    const enc = Buffer.from(row.encrypted_value);
    const prefix = enc.subarray(0, 3).toString();
    if (prefix === 'v20') {
      v20Count++;
      process.stderr.write(`  ${host}/${name}: v20 app-bound — skipped\n`);
      continue;
    }
    if (prefix !== 'v10') {
      process.stderr.write(`  ${host}/${name}: unknown prefix ${JSON.stringify(prefix)} — skipped\n`);
      continue;
    }
    let val;
    try {
      val = decryptV10(enc, key);
    } catch (e) {
      process.stderr.write(`  ${host}/${name}: decrypt failed: ${e.message}\n`);
      continue;
    }
    console.log(`  ${host}/${name}: ${val.slice(0, 8)}...(${val.length} chars)`);
    if (name === 'auth_token' && !authToken) authToken = val;
    else if (name === 'ct0' && !ct0) ct0 = val;
  }

  if (!authToken || !ct0) {
    if (v20Count) {
      process.stderr.write(
        '\nv20 cookies present — fully quit Chrome and retry, or use --remote-debugging-port.\n',
      );
    }
    throw new Error(
      `Chrome missing: auth_token=${authToken ? 'OK' : 'MISS'}, ct0=${ct0 ? 'OK' : 'MISS'}`,
    );
  }
  return { authToken, ct0 };
}

function readFirefoxCredentials() {
  const profiles = scanFirefoxProfiles();
  if (profiles.length === 0) {
    throw new Error('no Firefox profile has x.com cookies — log in via Firefox first');
  }

  console.log('Firefox profiles with x.com cookies:');
  for (const p of profiles) console.log(`  ${p.name}: ${p.n} cookies`);
  const best = profiles.reduce((a, b) => (b.n > a.n ? b : a));
  console.log(`using: ${best.name}\n`);
  return pickPlainCredentials(readFirefoxCookies(best.cookies), 'Firefox');
}

function readSafariCredentials() {
  const files = scanSafariCookieFiles();
  if (files.length === 0) {
    throw new Error('no Safari Cookies.binarycookies file has x.com cookies — log in via Safari first');
  }

  console.log('Safari cookie files with x.com cookies:');
  for (const p of files) console.log(`  ${p.name}: ${p.n} cookies`);
  const best = files.reduce((a, b) => (b.n > a.n ? b : a));
  console.log(`using: ${best.name}\n`);
  return pickPlainCredentials(readSafariCookies(best.cookies), 'Safari');
}

function readBrowserCredentials(browser) {
  const readers = {
    chrome: readChromeCredentials,
    firefox: readFirefoxCredentials,
    safari: readSafariCredentials,
  };
  if (browser !== 'auto') return readers[browser]();

  const errors = [];
  for (const name of ['chrome', 'firefox', 'safari']) {
    try {
      console.log(`trying ${name}...`);
      return readers[name]();
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  throw new Error(`no browser source produced X cookies:\n  ${errors.join('\n  ')}`);
}

function updateCreds(authToken, ct0) {
  if (ensureCredsFile(CREDS_FILE)) {
    console.log(`created ${CREDS_FILE} from template`);
  }
  const content = readFileSync(CREDS_FILE, 'utf8');

  const sub = (varName, val, text) => {
    const pat = new RegExp(`^(export ${varName}=).*$`, 'm');
    if (!pat.test(text)) die(`line 'export ${varName}=' missing in ~/.x-creds`);
    return text.replace(pat, (_, prefix) => prefix + val);
  };

  let next = sub('TWITTER_AUTH_TOKEN', authToken, content);
  next = sub('TWITTER_CT0', ct0, next);

  const bak = CREDS_FILE + '.bak';
  writeFileSync(bak, content);
  chmodSync(bak, 0o600);
  writeFileSync(CREDS_FILE, next);
  chmodSync(CREDS_FILE, 0o600);
  console.log(`updated ${CREDS_FILE} (backup: ${bak})`);
}

function main() {
  let browser;
  try {
    browser = parseBrowserOption(process.argv.slice(2));
  } catch (e) {
    die(`refresh_creds.js: ${e.message}`, 2);
  }

  try {
    const { authToken, ct0 } = readBrowserCredentials(browser);
    updateCreds(authToken, ct0);
  } catch (e) {
    die(e.message);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

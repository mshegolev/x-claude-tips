// Извлечение X-сессии из живого Chrome-профиля.
// ВАЖНО: значения кук не печатаются нигде — только имя, домен и длина.
import { execFileSync } from 'node:child_process';
import { pbkdf2Sync, createDecipheriv } from 'node:crypto';
import {
  chmodSync, copyFileSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_PROFILE = join(
  homedir(), 'Library/Application Support/Google/Chrome/Default');
const WANT = ['auth_token', 'ct0'];

export function deriveKey(password) {
  return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

export function decryptValue(encrypted, key) {
  if (encrypted.subarray(0, 3).toString() !== 'v10') {
    throw new Error('unsupported cookie encryption version');
  }
  const d = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  d.setAutoPadding(false);
  let raw = Buffer.concat([d.update(encrypted.subarray(3)), d.final()]);
  raw = raw.subarray(0, raw.length - raw[raw.length - 1]); // PKCS#7
  return raw.subarray(32).toString('utf8');                // SHA256-префикс Chrome
}

function keychainPassword() {
  return execFileSync('security',
    ['find-generic-password', '-s', 'Chrome Safe Storage', '-w'],
    { encoding: 'utf8' }).trim();
}

// Копирует sourcePath во временную директорию (живая Cookies-БД залочена
// Chrome'ом), передаёт путь к копии в fn, и ГАРАНТИРОВАННО удаляет
// временную директорию — даже если fn бросает.
export function withTempCopy(sourcePath, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'xtips-ck-'));
  try {
    const dest = join(dir, 'Cookies');
    copyFileSync(sourcePath, dest);
    return fn(dest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function extractXCookies(profileDir = DEFAULT_PROFILE) {
  const key = deriveKey(keychainPassword());
  return withTempCopy(join(profileDir, 'Cookies'), (db) => {
    const rows = execFileSync('sqlite3', [db,
      "SELECT name||'|'||host_key||'|'||hex(encrypted_value) FROM cookies "
      + "WHERE host_key LIKE '%x.com'"], { encoding: 'utf8' });

    const out = [];
    for (const line of rows.trim().split('\n')) {
      if (!line) continue;
      const [name, domain, hex] = line.split('|');
      if (!WANT.includes(name)) continue;
      out.push({ name, domain, value: decryptValue(Buffer.from(hex, 'hex'), key) });
    }
    const missing = WANT.filter((w) => !out.some((c) => c.name === w));
    if (missing.length) {
      throw new Error(`cookies not found in Chrome profile: ${missing.join(', ')} `
        + '— log into x.com in Chrome first');
    }
    return out;
  });
}

export function writeCookieFile(cookies, path) {
  const payload = cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'None',
    expires: 2000000000,
    priority: 'Medium',
    sameParty: false,
    sourceScheme: 'Secure',
    sourcePort: 443,
  }));
  // mode:0o600 restricts on creation (still subject to umask); the
  // explicit chmodSync afterwards pins the final mode regardless.
  writeFileSync(path, JSON.stringify(payload), { mode: 0o600 });
  chmodSync(path, 0o600);
}

if (process.argv[1] && process.argv[1].endsWith('chrome-cookies.js')) {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write('usage: chrome-cookies.js <output-path>\n');
    process.exit(1);
  }
  const cookies = extractXCookies();
  writeCookieFile(cookies, target);
  for (const c of cookies) {
    console.log(`${c.name}: domain=${c.domain} len=${c.value.length} OK`);
  }
  console.log(`wrote ${cookies.length} cookies -> ${target}`);
}

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  ensureCredsFile,
  parseBrowserOption,
  parseSafariBinaryCookies,
  readFirefoxCookies,
  X_CREDS_TEMPLATE,
} from '../refresh_creds.js';

test('ensureCredsFile creates a chmod 600 .x-creds template when missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'x-creds-'));
  const credsFile = join(dir, '.x-creds');

  try {
    const created = ensureCredsFile(credsFile);

    assert.equal(created, true);
    assert.equal(readFileSync(credsFile, 'utf8'), X_CREDS_TEMPLATE);
    assert.equal(statSync(credsFile).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseBrowserOption defaults to firefox and accepts supported browser choices', () => {
  const saved = process.env.X_CLAUDE_TIPS_BROWSER;
  delete process.env.X_CLAUDE_TIPS_BROWSER;
  try {
    assert.equal(parseBrowserOption([]), 'firefox');
    assert.equal(parseBrowserOption(['--browser', 'chrome']), 'chrome');
    assert.equal(parseBrowserOption(['--browser', 'safari']), 'safari');
    assert.equal(parseBrowserOption(['--browser', 'auto']), 'auto');
  } finally {
    if (saved === undefined) delete process.env.X_CLAUDE_TIPS_BROWSER;
    else process.env.X_CLAUDE_TIPS_BROWSER = saved;
  }
});

test('parseBrowserOption falls back to X_CLAUDE_TIPS_BROWSER, flag wins over env', () => {
  const saved = process.env.X_CLAUDE_TIPS_BROWSER;
  process.env.X_CLAUDE_TIPS_BROWSER = 'chrome';
  try {
    assert.equal(parseBrowserOption([]), 'chrome');
    assert.equal(parseBrowserOption(['--browser', 'safari']), 'safari');
  } finally {
    if (saved === undefined) delete process.env.X_CLAUDE_TIPS_BROWSER;
    else process.env.X_CLAUDE_TIPS_BROWSER = saved;
  }
});

test('readFirefoxCookies reads auth_token and ct0 from a copied cookies.sqlite DB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'x-firefox-'));
  const cookiesFile = join(dir, 'cookies.sqlite');

  try {
    const db = new DatabaseSync(cookiesFile);
    db.exec(`
      CREATE TABLE moz_cookies (
        host TEXT,
        name TEXT,
        value TEXT,
        expiry INTEGER
      );
      INSERT INTO moz_cookies VALUES ('.x.com', 'auth_token', 'auth-firefox', 4102444800);
      INSERT INTO moz_cookies VALUES ('.x.com', 'ct0', 'ct0-firefox', 4102444800);
      INSERT INTO moz_cookies VALUES ('.example.com', 'auth_token', 'ignored', 4102444800);
    `);
    db.close();

    const rows = readFirefoxCookies(cookiesFile);

    assert.deepEqual(
      rows.map((row) => [row.host_key, row.name, row.value]),
      [
        ['.x.com', 'auth_token', 'auth-firefox'],
        ['.x.com', 'ct0', 'ct0-firefox'],
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseSafariBinaryCookies reads auth_token and ct0 from a binarycookies buffer', () => {
  const buffer = buildSafariCookiesBuffer([
    { host: '.x.com', name: 'auth_token', path: '/', value: 'auth-safari' },
    { host: '.x.com', name: 'ct0', path: '/', value: 'ct0-safari' },
  ]);

  const rows = parseSafariBinaryCookies(buffer);

  assert.deepEqual(
    rows.map((row) => [row.host_key, row.name, row.value]),
    [
      ['.x.com', 'auth_token', 'auth-safari'],
      ['.x.com', 'ct0', 'ct0-safari'],
    ],
  );
});

function buildSafariCookiesBuffer(cookies) {
  const cookieBuffers = cookies.map(buildSafariCookieRecord);
  const cookieCount = cookieBuffers.length;
  const cookieOffsetTableSize = cookieCount * 4;
  const pageHeaderSize = 4 + 4 + cookieOffsetTableSize + 4;
  const cookieOffsets = [];
  let cursor = pageHeaderSize;
  for (const cookie of cookieBuffers) {
    cookieOffsets.push(cursor);
    cursor += cookie.length;
  }

  const pageSize = cursor;
  const page = Buffer.alloc(pageSize);
  page.writeUInt32BE(0x00000100, 0);
  page.writeUInt32LE(cookieCount, 4);
  cookieOffsets.forEach((offset, index) => page.writeUInt32LE(offset, 8 + index * 4));
  page.writeUInt32LE(0, 8 + cookieOffsetTableSize);
  cookieBuffers.forEach((cookie, index) => cookie.copy(page, cookieOffsets[index]));

  const out = Buffer.alloc(4 + 4 + 4 + page.length + 4);
  out.write('cook', 0, 'ascii');
  out.writeUInt32BE(1, 4);
  out.writeUInt32BE(page.length, 8);
  page.copy(out, 12);
  out.writeUInt32BE(0, 12 + page.length);
  return out;
}

function buildSafariCookieRecord({ host, name, path, value }) {
  const strings = [host, name, path, value].map((s) => Buffer.from(`${s}\0`, 'utf8'));
  const headerSize = 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 8 + 8;
  const offsets = [];
  let cursor = headerSize;
  for (const s of strings) {
    offsets.push(cursor);
    cursor += s.length;
  }

  const out = Buffer.alloc(cursor);
  out.writeUInt32LE(cursor, 0);
  out.writeUInt32LE(0, 4);
  out.writeUInt32LE(0, 8);
  out.writeUInt32LE(0, 12);
  offsets.forEach((offset, index) => out.writeUInt32LE(offset, 16 + index * 4));
  out.writeDoubleLE(0, 32);
  out.writeDoubleLE(0, 40);
  strings.forEach((s, index) => s.copy(out, offsets[index]));
  return out;
}

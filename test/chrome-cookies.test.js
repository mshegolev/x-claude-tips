import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveKey, decryptValue, writeCookieFile } from '../lib/chrome-cookies.js';

test('deriveKey matches Chrome KDF parameters', () => {
  const key = deriveKey('test-password');
  assert.equal(key.length, 16);
  assert.equal(key.toString('hex'), deriveKey('test-password').toString('hex'));
  assert.notEqual(key.toString('hex'), deriveKey('other').toString('hex'));
});

test('decryptValue round-trips a v10 payload', () => {
  const key = deriveKey('test-password');
  const secret = 'a'.repeat(40);
  const plain = Buffer.concat([Buffer.alloc(32, 7), Buffer.from(secret, 'utf8')]);
  const pad = 16 - (plain.length % 16);
  const padded = Buffer.concat([plain, Buffer.alloc(pad, pad)]);
  const c = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  c.setAutoPadding(false);
  const body = Buffer.concat([c.update(padded), c.final()]);
  const encrypted = Buffer.concat([Buffer.from('v10'), body]);
  assert.equal(decryptValue(encrypted, key), secret);
});

test('decryptValue rejects unsupported version prefix', () => {
  const key = deriveKey('test-password');
  assert.throws(() => decryptValue(Buffer.from('v20abcdef'), key), /unsupported/i);
});

test('writeCookieFile writes CDP shape with 0600 permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ck-'));
  const path = join(dir, 'x_session_cookies.json');
  writeCookieFile([{ name: 'auth_token', value: 'secret', domain: '.x.com' }], path);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(parsed[0].name, 'auth_token');
  assert.equal(parsed[0].domain, '.x.com');
  assert.equal(parsed[0].secure, true);
  assert.equal(parsed[0].httpOnly, true);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

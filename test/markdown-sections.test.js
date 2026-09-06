import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitSections } from '../lib/markdown-sections.js';

const FIXTURE = readFileSync(
  new URL('./fixtures/docs-hooks.md', import.meta.url), 'utf8');

test('splits on level-2 headings and keeps their text', () => {
  const s = splitSections('# Title\n\nintro\n\n## One\n\nalpha\n\n## Two\n\nbeta\n');
  assert.deepEqual(s.map((x) => x.heading), ['One', 'Two']);
  assert.match(s[0].text, /alpha/);
  assert.ok(!s[0].text.includes('beta'), 'sections must not bleed into each other');
});

test('drops sections shorter than minChars', () => {
  const s = splitSections('## Tiny\n\nx\n\n## Real\n\n' + 'y'.repeat(200) + '\n',
    { minChars: 100 });
  assert.deepEqual(s.map((x) => x.heading), ['Real']);
});

test('returns nothing when there are no level-2 headings', () => {
  assert.deepEqual(splitSections('# Only a title\n\nbody text here\n'), []);
});

test('a heading inside a fenced code block is not a section', () => {
  const s = splitSections(
    '## Real\n\n```md\n## Not a heading\n```\n\n' + 'z'.repeat(120) + '\n');
  assert.deepEqual(s.map((x) => x.heading), ['Real']);
});

test('the real docs fixture yields many substantial sections', () => {
  const s = splitSections(FIXTURE, { minChars: 200 });
  assert.ok(s.length >= 5, `expected several sections, got ${s.length}`);
  assert.ok(s.every((x) => x.heading.length > 0));
  assert.ok(s.every((x) => x.text.length >= 200));
  const headings = s.map((x) => x.heading);
  assert.ok(headings.includes('Configuration'),
    `fixture should carry a Configuration section, got ${headings.slice(0, 5)}`);
});

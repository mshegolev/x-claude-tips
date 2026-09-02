import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterItems } from '../lib/noise.js';
import {
  passesEngagement, toItem, collect, QUERIES,
} from '../collectors/x.js';

function posts(n) {
  const url = new URL(`./fixtures/q${n}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')).data.posts;
}

test('engagement threshold uses likes and retweets only', () => {
  assert.ok(passesEngagement({ metrics: { likes: 1500, retweets: 44 } }));
  assert.ok(passesEngagement({ metrics: { likes: 800, retweets: 181 } }));
  assert.ok(!passesEngagement({ metrics: { likes: 525, retweets: 78 } }));
});

test('staff and known practitioners get the lower bar', () => {
  assert.ok(passesEngagement({ author: 'AnthropicAI', metrics: { likes: 244, retweets: 3 } }));
  assert.ok(passesEngagement({ author: 'alexalbert__', metrics: { likes: 259, retweets: 16 } }));
  assert.ok(!passesEngagement({ author: 'AnthropicAI', metrics: { likes: 100, retweets: 1 } }));
});

test('toItem marks truncated text', () => {
  // Реальный обрыв из прогона 2026-09-02: текст длиннее 200 символов и
  // заканчивается на середине фразы «you train it like».
  const cutText = 'many people asked me how to write CLAUDE.md or AGENTS.md, '
    + 'and i see lots of bad advice flying around so i took some time to write '
    + 'down a guide in https://t.co/QLAWfVhCFV tl;dr - handwrite your user level '
    + "AGENTS.md - for project level ones, you don't write it. you train it like";
  const cut = toItem({ id: '1', text: cutText, author: { screen_name: 'a' }, url: 'u', metrics: { likes: 1, reposts: 1 } });
  assert.ok(cutText.length > 200, 'fixture text must exceed the truncation floor');
  assert.equal(cut.truncated, true);
  const whole = toItem({ id: '2', text: 'In every one of our repos CLAUDE.md is a symlink to AGENTS.md.', author: { screen_name: 'b' }, url: 'u', metrics: { likes: 1, reposts: 1 } });
  assert.equal(whole.truncated, false);
});

test('toItem maps reposts to retweets and stamps kind', () => {
  const it = toItem({ id: '7', text: 'x'.repeat(100), author: { screen_name: 'z' }, url: 'u', metrics: { likes: 5, reposts: 9 } });
  assert.equal(it.kind, 'x');
  assert.deepEqual(it.metrics, { likes: 5, retweets: 9 });
  assert.equal(it.ref, '');
});

test('noise filter collapses the three BREAKING NEWS clones in fixture q1', () => {
  const items = posts(1).map(toItem);
  const bait = items.filter((i) => /BREAKING NEWS/i.test(i.text));
  assert.equal(bait.length, 3, 'fixture should contain three clones');
  const { kept } = filterItems(bait);
  assert.equal(kept.length, 0, 'all three must be dropped as bait');
});

test('the hack story in fixture q3 survives the filter', () => {
  const items = posts(3).map(toItem);
  const hack = items.find((i) => i.text.startsWith('Got hacked yesterday'));
  assert.ok(hack, 'fixture should contain the hack story');
  const { kept } = filterItems([hack]);
  assert.equal(kept.length, 1);
});

test('filtering fixture q1 leaves the concrete CLAUDE.md rules', () => {
  const items = posts(1).map(toItem).filter(passesEngagement);
  const { kept } = filterItems(items);
  const authors = kept.map((i) => i.author);
  assert.ok(authors.includes('bentlegen'));
  assert.ok(authors.includes('tobi'));
});

test('a complete sentence with a trailing link is not truncated', () => {
  // Реальный пример из фикстур: "...first 10 minutes." + отдельная
  // t.co-ссылка на конце — законченное предложение с приложенным медиа,
  // не обрыв.
  const text = 'many people asked me how to write CLAUDE.md or AGENTS.md, '
    + 'and i see lots of bad advice flying around so i took some time to write '
    + 'down a full and complete guide with every detail spelled out in the end. '
    + 'https://t.co/QLAWfVhCFV';
  const it = toItem({ id: '3', text, author: { screen_name: 'c' }, url: 'u', metrics: { likes: 1, reposts: 1 } });
  assert.ok(text.length > 200, 'text must exceed the truncation floor');
  assert.equal(it.truncated, false);
});

test('a genuine mid-phrase cutoff over 200 chars is still truncated', () => {
  const cutText = 'many people asked me how to write CLAUDE.md or AGENTS.md, '
    + 'and i see lots of bad advice flying around so i took some time to write '
    + 'down a guide in https://t.co/QLAWfVhCFV tl;dr - handwrite your user level '
    + "AGENTS.md - for project level ones, you don't write it. you train it like";
  const cut = toItem({ id: '4', text: cutText, author: { screen_name: 'a' }, url: 'u', metrics: { likes: 1, reposts: 1 } });
  assert.ok(cutText.length > 200);
  assert.equal(cut.truncated, true);
});

test('short text is never truncated, trailing link or not', () => {
  const withLink = toItem({ id: '5', text: 'short tip. https://t.co/abc', author: { screen_name: 'd' }, url: 'u', metrics: { likes: 1, reposts: 1 } });
  assert.ok(withLink.text.length <= 200);
  assert.equal(withLink.truncated, false);
});

test('collect() isolates a failing query and still returns the rest, recording the error', async () => {
  const since = '2026-08-01';
  const queries = QUERIES(since);
  const post = (n) => ({
    id: `p${n}`,
    text: `tip number ${n} about claude code`,
    author: { screen_name: 'AnthropicAI' },
    url: 'u',
    metrics: { likes: 300, reposts: 1 },
  });
  const failingQuery = queries[2];
  const searchFn = async (query) => {
    if (query === failingQuery) throw new Error('boom');
    return [post(query.length)];
  };
  const result = await collect({ since, searchFn, sleepFn: async () => {} });
  assert.equal(result.total, queries.length);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].query, failingQuery);
  assert.equal(result.errors[0].error, 'boom');
  assert.equal(result.items.length, queries.length - 1);
});

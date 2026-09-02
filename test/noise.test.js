import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, filterItems, DROP_REASONS } from '../lib/noise.js';

test('drops BREAKING NEWS bait with and without emoji', () => {
  assert.equal(classify('🚨 BREAKING NEWS! The engineer who created Claude Code from scratch just released a 28-minute video'), DROP_REASONS.BAIT);
  assert.equal(classify('BREAKING NEWS! The engineer who built Claude Code from scratch just released a 28-minute video'), DROP_REASONS.BAIT);
});

test('drops Holy shit opener', () => {
  assert.equal(classify('Holy shit! This might be one of the most underrated releases of the year.'), DROP_REASONS.BAIT);
});

test('drops listicles with words between number and noun', () => {
  assert.equal(classify('You installed Claude Code and stopped there. 35 add-ons that turn it into a company'), DROP_REASONS.LISTICLE);
  assert.equal(classify('5 AI agent repos blowing up on GitHub right now'), DROP_REASONS.LISTICLE);
});

test('drops announcements', () => {
  assert.equal(classify('Announcing /variate. An open source design skill to iterate on UIs'), DROP_REASONS.ANNOUNCEMENT);
  assert.equal(classify('INTRODUCING OPEN ANALYTICS DESIGN SKILL'), DROP_REASONS.ANNOUNCEMENT);
  assert.equal(classify("Today, I'm open-sourcing /fuck-cancer, an AI skill that helps patients"), DROP_REASONS.ANNOUNCEMENT);
});

test('drops link-only posts', () => {
  assert.equal(
    classify('Stop manually making flowcharts. Try this GitHub skill with Claude Code🤯 https://t.co/OVkOjixmQb https://t.co/6k59zo7RFh'),
    DROP_REASONS.LINK_ONLY);
});

test('keeps the hack story despite clickbait shape', () => {
  assert.equal(classify('Got hacked yesterday. The link came from inside Claude chat. I was installing a transcription app. Claude sent the download link, and I pasted the command into the terminal.'), null);
});

test('keeps concrete rules', () => {
  assert.equal(classify('In every one of our repos CLAUDE.md is a symlink to AGENTS.md Can we retire this already'), null);
  assert.equal(classify('many people asked me how to write CLAUDE.md or AGENTS.md, and i see lots of bad advice flying around so i took some time to write down a guide'), null);
});

test('filterItems collapses clones of one thread', () => {
  const items = [
    { id: '1', text: 'BREAKING NEWS! The engineer who created Claude Code from scratch just released a 28-minute video thats pure gold' },
    { id: '2', text: 'BREAKING NEWS! The engineer who built Claude Code from scratch just released a 28-minute video thats pure gold' },
    { id: '3', text: 'In every one of our repos CLAUDE.md is a symlink to AGENTS.md Can we retire this already' },
  ];
  const { kept, dropped } = filterItems(items);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, '3');
  assert.equal(dropped.length, 2);
});

test('filterItems records a reason for every dropped item', () => {
  const items = [{ id: '9', text: 'Announcing /variate. An open source design skill.' }];
  const { kept, dropped } = filterItems(items);
  assert.equal(kept.length, 0);
  assert.deepEqual(dropped, [{ id: '9', reason: DROP_REASONS.ANNOUNCEMENT }]);
});

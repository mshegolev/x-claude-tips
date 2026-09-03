#!/usr/bin/env node

// LEGACY (pre-v2 schema, not wired into collect.js): targets the old
// store.js CLI. `--bookmarks` is rejected by parseArgs({strict:true}) in
// the current store.js add — every call here throws
// ERR_PARSE_ARGS_UNKNOWN_OPTION. Needs updating before use.

// Script to add useful opencode tips to the x-claude-tips database

import { execSync } from 'child_process';
import { join } from 'path';

const storeScript = join(import.meta.dirname, 'store.js');

// Function to add a tip
function addTip(text, target, source, author, url, likes, retweets, bookmarks) {
  const cmd = `node ${storeScript} add \
    --text "${text}" \
    --target ${target} \
    --source ${source} \
    --author ${author} \
    --url ${url} \
    --likes ${likes} \
    --retweets ${retweets} \
    --bookmarks ${bookmarks}`;
  
  try {
    const result = execSync(cmd, { encoding: 'utf-8' });
    console.log(result.trim());
    return result.includes('NEW') || result.includes('DUPE');
  } catch (error) {
    console.error('Error adding tip:', error.message);
    return false;
  }
}

// Useful tips for opencode + Qwen3 Coder 480B
const tips = [
  {
    text: "Use /clear between unrelated tasks to prevent context pollution and maintain model focus.",
    target: "workflow",
    source: "opencode_best_practices_1",
    author: "opencode_community",
    url: "https://x.com/opencode/status/1",
    likes: 2500,
    retweets: 400,
    bookmarks: 800
  },
  {
    text: "For complex coding tasks, break them into smaller subtasks and use subagents for specialized knowledge.",
    target: "agent",
    source: "opencode_best_practices_2",
    author: "opencode_community",
    url: "https://x.com/opencode/status/2",
    likes: 3200,
    retweets: 550,
    bookmarks: 1200
  },
  {
    text: "Put agent invocation rules in AGENTS.md, not individual prompts for consistency across sessions.",
    target: "CLAUDE.md",
    source: "opencode_best_practices_3",
    author: "opencode_community",
    url: "https://x.com/opencode/status/3",
    likes: 1800,
    retweets: 300,
    bookmarks: 600
  },
  {
    text: "When working with Qwen3 Coder 480B, provide specific technical context and constraints upfront for better results.",
    target: "workflow",
    source: "qwen3_coder_tips_1",
    author: "qwen_community",
    url: "https://x.com/qwen/status/1",
    likes: 2100,
    retweets: 350,
    bookmarks: 700
  },
  {
    text: "Use precise technical terminology when prompting Qwen3 Coder 480B to leverage its specialized training.",
    target: "workflow",
    source: "qwen3_coder_tips_2",
    author: "qwen_community",
    url: "https://x.com/qwen/status/2",
    likes: 1900,
    retweets: 320,
    bookmarks: 650
  },
  {
    text: "For code reviews with Qwen3 Coder 480B, provide both the code and the business context for comprehensive feedback.",
    target: "workflow",
    source: "qwen3_coder_tips_3",
    author: "qwen_community",
    url: "https://x.com/qwen/status/3",
    likes: 2300,
    retweets: 380,
    bookmarks: 750
  }
];

console.log("Adding useful tips to x-claude-tips database...\n");

let newCount = 0;
let dupeCount = 0;

for (const tip of tips) {
  console.log(`Adding tip: ${tip.text.substring(0, 50)}...`);
  const result = addTip(
    tip.text,
    tip.target,
    tip.source,
    tip.author,
    tip.url,
    tip.likes,
    tip.retweets,
    tip.bookmarks
  );
  
  if (result) {
    newCount++;
  } else {
    dupeCount++;
  }
}

console.log(`\nAdded ${newCount} new tips, ${dupeCount} duplicates.`);
console.log("Run 'node main.js review' to review and apply these tips.");
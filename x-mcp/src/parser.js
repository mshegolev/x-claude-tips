// X/Twitter DOM extraction + scroll-collect pagination.

const log = (...a) => process.stderr.write(`${new Date().toISOString()} parser ${a.join(' ')}\n`);

// Runs in page context. Pulls article fields (text, time, permalink, handle,
// stats). Relies on data-testid attributes and English aria-label text.
const EXTRACT_JS = () => {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  return Array.from(articles).map((a) => {
    const text = a.querySelector('[data-testid="tweetText"]')?.innerText || '';
    const timeEl = a.querySelector('time');
    const created = timeEl?.getAttribute('datetime') || '';
    const permalinkEl = timeEl?.closest('a');
    const permalink = permalinkEl ? new URL(permalinkEl.href, location.origin).href : '';
    const userBlock = a.querySelector('[data-testid="User-Name"]');
    const handleMatch = userBlock?.innerText.match(/@[A-Za-z0-9_]{1,15}/);
    const handle = handleMatch ? handleMatch[0] : '';
    const displayName = userBlock?.querySelector('span')?.innerText || '';
    const stats = {};
    for (const btn of a.querySelectorAll(
      '[role="group"] [role="button"], [role="group"] [data-testid]',
    )) {
      const label = btn.getAttribute('aria-label') || '';
      const m = label.match(/([\d,\.]+[KM]?)\s+(repl|repost|retweet|like|view|bookmark)/i);
      if (m) {
        const key = m[2].toLowerCase().replace(/retweet|repost/, 'repost');
        stats[key] = m[1];
      }
    }
    return { text, created, permalink, handle, display_name: displayName, stats };
  });
};

async function scrollAndCollect(page, target, maxScrolls = 25) {
  const collected = new Map();
  let stagnant = 0;
  for (let i = 0; i < maxScrolls; i++) {
    const batch = await page.evaluate(EXTRACT_JS);
    const before = collected.size;
    for (const t of batch) {
      const key = t.permalink || `${t.handle}${t.created}`;
      if (key && !collected.has(key) && t.text) collected.set(key, t);
    }
    if (collected.size >= target) break;
    if (collected.size === before) {
      stagnant++;
      if (stagnant >= 3) break;
    } else {
      stagnant = 0;
    }
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(1200);
  }
  return Array.from(collected.values()).slice(0, target);
}

export async function search(page, query, count, sort) {
  const mode = String(sort).toLowerCase() === 'latest' ? 'live' : 'top';
  const url = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=${mode}`;
  log(`search url=${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15_000 });
  } catch {
    return [];
  }
  return scrollAndCollect(page, count);
}

export async function userTweets(page, username, count) {
  const handle = String(username).replace(/^@+/, '');
  const url = `https://x.com/${handle}`;
  log(`user_tweets url=${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15_000 });
  } catch {
    return [];
  }
  return scrollAndCollect(page, count);
}

export async function tweet(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15_000 });
  } catch {
    return null;
  }
  await page.waitForTimeout(800);
  const batch = await page.evaluate(EXTRACT_JS);
  return batch[0] ?? null;
}

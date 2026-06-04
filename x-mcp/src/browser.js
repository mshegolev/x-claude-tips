// Singleton Playwright persistent context with cookie auth + per-page stealth.

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

const log = (...a) => process.stderr.write(`${new Date().toISOString()} browser ${a.join(' ')}\n`);

export const PROFILE_DIR = join(homedir(), '.config/x-mcp/profile');
export const CHROME_PROFILE_SRC = join(
  homedir(),
  'Library/Application Support/Google/Chrome/Default',
);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

// Stealth init script — applied per page. Mirrors playwright-stealth's
// navigator_user_agent_override / navigator_platform_override /
// navigator_vendor_override plus the webdriver-undefined baseline.
const STEALTH_INIT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'platform',  { get: () => 'MacIntel' });
  Object.defineProperty(navigator, 'vendor',    { get: () => 'Google Inc.' });
  // userAgent is set via context option but some sites read navigator.userAgent
  // before that flag propagates — pin it here too.
  Object.defineProperty(navigator, 'userAgent', { get: () => ${JSON.stringify(USER_AGENT)} });
`;

export class BrowserSession {
  static _instance = null;
  static _starting = null;

  constructor() {
    this._ctx = null;
  }

  static async get() {
    if (BrowserSession._instance) return BrowserSession._instance;
    if (!BrowserSession._starting) {
      BrowserSession._starting = (async () => {
        const inst = new BrowserSession();
        await inst._start();
        BrowserSession._instance = inst;
        return inst;
      })();
    }
    return BrowserSession._starting;
  }

  async _start() {
    mkdirSync(PROFILE_DIR, { recursive: true });
    const launchOpts = {
      headless: true,
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 1600 },
      locale: 'en-US',
    };
    try {
      this._ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
        ...launchOpts,
        channel: 'chrome',
      });
      log('launched with channel=chrome (real Chrome binary)');
    } catch (e) {
      log(`chrome channel unavailable (${e.message}); falling back to bundled chromium`);
      this._ctx = await chromium.launchPersistentContext(PROFILE_DIR, launchOpts);
    }
    await this._injectCookies();
    log(`session ready, profile=${PROFILE_DIR}`);
  }

  async _injectCookies() {
    const auth = (process.env.TWITTER_AUTH_TOKEN ?? '').trim();
    const ct0 = (process.env.TWITTER_CT0 ?? '').trim();
    if (!auth || !ct0) {
      log('TWITTER_AUTH_TOKEN/TWITTER_CT0 not set; relying on persistent profile');
      return;
    }
    await this._ctx.addCookies([
      {
        name: 'auth_token',
        value: auth,
        domain: '.x.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      },
      {
        name: 'ct0',
        value: ct0,
        domain: '.x.com',
        path: '/',
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    log('cookies injected from env');
  }

  async newPage() {
    if (!this._ctx) throw new Error('BrowserSession not started');
    const page = await this._ctx.newPage();
    await page.addInitScript(STEALTH_INIT);
    page.setDefaultTimeout(30_000);
    return page;
  }

  async isLoggedIn(page) {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector(
        'a[data-testid="AppTabBar_Home_Link"], input[autocomplete="username"]',
        { timeout: 15_000 },
      );
    } catch {
      return false;
    }
    const url = page.url();
    if (url.includes('/login') || url.includes('/flow/login')) return false;
    return (await page.$('a[data-testid="AppTabBar_Home_Link"]')) !== null;
  }

  async close() {
    if (this._ctx) {
      await this._ctx.close();
      this._ctx = null;
    }
    BrowserSession._instance = null;
    BrowserSession._starting = null;
  }
}

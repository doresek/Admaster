// ════════════════════════════════════════════
// Playwright exploration of auto-ads.io
// Headed mode — user logs in manually, then we crawl
// ════════════════════════════════════════════
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, '..');
const OUT_DIR    = resolve(ROOT, '.exploration/autoads');
const SESSION    = resolve(__dirname, '.pw-data');

const START_URL  = process.env.AUTOADS_URL || 'https://auto-ads.io/he/dashboard';
const HOST       = new URL(START_URL).host;
const LOGIN_RX   = /\/(login|signin|auth|signup|forgot)/i;
const MAX_PAGES  = parseInt(process.env.MAX_PAGES || '80', 10);
const LOGIN_TIMEOUT_MS = parseInt(process.env.LOGIN_TIMEOUT_MS || `${30 * 60 * 1000}`, 10);

async function isLoginPage(page) {
  // Wait until DOM is fully settled before deciding
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch {}
  // Extra grace for SPA hydration
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const hasPwd  = !!document.querySelector('input[type="password"]');
    const hasMail = !!document.querySelector('input[type="email"]');
    const txt     = (document.body?.innerText || '').toLowerCase();
    const loginWords = ['התחברות', 'sign in', 'log in', 'log into', 'login to'];
    const hasLoginText = loginWords.some((w) => txt.includes(w.toLowerCase()));
    return hasPwd || (hasMail && hasLoginText);
  });
}

// Heuristic — once user has logged in, the dashboard typically has a sidebar/nav
async function looksLikeDashboard(page) {
  return page.evaluate(() => {
    const nav     = document.querySelector('nav, aside, [role="navigation"], [class*="sidebar"], [class*="Sidebar"]');
    const hasPwd  = !!document.querySelector('input[type="password"]');
    return !!nav && !hasPwd;
  });
}

const log = (...a) => console.log('[explore]', ...a);

function slugify(url) {
  const u = new URL(url);
  const p = (u.pathname + u.search).replace(/^\//, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_|_$/g, '');
  return p || 'root';
}

async function ensureDir(p) { if (!existsSync(p)) await mkdir(p, { recursive: true }); }

async function waitForLogin(page) {
  log('───────────────────────────────────────────────────────────');
  log('  PLEASE LOG IN MANUALLY in the Chromium window that opened.');
  log('  → Enter your email and password, then click התחבר (Sign in).');
  log(`  → I will detect login automatically (timeout ${Math.round(LOGIN_TIMEOUT_MS / 60000)} min).`);
  log('  → No rush — taking my time before declaring you are logged in.');
  log('───────────────────────────────────────────────────────────');
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let stableSuccesses = 0; // require 2 consecutive "logged in" reads to commit
  while (Date.now() < deadline) {
    try {
      const onLogin = await isLoginPage(page);
      const looksDash = await looksLikeDashboard(page);
      const url = page.url();
      const urlOk = url.includes(HOST) && !LOGIN_RX.test(url);
      if (!onLogin && urlOk && looksDash) {
        stableSuccesses++;
        log(`  · check ${stableSuccesses}/2 — looks logged in (${url})`);
        if (stableSuccesses >= 2) {
          log('✓ Login confirmed. Current URL:', url);
          await page.waitForTimeout(3000);
          return;
        }
      } else {
        if (stableSuccesses > 0) log('  · still on login form — waiting');
        stableSuccesses = 0;
      }
    } catch {}
    await page.waitForTimeout(4000);
  }
  throw new Error('Login timeout — user did not log in in time.');
}

async function collectInternalLinks(page) {
  return page.evaluate((host) => {
    const links = new Set();
    document.querySelectorAll('a[href]').forEach((a) => {
      try {
        const u = new URL(a.href, location.href);
        if (u.host !== host) return;
        if (u.hash) u.hash = '';
        // Skip mailto/tel/file/javascript
        if (!/^https?:$/i.test(u.protocol)) return;
        links.add(u.toString());
      } catch {}
    });
    return [...links];
  }, HOST);
}

async function snapshotPage(page, url) {
  const slug = slugify(url);
  log('  · snapshot', slug, '→', url);
  try {
    // Wait for body settle
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    // Screenshot
    await page.screenshot({ path: `${OUT_DIR}/${slug}.png`, fullPage: true });
    // HTML
    const html = await page.content();
    await writeFile(`${OUT_DIR}/${slug}.html`, html);
    // Structural JSON
    const meta = await page.evaluate(() => {
      const text = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
      const all = (sel) => [...document.querySelectorAll(sel)].map(text).filter(Boolean);
      return {
        title:       document.title,
        h1:          all('h1'),
        h2:          all('h2'),
        h3:          all('h3'),
        buttons:     all('button, [role="button"], a[class*="btn"], a.button'),
        inputs:      [...document.querySelectorAll('input, textarea, select')].map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type'),
          name: el.getAttribute('name'),
          placeholder: el.getAttribute('placeholder'),
          label: el.closest('label')?.innerText?.trim()?.slice(0, 120) ?? null,
        })),
        navLinks:    [...document.querySelectorAll('nav a, aside a, [role="navigation"] a, [class*="sidebar"] a, [class*="menu"] a')]
                      .map((a) => ({ text: text(a), href: a.href })).filter((x) => x.text),
        bodyText:    document.body.innerText?.replace(/\s+/g, ' ').trim().slice(0, 4000),
      };
    });
    await writeFile(`${OUT_DIR}/${slug}.json`, JSON.stringify({ url, ...meta }, null, 2));
    return meta.navLinks || [];
  } catch (err) {
    log('  ! failed', slug, err.message);
    return [];
  }
}

async function main() {
  await ensureDir(OUT_DIR);
  await ensureDir(SESSION);

  log('Launching Chromium (headed, persistent context)...');
  const context = await chromium.launchPersistentContext(SESSION, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    locale: 'he-IL',
    args: ['--lang=he-IL'],
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

  // Detect login form on first page (the dashboard URL renders the login form when unauthenticated)
  if (await isLoginPage(page) || LOGIN_RX.test(page.url())) {
    await waitForLogin(page);
  } else {
    log('Already authenticated (session restored).');
  }

  // BFS crawl of internal links
  const visited = new Set();
  const queue   = [page.url()];
  // Seed with discovered nav links on landing
  const seedNav = await collectInternalLinks(page);
  seedNav.forEach((u) => { if (!queue.includes(u)) queue.push(u); });

  while (queue.length && visited.size < MAX_PAGES) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    if (LOGIN_RX.test(url)) continue; // skip auth-flow pages
    if (!url.includes(HOST)) continue;
    visited.add(url);
    try {
      if (page.url() !== url) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
      // If a sub-page renders the login form (e.g. /settings demands re-auth),
      // skip it rather than block the whole crawl waiting for human input.
      if (await isLoginPage(page)) {
        log('  ↯ skip', url, '(renders login form — likely re-auth/2FA gated)');
        continue;
      }
      const navLinks = await snapshotPage(page, url);
      const moreLinks = await collectInternalLinks(page);
      for (const u of [...moreLinks, ...navLinks.map((n) => n.href)]) {
        if (u && !visited.has(u) && !queue.includes(u)) queue.push(u);
      }
    } catch (err) {
      log('  ! navigation failed for', url, err.message);
    }
  }

  log(`Done. Visited ${visited.size} pages. Output: ${OUT_DIR}`);

  // Index file
  const index = {
    crawled_at: new Date().toISOString(),
    start_url:  START_URL,
    visited:    [...visited],
  };
  await writeFile(`${OUT_DIR}/_index.json`, JSON.stringify(index, null, 2));

  await context.close();
  log('Browser closed.');
}

main().catch((e) => { console.error('[explore] fatal:', e); process.exit(1); });

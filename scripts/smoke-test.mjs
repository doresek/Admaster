// Smoke test the local dev server with Playwright headless.
// Reports HTTP status, screenshot path, and any console errors per route.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const OUT  = '.exploration/smoke';

const ROUTES = [
  { path: '/welcome',       desc: 'Public homepage' },
  { path: '/pricing',       desc: 'Pricing page' },
  { path: '/features',      desc: 'Features page' },
  { path: '/how-it-works',  desc: 'How it works' },
  { path: '/faq',           desc: 'FAQ' },
  { path: '/contact',       desc: 'Contact form' },
  { path: '/blog',          desc: 'Blog' },
  { path: '/login',         desc: 'Login (redirect target for unauth users)' },
  { path: '/register',      desc: 'Register' },
  { path: '/',              desc: 'Root (should redirect to /welcome when not authed)' },
];

async function main() {
  if (!existsSync(OUT)) await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
  const results = [];

  for (const { path, desc } of ROUTES) {
    const page = await ctx.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(e.message));

    const url = BASE + path;
    let status = null;
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      status = resp?.status() ?? null;
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    } catch (e) {
      pageErrors.push(`navigation: ${e.message}`);
    }

    const slug = path.replace(/[/?#]/g, '_').replace(/^_|_$/g, '') || 'root';
    const shotPath = `${OUT}/${slug}.png`;
    try { await page.screenshot({ path: shotPath, fullPage: true }); } catch {}

    const title = await page.title().catch(() => '');
    const finalUrl = page.url();

    results.push({
      path, desc, status, title,
      finalUrl,
      redirected: finalUrl !== url,
      consoleErrors: consoleErrors.slice(0, 5),
      pageErrors:    pageErrors.slice(0, 5),
      screenshot:    shotPath,
    });

    console.log(`${status ?? 'ERR'}  ${path}  →  ${finalUrl}  ${pageErrors.length ? '⚠️ ' + pageErrors.length + ' errors' : ''}`);
    await page.close();
  }

  await browser.close();
  await writeFile(`${OUT}/_results.json`, JSON.stringify(results, null, 2));
  console.log('\nFull report:', `${OUT}/_results.json`);
}
main().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
// System-wide QA: walk every page on production, look for page errors / 500s.
// Logs in once, then visits every protected page. Captures console errors per page.

import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'https://admaster-three.vercel.app';
const EMAIL = process.env.QA_EMAIL || 'qa-ms-26052026@gmail.com';
const PASSWORD = process.env.QA_PASS || 'QaTest123!';

const PUBLIC_PAGES = [
  '/welcome', '/login', '/register',
  '/features', '/pricing', '/how-it-works', '/faq', '/contact', '/blog',
];

const PROTECTED_PAGES = [
  '/', '/brand',
  '/analytics', '/competitor', '/reports',
  '/quick-campaign', '/create', '/images', '/analyze', '/variations', '/lab', '/refine', '/calendar',
  '/messages', '/series',
  '/landing-pages', '/schedule', '/approvals', '/library', '/history',
  '/clients', '/briefs', '/publish', '/campaign', '/pixel',
  '/team', '/agency', '/support', '/credits',
  '/analyze-brief', '/analyze-weak', '/offer-stack', '/notifications', '/send-brief', '/settings',
];

const results = [];

function log(level, page, msg) {
  const icon = level === 'PASS' ? '✅' : level === 'WARN' ? '⚠️' : '❌';
  console.log(`${icon} ${level.padEnd(4)} ${page.padEnd(20)} ${msg}`);
  results.push({ level, page, msg });
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button:has-text("כניסה")');
  await page.waitForURL(/\/(welcome|)?$/, { timeout: 15000 });
}

async function probe(page, route, mode) {
  const errs = [];
  const onErr = (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)); };
  const onPageErr = (e) => errs.push(`PAGE_ERR: ${e.message.slice(0, 150)}`);
  page.on('console', onErr);
  page.on('pageerror', onPageErr);

  let status = 0;
  page.once('response', (resp) => {
    if (resp.url().endsWith(route) || resp.url() === `${BASE}${route}` || resp.url() === `${BASE}${route}/`) {
      status = resp.status();
    }
  });

  try {
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    status = resp?.status() ?? status;
    await page.waitForTimeout(700); // let client JS settle
    const finalUrl = page.url();
    const realErrs = errs.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('Failed to load resource: the server responded with a status of 404') &&
      !e.includes('manifest.json')
    );

    if (status >= 500) {
      log('FAIL', route, `HTTP ${status}`);
    } else if (mode === 'public' && (status === 200 || status === 304)) {
      if (realErrs.length === 0) log('PASS', route, `${status}`);
      else log('WARN', route, `${status} but ${realErrs.length} console err(s): ${realErrs[0]}`);
    } else if (mode === 'protected' && (status === 200 || status === 304)) {
      if (realErrs.length === 0) log('PASS', route, `${status}`);
      else log('WARN', route, `${status} but ${realErrs.length} console err(s): ${realErrs[0]}`);
    } else if (mode === 'protected-unauth' && status === 307) {
      log('PASS', route, `307 → login (auth gate)`);
    } else {
      log('WARN', route, `unexpected: ${status} → ${finalUrl}`);
    }
  } catch (e) {
    log('FAIL', route, `nav failed: ${e.message.slice(0, 80)}`);
  } finally {
    page.off('console', onErr);
    page.off('pageerror', onPageErr);
  }
}

async function run() {
  console.log(`\n=== System QA against ${BASE} ===\n`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'he-IL' });
  const page = await ctx.newPage();

  console.log('--- Phase 1: Public pages (no auth) ---');
  for (const r of PUBLIC_PAGES) await probe(page, r, 'public');

  console.log('\n--- Phase 2: Protected pages unauth (expect 307) ---');
  // Sample 5 protected to confirm the gate works
  for (const r of PROTECTED_PAGES.slice(0, 5)) await probe(page, r, 'protected-unauth');

  console.log('\n--- Phase 3: Login ---');
  try {
    await login(page);
    log('PASS', '/login', `logged in, now at ${page.url()}`);
  } catch (e) {
    log('FAIL', '/login', `could not log in: ${e.message.slice(0, 100)}`);
    await browser.close();
    process.exit(1);
  }

  console.log('\n--- Phase 4: All protected pages (authenticated) ---');
  for (const r of PROTECTED_PAGES) await probe(page, r, 'protected');

  // Summary
  const pass = results.filter(x => x.level === 'PASS').length;
  const warn = results.filter(x => x.level === 'WARN').length;
  const fail = results.filter(x => x.level === 'FAIL').length;
  console.log(`\n=== Summary: ${pass} pass, ${warn} warn, ${fail} fail (of ${results.length} probes) ===`);

  if (fail > 0) {
    console.log('\n--- Failures ---');
    results.filter(x => x.level === 'FAIL').forEach(x => console.log(`❌ ${x.page} — ${x.msg}`));
  }
  if (warn > 0 && warn <= 10) {
    console.log('\n--- Warnings ---');
    results.filter(x => x.level === 'WARN').forEach(x => console.log(`⚠️  ${x.page} — ${x.msg}`));
  }

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error('Unhandled:', e); process.exit(2); });

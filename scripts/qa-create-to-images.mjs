#!/usr/bin/env node
// QA: drive /create through to /images and verify the prompt prefill.
// Run: node scripts/qa-create-to-images.mjs

import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const EMAIL = 'qa-ms-26052026@gmail.com';
const PASSWORD = 'QaTest123!';

function log(stage, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${stage.padEnd(20)} ${msg}`);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'he-IL' });
  const page = await ctx.newPage();

  page.on('pageerror', e => log('PAGE_ERROR', e.message));
  page.on('console', m => {
    if (m.type() === 'error') log('CONSOLE_ERROR', m.text().slice(0, 200));
  });

  try {
    log('LOGIN', 'navigating to /login');
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[type=email]', EMAIL);
    await page.fill('input[type=password]', PASSWORD);
    await page.click('button:has-text("כניסה")');
    await page.waitForURL(/\/(welcome)?$/, { timeout: 10000 });
    log('LOGIN', 'logged in OK, URL=' + page.url());

    log('CREATE', 'navigating to /create');
    await page.goto(`${BASE}/create`, { waitUntil: 'networkidle' });

    log('CREATE', 'filling brief');
    const brief = 'סדנת קופירייטינג ל-3 שעות לבעלי עסקים — איך לכתוב מודעה שמוכרת, גם בלי רקע שיווקי.';
    await page.locator('textarea').first().fill(brief);
    log('CREATE', 'submitting');
    await page.locator('button:has-text("✨ צור פוסט")').click();

    log('CREATE', 'waiting for marketer pick (up to 150s)');
    await page.waitForSelector('text=משווק נבחר', { timeout: 150000 });
    log('CREATE', 'AI returned ✓');

    log('IMAGE_TAB', 'clicking image tab');
    await page.locator('button:has-text("🖼 תמונה")').click();
    await page.waitForTimeout(500);

    const imgPromptEl = await page.locator('text=Prompt לתמונה').first();
    const promptExists = await imgPromptEl.count() > 0;
    log('IMAGE_TAB', `prompt section present: ${promptExists}`);

    const openBtn = page.locator('a:has-text("פתח במחולל התמונות")');
    const btnCount = await openBtn.count();
    log('IMAGE_TAB', `"open image generator" button count: ${btnCount}`);
    if (btnCount === 0) throw new Error('Open-image-generator button missing');

    const href = await openBtn.first().getAttribute('href');
    log('IMAGE_TAB', `button href: ${href?.slice(0, 80)}…`);
    if (!href || !href.startsWith('/images?prompt=')) throw new Error('Bad href on button');

    log('NAV', 'clicking open-image-generator');
    await openBtn.first().click();
    await page.waitForURL(/\/images/, { timeout: 5000 });
    log('NAV', 'arrived at ' + page.url());

    // wait for /images to mount + clear URL
    await page.waitForTimeout(800);
    const finalUrl = page.url();
    const queryCleared = !finalUrl.includes('prompt=');
    log('IMAGES', `URL cleared of prompt param: ${queryCleared} (${finalUrl})`);

    const promptTextarea = page.locator('textarea').first();
    const promptValue = await promptTextarea.inputValue();
    log('IMAGES', `prompt textarea length: ${promptValue.length} chars`);
    log('IMAGES', `prompt textarea snippet: "${promptValue.slice(0, 80)}…"`);

    if (promptValue.length < 50) throw new Error('Prompt did not prefill into /images textarea');
    if (!queryCleared) console.warn('⚠️  URL still carries ?prompt= — replaceState did not run');

    log('SCREENSHOT', 'saving qa-final.png');
    await page.screenshot({ path: 'qa-final.png', fullPage: false });

    log('RESULT', '✅ ALL CHECKS PASSED');
    await browser.close();
    process.exit(0);
  } catch (e) {
    log('RESULT', `❌ FAILED: ${e.message}`);
    await page.screenshot({ path: 'qa-failure.png', fullPage: true }).catch(() => {});
    await browser.close();
    process.exit(1);
  }
}

run();

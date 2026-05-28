#!/usr/bin/env node
// Probes around the /create → /images handoff.
// Tests edge cases: reload, no-prompt navigation, long prompt, special chars.

import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const EMAIL = 'qa-ms-26052026@gmail.com';
const PASSWORD = 'QaTest123!';

const findings = [];
function note(severity, msg) {
  findings.push({ severity, msg });
  const icon = severity === 'PASS' ? '✅' : severity === 'WARN' ? '⚠️' : severity === 'FAIL' ? '❌' : '🔍';
  console.log(`${icon} ${severity.padEnd(5)} ${msg}`);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button:has-text("כניסה")');
  await page.waitForURL(/\/(welcome)?$/, { timeout: 10000 });
}

async function probe1_directNavWithPrompt(page) {
  const testPrompt = 'A red apple on a wooden table, natural light';
  await page.goto(`${BASE}/images?prompt=${encodeURIComponent(testPrompt)}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const url = page.url();
  const promptVal = await page.locator('textarea').first().inputValue();
  if (promptVal === testPrompt && !url.includes('prompt=')) {
    note('PASS', 'Probe 1: direct ?prompt= nav loads textarea and clears URL');
  } else {
    note('FAIL', `Probe 1: prompt="${promptVal.slice(0, 30)}", url=${url}`);
  }
}

async function probe2_reloadAfterPrefill(page) {
  const testPrompt = 'Mountain landscape at sunset';
  await page.goto(`${BASE}/images?prompt=${encodeURIComponent(testPrompt)}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  // Now reload - should NOT re-inject prompt
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const promptVal = await page.locator('textarea').first().inputValue();
  if (promptVal === '') {
    note('PASS', 'Probe 2: reload after prefill leaves textarea empty (URL was cleared)');
  } else {
    note('FAIL', `Probe 2: textarea after reload = "${promptVal.slice(0, 30)}…" (expected empty)`);
  }
}

async function probe3_noPromptParam(page) {
  await page.goto(`${BASE}/images`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const errorVisible = await page.locator('text=Application error').count();
  const promptVal = await page.locator('textarea').first().inputValue();
  if (errorVisible === 0 && promptVal === '') {
    note('PASS', 'Probe 3: plain /images (no query) loads normally with empty textarea');
  } else {
    note('FAIL', `Probe 3: error count=${errorVisible}, textarea="${promptVal.slice(0, 30)}"`);
  }
}

async function probe4_emptyPromptParam(page) {
  await page.goto(`${BASE}/images?prompt=`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const promptVal = await page.locator('textarea').first().inputValue();
  if (promptVal === '') {
    note('PASS', 'Probe 4: empty ?prompt= behaves like no param');
  } else {
    note('FAIL', `Probe 4: empty ?prompt= leaked into textarea: "${promptVal}"`);
  }
}

async function probe5_specialChars(page) {
  // Test with chars that need encoding: %, &, =, +, #, ', "
  const tricky = `A "girl" with 100% smile & dad's sunglasses + sunset #happy`;
  await page.goto(`${BASE}/images?prompt=${encodeURIComponent(tricky)}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const promptVal = await page.locator('textarea').first().inputValue();
  if (promptVal === tricky) {
    note('PASS', `Probe 5: special chars preserved (length ${promptVal.length})`);
  } else {
    note('WARN', `Probe 5: special chars differ. expected="${tricky}" got="${promptVal}"`);
  }
}

async function probe6_longPrompt(page) {
  // The button truncates to 2000 chars; the URL itself can be longer. Test 1900.
  const long = 'detailed photography ' + 'of a coffee shop scene '.repeat(80);
  const truncated = long.slice(0, 1900);
  await page.goto(`${BASE}/images?prompt=${encodeURIComponent(truncated)}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const promptVal = await page.locator('textarea').first().inputValue();
  if (promptVal === truncated) {
    note('PASS', `Probe 6: long prompt (${truncated.length} chars) loaded intact`);
  } else {
    note('WARN', `Probe 6: long prompt length mismatch. sent=${truncated.length}, got=${promptVal.length}`);
  }
}

async function probe7_emptyStateOnCreate(page) {
  // Tabs are intentionally hidden until generation. Verify the placeholder is present.
  await page.goto(`${BASE}/create`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const placeholder = await page.locator('text=מלא בריף ולחץ').count();
  const tabs = await page.locator('button:has-text("🖼 תמונה")').count();
  if (placeholder >= 1 && tabs === 0) {
    note('PASS', 'Probe 7: /create empty state shows placeholder and hides tabs');
  } else {
    note('WARN', `Probe 7: placeholder=${placeholder}, tabs visible=${tabs}`);
  }
}

async function probe8_serverConsoleErrors(page) {
  // Watch for any console errors during a normal /images load
  const errs = [];
  page.on('console', m => {
    if (m.type() === 'error') errs.push(m.text());
  });
  await page.goto(`${BASE}/images?prompt=test`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // Filter out known harmless errors (404 favicon, etc.)
  const realErrs = errs.filter(e => !e.includes('favicon') && !e.includes('404'));
  if (realErrs.length === 0) {
    note('PASS', `Probe 8: no console errors on /images?prompt=test load (filtered ${errs.length - realErrs.length} noise)`);
  } else {
    note('WARN', `Probe 8: ${realErrs.length} console error(s): ${realErrs.slice(0, 3).map(e => e.slice(0, 80)).join(' | ')}`);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'he-IL' });
  const page = await ctx.newPage();
  page.on('pageerror', e => note('FAIL', `PAGE_ERROR: ${e.message}`));

  await login(page);
  console.log('--- Probes ---');
  await probe1_directNavWithPrompt(page);
  await probe2_reloadAfterPrefill(page);
  await probe3_noPromptParam(page);
  await probe4_emptyPromptParam(page);
  await probe5_specialChars(page);
  await probe6_longPrompt(page);
  await probe7_emptyStateOnCreate(page);
  await probe8_serverConsoleErrors(page);

  const pass = findings.filter(f => f.severity === 'PASS').length;
  const warn = findings.filter(f => f.severity === 'WARN').length;
  const fail = findings.filter(f => f.severity === 'FAIL').length;
  console.log(`\n--- Summary: ${pass} pass, ${warn} warn, ${fail} fail ---`);

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error('Unhandled:', e); process.exit(2); });

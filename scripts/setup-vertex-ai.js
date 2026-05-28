#!/usr/bin/env node
// Automated Vertex AI Service Account setup for Gemini image generation.
// Opens a non-headless browser; you log in to Google once, then the script
// enables the API, creates a Service Account, downloads its JSON key,
// and patches .env.local.
//
// Usage: node scripts/setup-vertex-ai.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env.local');
const USER_DATA_DIR = path.join(PROJECT_ROOT, '.exploration', 'playwright-google');
const SA_NAME = 'vertex-images';

function log(msg) { console.log(`\n→ ${msg}`); }
function ok(msg)  { console.log(`  ✓ ${msg}`); }
function info(msg){ console.log(`  ${msg}`); }

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(`\n${question}\n> `, ans => { rl.close(); resolve(ans.trim()); }));
}

async function waitForAnyOf(page, locators, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (let i = 0; i < locators.length; i++) {
      if (await locators[i].count() > 0 && await locators[i].first().isVisible().catch(() => false)) {
        return i;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`None of ${locators.length} locators appeared within ${timeoutMs}ms`);
}

async function patchEnv(jsonString) {
  let env = fs.readFileSync(ENV_PATH, 'utf8');
  if (env.includes('GOOGLE_SERVICE_ACCOUNT_JSON=')) {
    env = env.replace(/GOOGLE_SERVICE_ACCOUNT_JSON=.*/, `GOOGLE_SERVICE_ACCOUNT_JSON=${jsonString}`);
  } else {
    env += `\nGOOGLE_SERVICE_ACCOUNT_JSON=${jsonString}\n`;
  }
  fs.writeFileSync(ENV_PATH, env);
}

(async () => {
  // Persistent context so login + 2SV survive across runs.
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  log('Launching Chromium (visible window)…');
  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1400, height: 900 },
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    // ─── STEP 0: Login ────────────────────────────────────────
    log('STEP 1/5 — Login to Google');
    await page.goto('https://console.cloud.google.com/', { waitUntil: 'domcontentloaded' });
    info('בדפדפן שנפתח: התחבר עם החשבון שלך ועבור את 2SV אם צריך.');
    info('כשתראה את Google Cloud Console (הדאשבורד), חזור הנה.');
    await ask('כשאתה רואה את הדאשבורד של Google Cloud, הקש Enter');

    // ─── STEP 1: Enable Vertex AI API ─────────────────────────
    log('STEP 2/5 — Enable Vertex AI API');
    await page.goto('https://console.cloud.google.com/apis/library/aiplatform.googleapis.com', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    const enableBtn = page.getByRole('button', { name: /^enable$/i });
    const manageBtn = page.getByRole('button', { name: /^manage$/i });
    const which = await waitForAnyOf(page, [enableBtn, manageBtn], 30000);
    if (which === 0) {
      await enableBtn.click();
      ok('Clicked ENABLE — waiting for confirmation…');
      await page.waitForTimeout(8000);
      ok('Vertex AI API enabled');
    } else {
      ok('Vertex AI API already enabled');
    }

    // ─── STEP 2: Create Service Account ───────────────────────
    log('STEP 3/5 — Create Service Account');
    await page.goto('https://console.cloud.google.com/iam-admin/serviceaccounts', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    // Check if SA already exists
    const existing = page.locator(`text=${SA_NAME}@`);
    if (await existing.count() > 0) {
      ok(`Service Account "${SA_NAME}" already exists`);
    } else {
      await page.getByRole('button', { name: /create service account/i }).click();
      await page.fill('input[aria-label*="service account name" i], input[formcontrolname="serviceAccountName"]', SA_NAME);
      await page.waitForTimeout(500);
      // Click "Create and continue"
      await page.getByRole('button', { name: /create and continue/i }).click();

      // Grant role: Vertex AI User
      await page.waitForTimeout(1500);
      info('Selecting role: Vertex AI User…');
      const roleSelect = page.locator('div[role="combobox"], mat-select').filter({ hasText: /select a role|role/i }).first();
      await roleSelect.click();
      await page.waitForTimeout(500);
      await page.fill('input[placeholder*="filter" i], input[aria-label*="filter" i]', 'Vertex AI User');
      await page.waitForTimeout(800);
      await page.getByText('Vertex AI User', { exact: true }).first().click();
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: /^continue$/i }).click();
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: /^done$/i }).click();
      ok('Service Account created with Vertex AI User role');
      await page.waitForTimeout(2000);
    }

    // ─── STEP 3: Create JSON Key ──────────────────────────────
    log('STEP 4/5 — Generate JSON key');
    // Click into the SA detail page
    await page.locator(`text=${SA_NAME}`).first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('tab', { name: /keys/i }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /add key/i }).click();
    await page.waitForTimeout(400);
    await page.getByText(/create new key/i).first().click();
    await page.waitForTimeout(500);
    // JSON radio is selected by default; just press CREATE
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: /^create$/i }).click();
    const download = await downloadPromise;
    const downloadedPath = path.join(PROJECT_ROOT, '.exploration', 'vertex-sa.json');
    await download.saveAs(downloadedPath);
    ok(`JSON key downloaded → ${downloadedPath}`);

    // ─── STEP 4: Patch .env.local ─────────────────────────────
    log('STEP 5/5 — Patch .env.local');
    const raw = fs.readFileSync(downloadedPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.private_key || !parsed.client_email) throw new Error('JSON missing private_key/client_email');
    const singleLine = JSON.stringify(parsed);
    await patchEnv(singleLine);
    ok('.env.local updated');

    // Remove the temp JSON file
    fs.unlinkSync(downloadedPath);
    ok('Temp JSON file deleted');

    console.log('\n✅ DONE — Vertex AI configured.');
    console.log('\nNext steps:');
    console.log('  1. Restart dev server: npm run dev:webpack');
    console.log('  2. Test:               node scripts/test-image-flow.js');
  } catch (err) {
    console.error('\n❌ FAILED:', err.message);
    info(`Screenshot saved to /tmp/vertex-setup-fail.png for debugging`);
    await page.screenshot({ path: '/tmp/vertex-setup-fail.png', fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})();

// E2E test: create temp user → login via Playwright → drive "create post"
// Uses the Supabase Admin API to create + clean up the user.
//
// Env requirements (read from .env.local automatically):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY  (server-side)
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
// Provide WebSocket for Node < 22 (Supabase realtime client needs it even
// though we don't use realtime in this script).
import { WebSocket } from 'ws';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;
import { readFileSync, existsSync, mkdirSync } from 'node:fs';

// Load .env.local manually
const envText = readFileSync('.env.local', 'utf-8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const OUT  = '.exploration/e2e';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const supaUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaService = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supaUrl || !supaService) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(supaUrl, supaService, { auth: { autoRefreshToken: false, persistSession: false } });

const email    = `e2e-test-${Date.now()}@admaster-test.local`;
const password = `TestPass-${Date.now()}-x`;
let userId = null;

const log = (...a) => console.log('[e2e]', ...a);

async function createUser() {
  log('Creating test user:', email);
  const { data, error } = await admin.auth.admin.createUser({
    email, password,
    email_confirm: true,
    user_metadata: { name: 'E2E Test User' },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  userId = data.user.id;
  log('✓ User created, id =', userId);
  // The handle_new_user trigger should have created the public.users row.
  // Wait briefly and verify.
  await new Promise(r => setTimeout(r, 1500));
  const { data: profile, error: pErr } = await admin.from('users').select('id, credits, plan').eq('id', userId).single();
  if (pErr) throw new Error(`profile lookup: ${pErr.message}`);
  log('✓ Profile created, credits =', profile.credits, 'plan =', profile.plan);
}

async function cleanup() {
  if (!userId) return;
  log('Cleaning up user...');
  // Delete profile (cascades to all owned data via FK cascade)
  await admin.from('users').delete().eq('id', userId).then(() => {}, () => {});
  await admin.auth.admin.deleteUser(userId).catch(() => {});
  log('✓ Cleanup done');
}

async function run() {
  await createUser();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  // ─── Step 1: navigate to /login ───────────────────────
  log('1. Navigate to', BASE + '/login');
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: `${OUT}/01_login.png` });

  // ─── Step 2: fill credentials and submit ──────────────
  log('2. Fill credentials');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.screenshot({ path: `${OUT}/02_filled.png` });
  await page.click('button[type="submit"]');

  // Wait for redirect to dashboard
  log('3. Wait for dashboard');
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  log('   on:', page.url());
  await page.screenshot({ path: `${OUT}/03_dashboard.png`, fullPage: true });

  // ─── Step 3: navigate to /create ──────────────────────
  log('4. Navigate to /create');
  await page.goto(BASE + '/create', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: `${OUT}/04_create_empty.png` });

  // ─── Step 4: fill brief and click generate ────────────
  log('5. Fill brief and click "צור פוסט"');
  const briefText = 'מבצע ליום ההולדת של הסטודיו — 30% הנחה על כל הקורסים השבוע. קהל יעד: יזמים בני 25-45 שמתעניינים בעסקים דיגיטליים.';
  await page.fill('textarea', briefText);
  await page.screenshot({ path: `${OUT}/05_brief_filled.png` });

  // Click the primary "צור פוסט" button — it's the bottom-left primary action
  const generateBtn = page.locator('button:has-text("צור פוסט")').last();
  await generateBtn.click();

  log('6. Wait for AI response (up to 60s)...');
  // Wait for output content to appear — the OutputBox shows the generated post
  let success = false;
  let errorVisible = '';
  try {
    await Promise.race([
      page.waitForSelector('text=/AIDA|PAS|✨|🎯/', { timeout: 60000 }),
      page.waitForFunction(() => {
        // Look for text matching a generated post pattern
        const all = document.body.innerText || '';
        return all.length > 4000 && /[֐-׿]/.test(all);
      }, { timeout: 60000 }),
    ]);
    success = true;
  } catch (e) {
    log('   timeout/error waiting for output');
  }

  // Check if a red alert (error) is visible
  const alertEl = await page.locator('text=/❌/').first().textContent().catch(() => null);
  if (alertEl) errorVisible = alertEl;

  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/06_result.png`, fullPage: true });

  // Verify the AI call succeeded
  const bodyText = await page.locator('body').innerText();
  const hasOutput = bodyText.length > 2000 && !bodyText.includes('claude-sonnet-4-20250514');

  log('────────────────────────────────────────');
  log('Result:', success && !errorVisible ? '✅ PASS' : '❌ FAIL');
  if (errorVisible) log('  Error on page:', errorVisible);
  if (consoleErrors.length) {
    log('  Console errors:');
    consoleErrors.slice(0, 5).forEach(e => log('   •', e.substring(0, 200)));
  }

  await browser.close();
  return { success: success && !errorVisible, errorVisible, consoleErrors };
}

let result = null;
try {
  result = await run();
} catch (e) {
  console.error('[e2e] fatal:', e.message);
} finally {
  await cleanup();
}
process.exit(result?.success ? 0 : 1);

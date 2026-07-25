// One-shot: log in, run the smart pipeline, print winner + rationale + candidates.
import { chromium } from 'playwright';

const APP = process.env.APP_URL || 'http://localhost:3007';
const EMAIL = process.env.TEST_EMAIL || 'elirankahalani27@gmail.com';
const PW = process.env.TEST_PW || '0503377';
const PROMPT = process.env.GEN_PROMPT ||
  'בית קפה בוטיק תל אביבי בשעת בוקר, אספרסו וקרואסון טרי על שיש כהה, אור רך מהחלון, צילום אוכל מקצועי ומזמין';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
try {
  async function login() {
    await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500); // let React hydrate so submit isn't a native form post
    await page.fill('input[type=email]', EMAIL);
    await page.fill('input[type=password]', PW);
    await page.waitForTimeout(400);
    await page.click('button[type=submit]');
    await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 20000 }).catch(() => {});
    return !page.url().includes('/login');
  }
  let ok = await login();
  if (!ok) { console.log('retrying login…'); ok = await login(); }
  if (!ok) throw new Error('login failed (still on /login)');
  console.log('after login at', page.url());

  await page.goto(`${APP}/images`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('textarea', { timeout: 20000 });
  const tas = await page.locator('textarea').all();
  await tas[tas.length - 1].fill(PROMPT);

  console.log('generating (smart pipeline)…');
  const t0 = Date.now();
  await page.getByRole('button', { name: '🎨 צור תמונה', exact: true }).click();
  await page.waitForSelector('img[alt="Generated"]', { timeout: 120000 });
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const winner = await page.locator('img[alt="Generated"]').first().getAttribute('src');
  const rationale = await page.locator('text=🏆').first().textContent().catch(() => '');

  // reveal other versions to capture their URLs
  const link = page.getByText(/הצג \d+ גרסאות נוספות/).first();
  let others = [];
  if (await link.isVisible().catch(() => false)) {
    await link.click();
    await page.waitForTimeout(400);
    others = await page.locator('img[alt^="גרסה"]').evaluateAll(els => els.map(e => e.src));
  }

  console.log('WINNER=' + winner);
  console.log('RATIONALE=' + (rationale || '').trim());
  others.forEach((u, i) => console.log(`OTHER${i}=` + u));
} finally {
  await browser.close();
}

// Log in as the user and report Ads-Launcher prerequisites (no Meta writes).
import { chromium } from 'playwright';
const APP = process.env.APP_URL || 'http://localhost:3007';
const EMAIL = process.env.TEST_EMAIL || 'elirankahalani27@gmail.com';
const PW = process.env.TEST_PW || '0503377';

const b = await chromium.launch({ headless: true });
const p = await (await b.newContext()).newPage();
try {
  async function login() {
    await p.goto(`${APP}/login`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    await p.fill('input[type=email]', EMAIL);
    await p.fill('input[type=password]', PW);
    await p.waitForTimeout(300);
    await p.click('button[type=submit]');
    await p.waitForURL(u => !u.toString().includes('/login'), { timeout: 20000 }).catch(() => {});
    return !p.url().includes('/login');
  }
  let ok = await login(); if (!ok) ok = await login();
  if (!ok) throw new Error('login failed');
  console.log('logged in:', p.url());

  const data = await p.evaluate(async () => {
    const approvals = await fetch('/api/approvals').then(r => r.json()).catch(() => []);
    const active = await fetch('/api/active-client').then(r => r.json()).catch(() => ({}));
    return { approvals, active };
  });

  const apps = Array.isArray(data.approvals) ? data.approvals : [];
  const approved = apps.filter(a => a.status === 'approved');
  console.log('APPROVALS total:', apps.length, '| approved:', approved.length);
  approved.slice(0, 8).forEach(a => console.log('  - approved id=%s title=%s hasImage=%s clientId=%s',
    a.id, JSON.stringify(a.title), !!a.content?.image_url, a.client_id));

  const clients = data.active?.clients || data.active?.data || [];
  const list = Array.isArray(clients) ? clients : [];
  console.log('ACTIVE clientId:', data.active?.active_client_id || data.active?.activeClientId || data.active?.active);
  console.log('CLIENTS:', list.length);
  list.slice(0, 8).forEach(c => console.log('  - %s id=%s page=%s adAccount=%s status=%s',
    c.name, c.id, c.selected_page_id, c.selected_ad_account_id, c.status));
} catch (e) {
  console.error('PROBE FAILED:', e.message);
  process.exitCode = 1;
} finally { await b.close(); }

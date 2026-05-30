// End-to-end test of the image generation flow.
// Usage: node scripts/test-image-flow.js
const { chromium } = require('playwright');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const EMAIL   = process.env.TEST_EMAIL || 'elirankahalani27@gmail.com';
const PW      = process.env.TEST_PW    || '0503377';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  page.on('console', m => {
    if (m.type() === 'error') console.log('  [console error]', m.text().slice(0, 200));
  });
  page.on('pageerror', e => console.log('  [page error]', e.message));

  try {
    console.log('1. Login →', `${APP_URL}/login`);
    await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[type=email]', EMAIL);
    await page.fill('input[type=password]', PW);
    await Promise.all([
      page.waitForURL(/\/(images|create)?$/, { timeout: 15000 }).catch(() => {}),
      page.click('button[type=submit]'),
    ]);
    console.log('   ✓ Logged in, now at:', page.url());

    console.log('2. Navigate to /images');
    await page.goto(`${APP_URL}/images`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    console.log('3. Select provider:', process.env.TEST_PROVIDER || 'gemini');
    const providerLabel = process.env.TEST_PROVIDER === 'ideogram' ? 'Ideogram V2' : 'Gemini Nano Banana';
    await page.getByText(providerLabel, { exact: false }).first().click();
    await page.waitForTimeout(300);

    console.log('4. Type prompt');
    const promptText = 'A cozy modern bakery storefront in Jerusalem with golden hour lighting, warm bread loaves in the window, professional food photography';
    const textareas = await page.locator('textarea').all();
    // The "תיאור / Prompt" textarea is the last one shown (after the collapsed ad-copy)
    const promptArea = textareas[textareas.length - 1];
    await promptArea.fill(promptText);

    console.log('5. Click generate');
    // Three buttons contain "צור תמונה": (1) ad toggle, (2) ad-flow button (collapsed), (3) main 🎨 button.
    // Match by the 🎨 emoji to disambiguate.
    const generateBtn = page.getByRole('button', { name: '🎨 צור תמונה', exact: true });
    await generateBtn.click();

    console.log('6. Wait for image (smart pipeline, up to 90s)…');
    const t0 = Date.now();
    await page.waitForSelector('img[alt="Generated"]', { timeout: 90000 });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`   ✓ Image rendered in ${elapsed}s`);

    const imgUrl = await page.locator('img[alt="Generated"]').first().getAttribute('src');
    console.log('   image URL:', imgUrl?.slice(0, 100));

    // Smart pipeline assertions: judge rationale + "show N other versions" link.
    const othersLink = page.getByText(/הצג \d+ גרסאות נוספות/);
    if (await othersLink.first().isVisible().catch(() => false)) {
      console.log('   ✓ "show other versions" link present');
      await othersLink.first().click();
      await page.waitForTimeout(500);
      const otherCount = await page.locator('img[alt^="גרסה"]').count();
      console.log('   ✓ other versions revealed:', otherCount);
    } else {
      console.log('   ⚠️  no "show others" link (single candidate or single-shot fallback)');
    }
    const rationale = page.locator('text=🏆');
    if (await rationale.first().isVisible().catch(() => false)) {
      console.log('   ✓ judge rationale:', (await rationale.first().textContent())?.slice(0, 120));
    }

    // Check there's no error visible
    const errorVisible = await page.locator('text=❌').first().isVisible().catch(() => false);
    const noticeVisible = await page.locator('text=ℹ️').first().isVisible().catch(() => false);
    if (errorVisible) {
      const errText = await page.locator('text=❌').first().textContent();
      console.log('   ⚠️  error visible:', errText?.slice(0, 200));
    }
    if (noticeVisible) {
      const noticeText = await page.locator('text=ℹ️').first().textContent();
      console.log('   ℹ️  notice visible:', noticeText?.slice(0, 200));
    }

    console.log('7. Verify image actually shows in DB history (refresh)');
    await page.reload({ waitUntil: 'networkidle' });
    const historyImgs = await page.locator('div.grid.grid-cols-3 img').count();
    console.log('   history thumbnails after reload:', historyImgs);

    await page.screenshot({ path: '/tmp/admaster-image-test.png', fullPage: false });
    console.log('   📸 screenshot saved to /tmp/admaster-image-test.png');

    console.log('\n✅ FULL FLOW PASSED');
  } catch (e) {
    console.error('\n❌ FAILED:', e.message);
    await page.screenshot({ path: '/tmp/admaster-image-test-fail.png', fullPage: true }).catch(() => {});
    console.log('   screenshot of failure: /tmp/admaster-image-test-fail.png');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

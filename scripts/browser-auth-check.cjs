const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const artifacts = path.resolve(__dirname, '../.local/browser-check');
  fs.mkdirSync(artifacts, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:3012/');
    await page.waitForURL('**/login');
    await page.getByRole('heading', { name: 'Client sign in' }).waitFor();
    await page.screenshot({ path: path.join(artifacts, 'login-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(artifacts, 'login-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.getByLabel('Email address').fill('client@example.test');
    await page.getByLabel('Password', { exact: true }).fill('wrong');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Email or password is incorrect.' }).waitFor();
    await page.getByLabel('Password', { exact: true }).fill('test-only-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel(/use-case description/i).waitFor();
    const cookies = await context.cookies();
    const sessionCookie = cookies.find(cookie => cookie.name.includes('kg-scrum22-session'));
    assert(sessionCookie && sessionCookie.httpOnly);
    assert.equal(await page.evaluate(() => document.cookie.includes('kg-scrum22-session')), false);
    const description = 'Share customer email addresses with a partner for record matching.';
    await page.getByLabel(/use-case description/i).fill(description);
    await page.reload();
    await page.getByLabel(/use-case description/i).waitFor();
    await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('Share customer'));
    await page.getByRole('button', { name: /continue/i }).click();
    await page.getByRole('button', { name: /email addresses/i }).click();
    for (const group of await page.getByRole('group').all()) {
      const yes = group.getByRole('button', { name: 'Yes', exact: true });
      if (await yes.count()) await yes.click();
    }
    await page.getByRole('button', { name: /assess risk/i }).click();
    await page.getByText(/what drives this score/i).waitFor();
    await page.getByRole('button', { name: /recommendations/i }).last().click();
    await page.getByRole('heading', { name: /general safeguards/i }).waitFor();
    await page.screenshot({ path: path.join(artifacts, 'authenticated-results.png'), fullPage: true });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /download report/i }).click();
    await (await download).saveAs(path.join(artifacts, 'authenticated-report.pdf'));
    const second = await context.newPage();
    await second.goto('http://localhost:3012/');
    await second.getByLabel(/use-case description/i).waitFor();
    await page.bringToFront();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL('**/login?reason=signed-out');
    await second.waitForURL('**/login?reason=expired');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('governance-assessment-draft-v2')), null);
    const replay = await context.request.get('http://localhost:3012/api/session', {
      headers: { Cookie: `${sessionCookie.name}=${sessionCookie.value}` },
    });
    assert.equal(replay.status(), 401);
    const csrf = await context.request.post('http://localhost:3012/api/login', {
      headers: { Origin: 'https://attacker.test' }, data: {},
    });
    assert.equal(csrf.status(), 403);
    await page.goto('http://localhost:3012/');
    await page.waitForURL('**/login');
    assert.deepEqual(errors, []);
    console.log('PASS: protected navigation, invalid/valid login, HttpOnly cookie, refresh/draft retention, real scoring, PDF, cross-tab logout, replay rejection, CSRF, desktop/mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

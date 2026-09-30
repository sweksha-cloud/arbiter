import { expect, hostSession, test } from './helpers';

test('pages send a Content Security Policy and other security headers', async ({ newPhone }) => {
  const phone = await newPhone();
  const response = await phone.goto('/');
  const headers = response!.headers();
  const csp = headers['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain('connect-src');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');

  // A new nonce for every page load.
  const again = (await phone.goto('/'))!.headers()['content-security-policy'];
  expect(again).not.toBe(csp);
});

test('injected HTML can't run code, so it can't read the saved sign-in', async ({ newPhone }) => {
  const phone = await newPhone();
  // The guard in helpers.ts fails a test on CSP reports; this one expects exactly one.
  phone.removeAllListeners('console');
  const reports: string[] = [];
  phone.on('console', (m) => /Content Security Policy/i.test(m.text()) && reports.push(m.text()));

  await hostSession(phone, 'Sweksha');
  // What an XSS bug does: attacker-controlled HTML ends up in the page, with
  // code in an event handler. (Scripts created by code that's already running
  // are trusted by 'strict-dynamic'; the policy's job is stopping injected markup.)
  await phone.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<img src="/does-not-exist.png" onerror="window.__stolen = localStorage.getItem(\'arbiter.identity\')">'
    );
  });

  expect(await phone.evaluate(() => (window as unknown as { __stolen?: string }).__stolen)).toBeUndefined();
  await expect.poll(() => reports.length).toBeGreaterThan(0);
  // The session itself still works under the policy.
  await expect(phone.getByText('Invite your friends')).toBeVisible();
});

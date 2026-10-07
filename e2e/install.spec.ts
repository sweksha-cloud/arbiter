import { expect, test } from './helpers';

test('Arbiter can be installed as an app: manifest, icons and iPhone tags', async ({ newPhone }) => {
  const phone = await newPhone();
  await phone.goto('/');
  const href = await phone.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');

  const manifest = await (await phone.request.get(href!)).json();
  expect(manifest).toMatchObject({ name: 'Arbiter', start_url: '/', display: 'standalone' });
  const purposes = (manifest.icons as { src: string; sizes: string; purpose: string }[]).map((i) => `${i.sizes} ${i.purpose}`);
  expect(purposes).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
  for (const icon of manifest.icons as { src: string }[]) {
    const response = await phone.request.get(icon.src);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
  }

  // iPhones use these instead of the manifest's icons.
  await expect(phone.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(phone.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Arbiter');
});

test('offline, a page shows a friendly offline screen instead of the browser error', async ({ newPhone, browserName }) => {
  // Playwright's WebKit doesn't run service workers.
  test.skip(browserName === 'webkit', 'no service workers in Playwright WebKit');
  const phone = await newPhone({ serviceWorkers: true });
  await phone.goto('/');
  await phone.evaluate(() => navigator.serviceWorker.ready);
  await phone.context().setOffline(true);
  await phone.goto('/history');
  await expect(phone.getByRole('heading', { name: "You're offline" })).toBeVisible();
  await phone.context().setOffline(false);
});


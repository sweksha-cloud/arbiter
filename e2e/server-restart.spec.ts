import { startApiServer, stopApiServer } from './api-server';
import { expect, hostSession, test } from './helpers';

test('a server restart shows the lost-connection banner, then reconnects (BUG-003, BUG-004)', async ({ newPhone }) => {
  const host = await newPhone();
  await hostSession(host, 'Sweksha');

  // SIGTERM is what a deploy sends. Before the BUG-003 fix, shutdown hung while
  // phones were connected, so stopApiServer() would time out here.
  await stopApiServer();
  const lost = host.getByText('Lost connection to Arbiter. Reconnecting…');
  await expect(lost).toBeVisible();

  // Guests are in Postgres, so the phone is still recognised after the
  // restart; live sessions are in memory, so this one is gone and the page
  // says so instead of spinning.
  await startApiServer();
  await expect(lost).toBeHidden({ timeout: 30_000 });
  await expect(host.getByRole('heading', { name: /We can.t find session/ })).toBeVisible();
  await expect(host.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
});

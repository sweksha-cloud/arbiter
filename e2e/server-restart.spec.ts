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

  // Guests and sessions are still kept in memory, so the restarted server
  // doesn't know this phone's session. Checking that is future work once
  // storage moves to Postgres; here the phone only has to reconnect.
  await startApiServer();
  await expect(lost).toBeHidden({ timeout: 30_000 });
});

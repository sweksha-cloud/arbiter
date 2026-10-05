import { startApiServer, stopApiServer } from './api-server';
import { expect, hostSession, joinSession, test } from './helpers';

test('a live session survives a server restart (a deploy): phones reconnect and carry on (BUG-003, BUG-004, OPEN-001)', async ({
  newPhone
}) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  await host.getByText('I need vegetarian options').click();
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await joinSession(friend, invite, 'Alex');
  await expect(host.getByText('1 of 2 submitted')).toBeVisible();

  // SIGTERM is what a deploy sends. Before the BUG-003 fix, shutdown hung while
  // phones were connected, so stopApiServer() would time out here.
  await stopApiServer();
  const lost = host.getByText('Lost connection to Arbiter. Reconnecting…');
  await expect(lost).toBeVisible();

  // Live sessions are in Redis, so the new server picks up exactly where the
  // old one stopped: same members, same submitted answers.
  await startApiServer();
  await expect(lost).toBeHidden({ timeout: 30_000 });
  await expect(host.getByText('1 of 2 submitted')).toBeVisible();
  await expect(host.getByText('✓ Submitted.')).toBeVisible();

  // And the session carries on: the last answer brings up results for both.
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(host.locator('article').first()).toBeVisible();
  await expect(friend.locator('article').first()).toBeVisible();
});

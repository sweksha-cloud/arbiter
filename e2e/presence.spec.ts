import { expect, hostSession, joinSession, test } from './helpers';

test('leaving mid-session offers a rejoin, and friends see the host leave and return', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite, code } = await hostSession(host, 'Sweksha');
  await joinSession(friend, invite, 'Alex');
  await expect(friend.getByText('0 of 2 submitted')).toBeVisible();

  await host.getByText('← Home').click();
  await expect(host.getByText(`You're in session ${code}`)).toBeVisible();

  // A 5 s grace period stops the notice flashing up on a quick reload.
  const hostLeft = friend.getByText('Sweksha (the host) has left the session for now');
  await friend.waitForTimeout(1_500);
  await expect(hostLeft).toBeHidden();
  await expect(hostLeft).toBeVisible({ timeout: 10_000 });

  await host.getByRole('link', { name: 'Rejoin' }).click();
  await expect(host.getByText('0 of 2 submitted')).toBeVisible();
  await expect(hostLeft).toBeHidden();
});

test('the rejoin banner survives closing the tab and can be dismissed', async ({ newPhone }) => {
  const host = await newPhone();
  const { code } = await hostSession(host, 'Sweksha');

  const context = host.context();
  await host.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  const banner = reopened.getByText(`You're in session ${code}`);
  await expect(banner).toBeVisible();

  await reopened.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toBeHidden();
});

test('losing the network shows a banner that clears once back online', async ({ newPhone }) => {
  const host = await newPhone();
  await hostSession(host, 'Sweksha');

  await host.context().setOffline(true);
  await expect(host.getByText('You’re offline')).toBeVisible();

  await host.context().setOffline(false);
  await expect(host.getByText('Back online')).toBeVisible({ timeout: 30_000 });
  await expect(host.getByText('Back online')).toBeHidden({ timeout: 10_000 });
});

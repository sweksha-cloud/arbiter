import { enterName, expect, hostSession, joinSession, test } from './helpers';

test('the host lands in the session straight away and results wait for everyone', async ({ newPhone }) => {
  const host = await newPhone();
  await hostSession(host, 'Sweksha');
  await expect(host.getByText('0 of 1 submitted')).toBeVisible();

  await host.getByText('I need vegetarian options').click();
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(host.getByText('1 of 1 submitted')).toBeVisible();
  // Alone in the session, submitting must not jump to results.
  await expect(host.locator('article')).toHaveCount(0);
});

test('results appear for everyone once the last person submits, and reactions are live', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();

  await joinSession(friend, invite, 'Alex');
  await expect(friend.getByText('1 of 2 submitted')).toBeVisible();
  await expect(host.getByText('1 of 2 submitted')).toBeVisible();

  await friend.getByText('No fast food').click();
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();
  // No button press needed: results show up for both phones.
  await expect(host.locator('article').first()).toBeVisible();
  await expect(friend.locator('article').first()).toBeVisible();
  expect(await friend.locator('article h3').allTextContents()).toEqual(
    await host.locator('article h3').allTextContents()
  );

  await friend.locator('article').first().getByRole('button', { name: /👍/ }).click();
  await expect(host.locator('article').first().getByRole('button', { name: '👍 1' })).toBeVisible();
});

test('two people reacting at the same moment both see the correct totals (BUG-002)', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await joinSession(friend, invite, 'Alex');
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();

  const hostCard = host.locator('article').first();
  const friendCard = friend.locator('article').first();
  await Promise.all([
    hostCard.getByRole('button', { name: /👍/ }).click(),
    friendCard.getByRole('button', { name: /👎/ }).click()
  ]);
  for (const card of [hostCard, friendCard]) {
    await expect(card.getByRole('button', { name: '👍 1' })).toBeVisible();
    await expect(card.getByRole('button', { name: '👎 1' })).toBeVisible();
  }
});

test('starting a session works even if the location prompt is never answered (BUG-010)', async ({ newPhone }) => {
  const host = await newPhone({ ignoreLocationPrompt: true });
  await host.goto('/');
  await enterName(host, 'Sweksha');
  await host.getByRole('button', { name: 'Start a session' }).click();
  // Falls back to the default area after 10 s instead of hanging.
  await expect(host.getByText('Invite your friends')).toBeVisible({ timeout: 15_000 });
});

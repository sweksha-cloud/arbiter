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

  await friend.getByText('Rather not do fast food').click();
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

test('a custom distance limits results for the group, and "Don\'t care" adds no limit', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  await host.getByRole('button', { name: 'Custom' }).click();
  await host.getByLabel(/Miles/).fill('0.3');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();

  await joinSession(friend, invite, 'Alex');
  await friend.getByRole('button', { name: "Don't care" }).click();
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();

  // The sample data has exactly three places within 0.3 mi of the host.
  await expect(friend.locator('article h3')).toHaveCount(3);
  expect((await friend.locator('article h3').allTextContents()).sort()).toEqual([
    'Burger Barn',
    'Corner Cafe',
    'Green Bowl'
  ]);
});

test('a custom distance outside the allowed range is caught before submitting', async ({ newPhone }) => {
  const host = await newPhone();
  await hostSession(host, 'Sweksha');
  await host.getByRole('button', { name: 'Custom' }).click();
  await host.getByLabel(/Miles/).fill('');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(host.getByText('Enter a distance between 0.1 and 31 miles.')).toBeVisible();
  await expect(host.getByText('0 of 1 submitted')).toBeVisible();
});

test('the group can mark what a place has, and everyone sees the count live', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await joinSession(friend, invite, 'Alex');
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();

  const hostFirst = host.locator('article').first();
  const friendFirst = friend.locator('article').first();
  await expect(hostFirst.getByText('No nutrition info for this place yet')).toBeVisible();

  await friendFirst.getByRole('button', { name: /^High protein/ }).click();

  // The friend's own mark is pressed; the host sees the count, with their own button not pressed.
  await expect(friendFirst.getByRole('button', { name: /^High protein/ })).toHaveAttribute('aria-pressed', 'true');
  const hostButton = hostFirst.getByRole('button', { name: /^High protein/ });
  await expect(hostButton).toContainText('· 1');
  await expect(hostButton).toHaveAttribute('aria-pressed', 'false');
  await expect(hostFirst.getByText('No nutrition info for this place yet')).toHaveCount(0);

  // Taking it back clears it for everyone.
  await friendFirst.getByRole('button', { name: /^High protein/ }).click();
  await expect(hostFirst.getByText('No nutrition info for this place yet')).toBeVisible();
});

test('nutrition goals, vegan and allergies are saved, prefilled, and checked', async ({ newPhone }) => {
  const phone = await newPhone();
  await phone.goto('/');
  await enterName(phone, 'Nia');
  await expect(phone.getByRole('button', { name: 'Start a session' })).toBeVisible();
  await phone.goto('/preferences');

  // A minimum above its maximum is caught before saving.
  await phone.getByLabel('Calories at least').fill('900');
  await phone.getByLabel('Calories at most').fill('500');
  await phone.getByRole('button', { name: 'Save' }).click();
  await expect(phone.locator('.error')).toHaveText('Calories: the minimum is more than the maximum.');

  await phone.getByLabel('Calories at least').fill('');
  await phone.getByLabel('Calories at most').fill('700');
  await phone.getByLabel('Protein at least (g)').fill('30');
  await phone.getByLabel("I'd like vegan options").check();
  await phone.getByLabel('Peanuts').check();
  await phone.getByRole('button', { name: 'Save' }).click();
  await expect(phone.locator('.success')).toBeVisible();

  await phone.reload();
  await expect(phone.getByLabel('Calories at most')).toHaveValue('700');
  await expect(phone.getByLabel('Calories at least')).toHaveValue('');
  await expect(phone.getByLabel('Protein at least (g)')).toHaveValue('30');
  await expect(phone.getByLabel("I'd like vegan options")).toBeChecked();
  await expect(phone.getByLabel('Peanuts')).toBeChecked();
});

test('an allergy shows the group a reminder, never who has it', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await joinSession(friend, invite, 'Alex');
  await friend.getByLabel('Shellfish').check();
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();

  const reminder = 'Someone in your group has a food allergy. Check with the restaurant before ordering.';
  await expect(host.getByText(reminder)).toBeVisible();
  await expect(friend.getByText(reminder)).toBeVisible();
  await expect(host.getByText(/shellfish/i)).toHaveCount(0);
});

test("a chain's published nutrition shows the dish that fits your own goals (ranking is covered in server tests)", async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  // The host wants a lean meal; the friend sets no nutrition goals.
  await host.getByLabel('Calories at most').fill('700');
  await host.getByLabel('Protein at least (g)').fill('30');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await joinSession(friend, invite, 'Alex');
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();

  // Sample "Taco Stand" has a 620-calorie, 42 g-protein bowl that fits.
  const hostTaco = host.locator('article').filter({ has: host.getByRole('heading', { name: 'Taco Stand' }) });
  await expect(hostTaco.getByText('Fits your nutrition settings:')).toBeVisible();
  await expect(hostTaco.getByText('Chicken Burrito Bowl')).toBeVisible();
  await expect(hostTaco.getByText('620 cal · 42 g protein · 60 g carbs')).toBeVisible();
  await expect(hostTaco.getByText(/Sample nutrition for testing/)).toBeVisible();
  // Its published menu counts as nutrition info, so the "no info" note isn't shown.
  await expect(hostTaco.getByText('No nutrition info for this place yet')).toHaveCount(0);

  // The friend sees the same place, but nothing is matched to goals they don't have.
  const friendTaco = friend.locator('article').filter({ has: friend.getByRole('heading', { name: 'Taco Stand' }) });
  await expect(friendTaco.getByText('This chain publishes nutrition for its menu.')).toBeVisible();
  await expect(friendTaco.getByText('Fits your nutrition settings:')).toHaveCount(0);
});

test('suggestions show their hours, and a place with several branches lists the others', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  // Liking Mexican puts sample "Taco Stand" (which has two branches) in the top 3.
  await host.getByRole('button', { name: /mexican$/ }).click();
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await joinSession(friend, invite, 'Alex');
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();

  const taco = host.locator('article').filter({ has: host.getByRole('heading', { name: 'Taco Stand' }) });
  await expect(taco).toHaveCount(1); // Both branches share one card.
  await expect(taco.getByText(/Open now/).first()).toBeVisible();

  await taco.getByText('Hours', { exact: true }).first().click();
  await expect(taco.getByText('Sunday: Closed').first()).toBeVisible();

  await taco.getByText('2 locations available').click();
  const others = taco.locator('.other-locations > li');
  await expect(others).toHaveCount(1);
  await expect(others.first()).toContainText('Closed now');
  await expect(others.first().getByRole('link', { name: 'Directions' })).toBeVisible();
});

test('kind-of-place choices are saved and prefilled', async ({ newPhone }) => {
  const phone = await newPhone();
  await phone.goto('/');
  await enterName(phone, 'Kit');
  await expect(phone.getByRole('button', { name: 'Start a session' })).toBeVisible();
  await phone.goto('/preferences');
  await phone.getByRole('button', { name: /Restaurant$/ }).click(); // 👍
  await phone.getByRole('button', { name: /Café$/ }).click();
  await phone.getByRole('button', { name: /Café$/ }).click(); // 👎
  await phone.getByRole('button', { name: 'Save' }).click();
  await expect(phone.locator('.success')).toBeVisible();

  await phone.reload();
  await expect(phone.getByRole('button', { name: '👍 Restaurant' })).toBeVisible();
  await expect(phone.getByRole('button', { name: '👎 Café' })).toBeVisible();
});

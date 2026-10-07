import {
  becomeGuest,
  expect,
  hostSession,
  joinSession,
  openOptionalSections,
  openSessionDetails,
  showList,
  startAs,
  test
} from './helpers';

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

test('a session needs a name: a blank or spaces-only name starts nothing', async ({ newPhone }) => {
  const phone = await newPhone();
  let guestsCreated = 0;
  phone.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/guests')) guestsCreated += 1;
  });
  await phone.goto('/');
  const name = phone.getByLabel('What should your friends call you?');
  for (const blank of ['', '   ']) {
    await name.fill(blank);
    await phone.getByRole('button', { name: 'Start a session' }).click();
    expect(await name.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  }
  await expect(phone).toHaveURL(/\/$/);
  expect(guestsCreated).toBe(0);

  await name.fill('Sweksha');
  await phone.getByRole('button', { name: 'Start a session' }).click();
  await expect(phone.getByRole('heading', { name: 'New session', level: 1 })).toBeVisible();
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
  await showList(host);
  await showList(friend);
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

  await showList(host);
  await showList(friend);
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

test('setting up never falls back to a default city: an unanswered or blocked prompt says so (BUG-010)', async ({
  newPhone
}) => {
  const host = await newPhone({ ignoreLocationPrompt: true });
  await startAs(host, 'Sweksha');
  await expect(host.getByRole('heading', { name: 'New session', level: 1 })).toBeVisible();

  await host.getByRole('button', { name: 'Search around an area' }).click();
  await expect(host.getByRole('button', { name: 'Create session' })).toBeDisabled();
  await host.getByRole('button', { name: /Use my current location/ }).click();
  // A message and the typed option. Test browsers with no permission treat the
  // prompt as blocked; a real one left unanswered gives up after 10 s.
  await expect(host.getByText(/^(No answer to the location prompt|Location is blocked for this site)\./)).toBeVisible({
    timeout: 15_000
  });
  await expect(host.getByRole('button', { name: 'Create session' })).toBeDisabled();
  await host.getByLabel('Search near: type a place').fill('San Francisco');
  await host.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(host.getByText('📍 San Francisco (sample)')).toBeVisible();
  await host.getByRole('button', { name: 'Create session' }).click();
  await expect(host.getByText('Your session')).toBeVisible();
});

test('the host sets up where to meet before the session exists; only the host sees the invite bar', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha', { place: 'downtown san jose' });
  await expect(host.getByText('Searching around downtown san jose (sample)')).toBeVisible();

  await joinSession(friend, invite, 'Alex');
  await expect(friend.getByText('Sweksha chose: Search around an area')).toBeVisible();
  await expect(friend.getByText('Meeting near downtown san jose (sample)')).toBeVisible();
  // Only the host has the code-and-link bar, and only the host can change the area.
  await expect(friend.getByLabel('Invite link')).toHaveCount(0);
  await expect(friend.getByRole('button', { name: 'Change' })).toHaveCount(0);

  // Once results are in, the host's bar moves to the bottom of the page (still only theirs).
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();
  await openSessionDetails(friend);
  await openSessionDetails(host);
  await expect(friend.getByText(/^Searched near downtown san jose \(sample\)/)).toBeVisible();
  await expect(host.getByLabel('Invite link')).toHaveValue(invite);
  await expect(host.locator('.host-bar')).toHaveClass(/bottom/);
  await expect(friend.getByLabel('Invite link')).toHaveCount(0);
});

test('the host can change the area in the lobby', async ({ newPhone }) => {
  const host = await newPhone();
  await hostSession(host, 'Sweksha', { place: 'Oakland' });
  await host.getByRole('button', { name: 'Change' }).click();
  await host.getByRole('button', { name: 'Change' }).click(); // the place itself, inside the picker
  await host.getByLabel('Search near: type a place').fill('Berkeley');
  await host.getByRole('button', { name: 'Search', exact: true }).click();
  await host.getByRole('button', { name: 'Done' }).click();
  await expect(host.getByText('Searching around Berkeley (sample)')).toBeVisible();
});

test('meeting between everyone: where you\'re coming from is asked first and stays private', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  // The host shares where they're coming from on the setup page.
  const { invite } = await hostSession(host, 'Sweksha', { mode: 'between' });
  await joinSession(friend, invite, 'Alex');

  // Everyone sees what the host chose, and what their location is for.
  await expect(friend.getByText('Sweksha chose: Find a spot between us')).toBeVisible();
  await expect(friend.getByText("Arbiter searches around the average of everyone's locations.", { exact: false })).toBeVisible();
  // Location comes before preferences.
  await expect(friend.getByText("First, share where you're coming from (above).", { exact: false })).toBeVisible();
  await expect(friend.getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0);

  await friend.getByLabel(/Where are you coming from\?.*type a place/).fill('Santa Clara');
  await friend.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(friend.getByText('📍 Santa Clara (sample)')).toBeVisible();
  await expect(host.getByText("(2 of 2 shared where they're coming from)")).toBeVisible();
  await expect(host.getByText('Santa Clara')).toHaveCount(0);

  await friend.getByRole('button', { name: 'Submit', exact: true }).click();
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(host.locator('article').first()).toBeVisible();
  await openSessionDetails(host);
  await expect(host.getByText("Searched around the average of everyone's locations", { exact: false })).toBeVisible();
  await expect(friend.locator('article').first()).toContainText('from you');
});

test('liking a place from "more options" adds it to the list for everyone', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await joinSession(friend, invite, 'Alex');
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();
  await showList(host);
  await showList(friend);
  await expect(host.locator('article')).toHaveCount(4);

  await friend.getByText(/^More options \(\d+\)$/).click();
  const extra = friend.locator('.more-list li').first();
  const name = (await extra.locator('strong').textContent())!;
  await extra.getByRole('button', { name: /add it to the list/ }).click();

  await expect(host.locator('article')).toHaveCount(5);
  await expect(host.locator('article').nth(4).locator('h3')).toHaveText(name);
  await expect(host.locator('article').nth(4).getByRole('button', { name: '👍 1' })).toBeVisible();
});

test('a custom distance limits results for the group, and "Don\'t care" adds no limit', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  await host.getByRole('group', { name: "Farthest I'll go" }).getByRole('button', { name: 'Custom' }).click();
  await host.getByLabel(/Miles/).fill('0.3');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();

  await joinSession(friend, invite, 'Alex');
  await friend.getByRole('button', { name: "Don't care" }).click();
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();

  // The sample data has exactly three places within 0.3 mi of the host.
  await showList(friend);
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
  await host.getByRole('group', { name: "Farthest I'll go" }).getByRole('button', { name: 'Custom' }).click();
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

  await showList(host);
  await showList(friend);
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
  await becomeGuest(phone, 'Nia');

  await openOptionalSections(phone);
  // A minimum above its maximum is caught before saving.
  await phone.getByLabel('Calories at least').fill('900');
  await phone.getByLabel('Calories at most').fill('500');
  await phone.getByRole('button', { name: 'Save' }).click();
  await expect(phone.locator('.error')).toHaveText('Calories: the minimum is more than the maximum.');

  await phone.getByLabel('Calories at least').fill('');
  await phone.getByLabel('Calories at most').fill('700');
  await phone.getByLabel('Protein at least (g)').fill('30');
  await phone.getByLabel('I need vegan options').check();
  await phone.getByLabel('Peanuts').check();
  await phone.getByRole('button', { name: 'Save' }).click();
  await expect(phone.locator('.success')).toBeVisible();

  await phone.reload();
  await expect(phone.getByLabel('Calories at most')).toHaveValue('700');
  await expect(phone.getByLabel('Calories at least')).toHaveValue('');
  await expect(phone.getByLabel('Protein at least (g)')).toHaveValue('30');
  await expect(phone.getByLabel('I need vegan options')).toBeChecked();
  await expect(phone.getByLabel('Peanuts')).toBeChecked();
});

test('an allergy shows the group a reminder, never who has it', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await joinSession(friend, invite, 'Alex');
  await openOptionalSections(friend);
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
  await openOptionalSections(host);
  await host.getByLabel('Calories at most').fill('700');
  await host.getByLabel('Protein at least (g)').fill('30');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await joinSession(friend, invite, 'Alex');
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();

  await showList(host);
  await showList(friend);
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
  // No item fits goals they don't have, so no nutrition box (the credit is in the footer).
  await expect(friendTaco.getByRole('region', { name: 'Published nutrition' })).toHaveCount(0);
  await expect(friend.getByRole('link', { name: 'Powered by fatsecret Platform API' })).toBeVisible();
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

  await showList(host);
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

test('the budget is in dollars, with a custom amount, and is saved and prefilled', async ({ newPhone }) => {
  const phone = await newPhone();
  await becomeGuest(phone, 'Pia');
  const budget = phone.getByRole('group', { name: 'Most I want to spend on myself' });
  for (const label of ['Any', 'Under $10', '$10–20', '$20–30', '$30–50', 'Custom']) {
    await expect(budget.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  await budget.getByRole('button', { name: 'Custom' }).click();
  const amount = phone.getByLabel('The most you want to spend on yourself ($)');
  // Left empty, it asks for an amount; out of range, the browser stops it.
  await phone.getByRole('button', { name: 'Save' }).click();
  await expect(phone.locator('.error')).toContainText('whole dollars');
  await amount.fill('0');
  await phone.getByRole('button', { name: 'Save' }).click();
  expect(await amount.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);

  await amount.fill('40');
  await phone.getByRole('button', { name: 'Save' }).click();
  await expect(phone.locator('.success')).toBeVisible();
  await phone.reload();
  await expect(phone.getByLabel('The most you want to spend on yourself ($)')).toHaveValue('40');

  await budget.getByRole('button', { name: '$10–20' }).click();
  await phone.getByRole('button', { name: 'Save' }).click();
  await expect(phone.locator('.success')).toBeVisible();
  await phone.reload();
  await expect(budget.getByRole('button', { name: '$10–20' })).toHaveAttribute('aria-pressed', 'true');
});

test('a dollar budget removes places that cost more, and cards show dollar ranges', async ({ newPhone }) => {
  const host = await newPhone();
  await hostSession(host, 'Ivy');
  const budget = host.getByRole('group', { name: 'Most I want to spend on myself' });
  await budget.getByRole('button', { name: 'Under $10' }).click();
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await host.getByRole('button', { name: 'Show results now' }).click();
  await showList(host);
  const cards = host.locator('article');
  await expect(cards.first()).toBeVisible();
  // Every sample place under $10 is $1–10; Pho House has no price, so it's kept.
  for (const text of await cards.allInnerTexts()) expect(text).toMatch(/\$1–10|Pho House/);
});

test('preference boxes can be closed without losing answers, and say answers are private', async ({ newPhone }) => {
  const phone = await newPhone();
  await phone.goto('/');
  await expect(phone.getByText('Your answers are never shared')).toBeVisible();
  await becomeGuest(phone, 'Oli');
  await expect(phone.getByText('All your answers are private.')).toBeVisible();
  await expect(phone.getByRole('heading', { name: 'Allergies', exact: true })).toBeVisible();

  const vegetarian = phone.getByLabel('I need vegetarian options');
  await vegetarian.check();
  await phone.getByText('Must-haves', { exact: true }).click();
  await expect(vegetarian).toBeHidden();
  await phone.getByRole('button', { name: 'Save' }).click();
  await expect(phone.locator('.success')).toBeVisible();

  await phone.reload();
  await expect(phone.getByLabel('I need vegetarian options')).toBeChecked();
});

test("people whose must-haves weren't counted are told why", async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const late = await newPhone();
  const { invite } = await hostSession(host, 'Hana');
  await joinSession(friend, invite, 'Finn');
  await expect(host.getByText('0 of 2 submitted')).toBeVisible();
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await host.getByRole('button', { name: 'Show results now' }).click();
  await expect(host.locator('article').first()).toBeVisible();

  await expect(
    friend.getByText('Results were shown before you submitted. Add your preferences and the list will re-sort to include them.')
  ).toBeVisible();
  await joinSession(late, invite, 'Lia');
  await expect(late.getByText('Results are already in. Add your preferences and the list will re-sort to include them.')).toBeVisible();
  await expect(host.getByText(/will re-sort to include them/)).toBeHidden();

  // The late joiner's answers re-sort the list, and everyone is told (never who).
  await late.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(host.getByText('Someone new added their preferences, so the options have been reorganized.')).toBeVisible();
  await expect(late.getByText('Your preferences are in, so the options have been reorganized.')).toBeVisible();
});

test('"only show me" kinds of place are saved and prefilled', async ({ newPhone }) => {
  const phone = await newPhone();
  await becomeGuest(phone, 'Kit');
  const only = phone.getByRole('group', { name: 'Only show me' });
  await only.getByRole('button', { name: 'Restaurant', exact: true }).click();
  await only.getByRole('button', { name: 'Café', exact: true }).click();
  await only.getByRole('button', { name: 'Café', exact: true }).click(); // tapped again: off
  await phone.getByRole('button', { name: 'Save' }).click();
  await expect(phone.locator('.success')).toBeVisible();

  await phone.reload();
  await expect(only.getByRole('button', { name: 'Restaurant', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(only.getByRole('button', { name: 'Café', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('with nothing that fits, each person sees which of their own must-haves a closest match misses', async ({
  newPhone
}) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  // The sample places have no bars, so nothing fits the host's must-have.
  await host.getByRole('group', { name: 'Only show me' }).getByRole('button', { name: 'Bar', exact: true }).click();
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await joinSession(friend, invite, 'Alex');
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();

  await expect(host.getByText('Nothing nearby fits all your preferences, so here are the closest matches.')).toBeVisible();
  await expect(host.locator('article').first().getByText(/^Misses your must-haves: it's (a restaurant|fast food|a café|a dessert place), not a bar$/)).toBeVisible();
  // The friend has no must-haves, so they never see the host's.
  await expect(friend.locator('article').first()).toBeVisible();
  await expect(friend.getByText(/Misses your must-haves/)).toHaveCount(0);
});

test('the home page greeting can change your name, or forget you on a shared phone', async ({ newPhone }) => {
  const phone = await newPhone();
  await becomeGuest(phone, 'Angel');
  await phone.goto('/');
  await expect(phone.getByText('Hi Angel.')).toBeVisible();

  await phone.getByRole('button', { name: 'Change name' }).click();
  await phone.getByLabel('What should your friends call you?').fill('Sweksha');
  await phone.getByRole('button', { name: 'Save name' }).click();
  await expect(phone.getByText('Hi Sweksha.')).toBeVisible();
  await phone.reload();
  await expect(phone.getByText('Hi Sweksha.')).toBeVisible();

  await phone.getByRole('button', { name: 'Not you?' }).click();
  // Back to the first-visit form, with no name remembered.
  await expect(phone.getByLabel('What should your friends call you?')).toHaveValue('');
  await expect(phone.getByText('Hi Sweksha.')).toHaveCount(0);
});

test('after results, editing preferences re-sorts the list for everyone without saying who', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await joinSession(friend, invite, 'Alex');
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(host.locator('article').first()).toBeVisible();

  await openSessionDetails(host);
  await host.getByRole('button', { name: 'Change' }).click();
  await host.getByLabel('I need vegetarian options').check();
  await host.getByRole('button', { name: 'Update' }).click();

  await expect(host.getByText('Your changes are in, so the options have been reorganized.')).toBeVisible();
  await expect(friend.getByText('Someone changed their preferences, so the options have been reorganized.')).toBeVisible();
  await friend.getByRole('button', { name: 'Close this note' }).click();
  await expect(friend.getByText(/options have been reorganized/)).toHaveCount(0);
});

test('swiping: everyone liking a place makes a match; alone, it lists what you liked', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { invite } = await hostSession(host, 'Sweksha');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await joinSession(friend, invite, 'Alex');
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();

  // Both like the first card (the same place for everyone); the host also passes on the next.
  const first = await host.locator('article.swipe-card h3').textContent();
  await host.getByRole('button', { name: `Like ${first}` }).click();
  await expect(host.getByText(/^2 of \d+/)).toBeVisible();
  await expect(host.getByText('No match yet.')).toBeVisible();
  await friend.getByRole('button', { name: `Like ${first}` }).click();
  await expect(host.getByRole('heading', { name: "🎉 It's a match!" })).toBeVisible();
  await expect(friend.getByRole('region', { name: 'Matches' }).getByText(first!)).toBeVisible();

  // Undo takes the like back, so the match goes away.
  await friend.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(host.getByText('No match yet.')).toBeVisible();
});

test('swiping alone shows every place you liked', async ({ newPhone }) => {
  const phone = await newPhone();
  await hostSession(phone, 'Sweksha');
  await phone.getByRole('button', { name: 'Submit', exact: true }).click();
  await phone.getByRole('button', { name: 'Show results now' }).click();
  const first = await phone.locator('article.swipe-card h3').textContent();
  await phone.getByRole('button', { name: `Like ${first}` }).click();
  await expect(phone.getByText(/^2 of \d+$/)).toBeVisible();
  await phone.keyboard.press('ArrowLeft'); // Keyboard works too: pass on the second.
  await expect(phone.getByText(/^3 of \d+$/)).toBeVisible();
  const third = await phone.locator('article.swipe-card h3').textContent();
  await phone.getByRole('button', { name: `Like ${third}` }).click();
  const liked = phone.getByRole('region', { name: 'Places you liked' });
  await expect(liked.getByRole('heading', { name: 'Places you liked (2)' })).toBeVisible();
  await liked.getByRole('heading', { name: 'Places you liked (2)' }).click(); // A tap opens the list.
  await expect(liked.getByText(first!)).toBeVisible();
  await expect(liked.getByText(third!)).toBeVisible();
});

test('swiping comes in rounds of 7, then you can see more or narrow your likes to a top pick', async ({ newPhone }) => {
  const phone = await newPhone();
  await hostSession(phone, 'Sweksha');
  await phone.getByRole('button', { name: 'Submit', exact: true }).click();
  await phone.getByRole('button', { name: 'Show results now' }).click();
  await expect(phone.getByText(/^1 of 7$/)).toBeVisible();
  const swipe = async (like: boolean) => {
    const name = await phone.locator('article.swipe-card h3').textContent();
    await phone.getByRole('button', { name: `${like ? 'Like' : 'Pass on'} ${name}` }).click();
  };
  // Like the 1st and 2nd, pass on the rest of the round.
  for (let i = 0; i < 7; i++) await swipe(i < 2);
  await expect(phone.getByText('End of this round. Here are your likes:')).toBeVisible();
  // The end of a round lists what you liked.
  await expect(phone.getByRole('list', { name: 'Places you liked' }).getByRole('listitem')).toHaveCount(2);
  await expect(phone.getByRole('button', { name: /^See \d+ more places?$/ })).toBeVisible();

  await phone.getByRole('button', { name: 'Go through my 2 likes again' }).click();
  await expect(phone.getByText(/^Narrowing down · 1 of 2$/)).toBeVisible();
  const keep = await phone.locator('article.swipe-card h3').textContent();
  await swipe(true);
  await swipe(false);
  await expect(phone.getByText(`Your top pick: ${keep}`)).toBeVisible();
});

test('"Try a demo" works alone: simulated friends swipe, and liking what they like is a match', async ({ newPhone }) => {
  const phone = await newPhone();
  await phone.goto('/');
  await phone.getByRole('button', { name: '▶ Try a demo with sample friends' }).click();
  await expect(phone.getByText('Demo session.')).toBeVisible();
  await phone.getByRole('button', { name: 'Submit', exact: true }).click();
  // The simulated friends like the first places they see; like the first one too.
  const first = await phone.locator('article.swipe-card h3').textContent();
  await phone.getByRole('button', { name: `Like ${first}` }).click();
  await expect(phone.locator('.match-toast')).toContainText(first!, { timeout: 20_000 });
});


import { enterName, expect, hostSession, joinSession, test } from './helpers';

test('an unknown session link explains itself and offers a way forward', async ({ newPhone }) => {
  const phone = await newPhone();
  await phone.goto('/s/zz99zz');
  await enterName(phone, 'Sam');
  await expect(phone.getByRole('heading', { level: 1 })).toHaveText("We can't find session ZZ99ZZ");

  // Another unknown code keeps you on the same screen, now naming the new code.
  await phone.getByPlaceholder('e.g. K7QM3X').fill('abc123');
  await phone.getByRole('button', { name: 'Join session' }).click();
  await expect(phone.getByRole('heading', { level: 1 })).toHaveText("We can't find session ABC123");

  await phone.getByRole('button', { name: 'Start a new session' }).click();
  await expect(phone.getByText('Invite your friends')).toBeVisible();
});

test('invite links work in lowercase', async ({ newPhone }) => {
  const host = await newPhone();
  const friend = await newPhone();
  const { code } = await hostSession(host, 'Sweksha');

  await joinSession(friend, `/s/${code.toLowerCase()}`, 'Kai');
  await expect(friend.getByText('0 of 2 submitted')).toBeVisible();
});

test("every page links to the Terms and Privacy pages, which link to Google's terms", async ({ newPhone }) => {
  const phone = await newPhone();
  await phone.goto('/');
  await phone.getByRole('contentinfo').getByRole('link', { name: 'Privacy Policy' }).click();
  await expect(phone.getByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeVisible();
  await expect(phone.getByRole('link', { name: 'Google Privacy Policy' })).toHaveAttribute('href', 'https://policies.google.com/privacy');

  await phone.getByRole('contentinfo').getByRole('link', { name: 'Terms of Use' }).click();
  await expect(phone.getByRole('heading', { name: 'Terms of Use', level: 1 })).toBeVisible();
  await expect(phone.getByRole('link', { name: 'Google Maps/Google Earth Additional Terms of Service' })).toHaveAttribute(
    'href',
    'https://maps.google.com/help/terms_maps/'
  );
  await expect(phone.getByRole('link', { name: 'fatsecret Platform API Terms of Use' })).toBeVisible();
});

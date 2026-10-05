import { randomUUID } from 'node:crypto';

import { becomeGuest, expect, hostSession, lastEmailTo, test } from './helpers';

// Unique per run, so reruns against the same database never collide.
const newEmail = () => `e2e-${randomUUID()}@example.com`;
const password = 'correct horse battery';

test('a guest signs up, keeps their name, and sees the session they hosted in past sessions', async ({ newPhone }) => {
  const phone = await newPhone();
  const { code } = await hostSession(phone, 'Sweksha');
  const email = newEmail();

  await phone.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Sign up' }).click();
  await expect(phone.getByText('Signing up as Sweksha')).toBeVisible();
  await phone.getByLabel('Email').fill(email);
  await phone.getByLabel('Password').fill(password);
  await phone.getByRole('button', { name: 'Make my account' }).click();

  await expect(phone.getByText('Hi Sweksha.')).toBeVisible();
  await phone.getByRole('link', { name: 'Past sessions' }).click();
  await expect(phone.getByRole('heading', { name: `Session ${code}` })).toBeVisible();
  await expect(phone.getByText('Who came: Sweksha')).toBeVisible();
});

test('after submitting, a guest is offered to save their progress, and signing up brings them back', async ({ newPhone }) => {
  const phone = await newPhone();
  const { code } = await hostSession(phone, 'Rae');
  await phone.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(phone.getByText('✓ Submitted.')).toBeVisible();

  const saveBox = phone.getByRole('complementary', { name: 'Save your progress' });
  await saveBox.getByRole('link', { name: 'Sign up' }).click();
  await phone.getByLabel('Email').fill(newEmail());
  await phone.getByLabel('Password').fill(password);
  await phone.getByRole('button', { name: 'Make my account' }).click();

  // Back in the same session, still submitted, and no longer asked to save.
  await expect(phone).toHaveURL(new RegExp(`/s/${code}$`));
  await expect(phone.getByText('✓ Submitted.')).toBeVisible();
  await expect(saveBox).toBeHidden();
});

test('a login link only ever returns to a page on this site', async ({ newPhone }) => {
  const phone = await newPhone();
  const email = newEmail();
  await phone.goto('/signup');
  await phone.getByLabel('What should your friends call you?').fill('Lou');
  await phone.getByLabel('Email').fill(email);
  await phone.getByLabel('Password').fill(password);
  await phone.getByRole('button', { name: 'Make my account' }).click();
  await expect(phone.getByText('Hi Lou.')).toBeVisible();
  await phone.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Account' }).click();
  await phone.getByRole('button', { name: 'Log out' }).click();
  // Wait for the trip home to finish: leaving mid-navigation cuts off its request.
  await expect(phone).toHaveURL(/\/$/);
  await expect(phone.getByLabel('What should your friends call you?')).toBeVisible();

  await phone.goto('/login?next=//evil.example.com');
  await phone.getByLabel('Email').fill(email);
  await phone.getByLabel('Password').fill(password);
  await phone.getByRole('button', { name: 'Log in' }).click();
  await expect(phone.getByText('Hi Lou.')).toBeVisible();
  expect(new URL(phone.url()).pathname).toBe('/');
});

test('log out, then log back in on another phone with the same account', async ({ newPhone }) => {
  const laptop = await newPhone();
  const email = newEmail();
  await laptop.goto('/signup');
  await laptop.getByLabel('What should your friends call you?').fill('Alex');
  await laptop.getByLabel('Email').fill(email);
  await laptop.getByLabel('Password').fill(password);
  await laptop.getByRole('button', { name: 'Make my account' }).click();
  await expect(laptop.getByText('Hi Alex.')).toBeVisible();

  await laptop.getByRole('link', { name: 'Account' }).click();
  await expect(laptop.getByText(email, { exact: true })).toBeVisible();
  await laptop.getByRole('button', { name: 'Log out' }).click();
  await expect(laptop.getByRole('link', { name: 'Log in' }).first()).toBeVisible();

  const phone = await newPhone();
  await phone.goto('/login');
  await phone.getByLabel('Email').fill(email.toUpperCase());
  await phone.getByLabel('Password').fill('wrong password');
  await phone.getByRole('button', { name: 'Log in' }).click();
  await expect(phone.locator('.error')).toHaveText('Wrong email or password');

  await phone.getByLabel('Password').fill(password);
  await phone.getByRole('button', { name: 'Log in' }).click();
  await expect(phone.getByText('Hi Alex.')).toBeVisible();
});

test('forgot password: the emailed link sets a new password and works only once', async ({ newPhone }) => {
  const phone = await newPhone();
  const email = newEmail();
  await phone.goto('/signup');
  await phone.getByLabel('What should your friends call you?').fill('Sam');
  await phone.getByLabel('Email').fill(email);
  await phone.getByLabel('Password').fill(password);
  await phone.getByRole('button', { name: 'Make my account' }).click();
  await expect(phone.getByText('Hi Sam.')).toBeVisible();

  const other = await newPhone();
  await other.goto('/login');
  await other.getByRole('link', { name: 'Forgot your password?' }).click();
  // The login page has an Email box too: wait for the new page before typing.
  await expect(other.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await other.getByLabel('Email').fill(email);
  await other.getByRole('button', { name: 'Send me a link' }).click();
  await expect(other.getByRole('status')).toContainText(`account for ${email}`);

  const mail = await lastEmailTo(email);
  expect(mail.subject).toBe('Reset your Arbiter password');
  const link = /(http\S+#token=\S+)/.exec(mail.text)![1]!;

  await other.goto(link);
  await other.getByLabel('New password').fill('a completely new password');
  await other.getByRole('button', { name: 'Save and log in' }).click();
  await expect(other.getByText('Hi Sam.')).toBeVisible();

  // The reset signed out every other device.
  await phone.goto('/account');
  await expect(phone.getByText("You're using Arbiter as a guest", { exact: false })).toBeVisible();

  await other.goto(link);
  await other.getByLabel('New password').fill('yet another password');
  await other.getByRole('button', { name: 'Save and log in' }).click();
  await expect(other.locator('.error')).toContainText('expired or was already used');
});

test('changing the password keeps this phone signed in and signs out the others', async ({ newPhone }) => {
  const phone = await newPhone();
  const email = newEmail();
  await becomeGuest(phone, 'Kai');
  await phone.goto('/signup');
  await expect(phone.getByText('Signing up as Kai')).toBeVisible();
  await phone.getByLabel('Email').fill(email);
  await phone.getByLabel('Password').fill(password);
  await phone.getByRole('button', { name: 'Make my account' }).click();
  await expect(phone.getByText('Hi Kai.')).toBeVisible();

  const tablet = await newPhone();
  await tablet.goto('/login');
  await tablet.getByLabel('Email').fill(email);
  await tablet.getByLabel('Password').fill(password);
  await tablet.getByRole('button', { name: 'Log in' }).click();
  await expect(tablet.getByText('Hi Kai.')).toBeVisible();

  await phone.goto('/account');
  await phone.getByLabel('Current password').fill(password);
  await phone.getByLabel('New password').fill('a new password for kai');
  await phone.getByRole('button', { name: 'Change password' }).click();
  await expect(phone.getByRole('status')).toContainText('Password changed');

  await tablet.goto('/history');
  await expect(tablet.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
  await phone.goto('/history');
  await expect(phone.getByRole('heading', { name: 'Past sessions' })).toBeVisible();
  await expect(phone.getByRole('link', { name: 'Account' })).toBeVisible();
});

test('typing into a form before the page has finished loading is kept (BUG-013)', async ({ newPhone }) => {
  const phone = await newPhone();
  // Hold back the page's JavaScript so the form is plain HTML while we type.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await phone.route('**/_next/static/chunks/**', async (route) => {
    await held;
    await route.continue();
  });

  await phone.goto('/login', { waitUntil: 'commit' });
  await phone.getByLabel('Email').fill('early@example.com');
  release();

  // Once the app has taken over, the header shows its links; the typed email must still be there.
  await expect(phone.getByRole('link', { name: 'Sign up' }).first()).toBeVisible();
  await expect(phone.getByLabel('Email')).toHaveValue('early@example.com');
});

test('the email link from signup confirms the address, and the account page stops asking', async ({ newPhone }) => {
  const phone = await newPhone();
  const email = newEmail();
  await phone.goto('/signup');
  await phone.getByLabel('What should your friends call you?').fill('Vee');
  await phone.getByLabel('Email').fill(email);
  await phone.getByLabel('Password').fill(password);
  await phone.getByRole('button', { name: 'Make my account' }).click();
  await expect(phone.getByText('Hi Vee.')).toBeVisible();

  await phone.goto('/account');
  await expect(phone.getByText('Confirm your email.')).toBeVisible();
  await phone.getByRole('button', { name: 'Send the link again' }).click();
  await expect(phone.getByRole('status')).toHaveText('Sent. The new link works for 24 hours.');

  const mail = await lastEmailTo(email);
  expect(mail.subject).toBe('Confirm your email for Arbiter');
  await phone.goto(/(http\S+#token=\S+)/.exec(mail.text)![1]!);
  await expect(phone.getByRole('status')).toContainText('your email is confirmed');

  await phone.goto('/account');
  await expect(phone.getByRole('heading', { name: 'Change your password' })).toBeVisible();
  await expect(phone.getByText('Confirm your email.')).toHaveCount(0);
});

test('a guest who logs in mid-session stays in it as the same person, and keeps their answers', async ({ newPhone }) => {
  // An account made earlier, on another device.
  const laptop = await newPhone();
  const email = newEmail();
  await laptop.goto('/signup');
  await laptop.getByLabel('What should your friends call you?').fill('Mo');
  await laptop.getByLabel('Email').fill(email);
  await laptop.getByLabel('Password').fill(password);
  await laptop.getByRole('button', { name: 'Make my account' }).click();
  await expect(laptop.getByText('Hi Mo.')).toBeVisible();

  // Today, on a phone, as a guest: hosting a session and submitting.
  const phone = await newPhone();
  const { code } = await hostSession(phone, 'Mo on a phone');
  await phone.getByText('I need vegetarian options').click();
  await phone.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(phone.getByText('✓ Submitted.')).toBeVisible();

  await phone.getByRole('complementary', { name: 'Save your progress' }).getByRole('link', { name: 'Log in' }).click();
  await phone.getByLabel('Email').fill(email);
  await phone.getByLabel('Password').fill(password);
  await phone.getByRole('button', { name: 'Log in' }).click();

  // Back in the session as the account: still the host, still submitted.
  await expect(phone).toHaveURL(new RegExp(`/s/${code}$`));
  await expect(phone.getByText('✓ Submitted.')).toBeVisible();
  await expect(phone.getByText('Your session')).toBeVisible();
  await expect(phone.getByText('1 of 1 submitted')).toBeVisible();
  await expect(phone.getByRole('complementary', { name: 'Save your progress' })).toBeHidden();

  // The answers just used are now the account's saved ones.
  await phone.goto('/preferences');
  await expect(phone.getByLabel('I need vegetarian options')).toBeChecked();
});

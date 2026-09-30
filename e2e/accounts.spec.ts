import { randomUUID } from 'node:crypto';

import { enterName, expect, hostSession, lastEmailTo, test } from './helpers';

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
  await expect(laptop.getByText(email)).toBeVisible();
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
  await phone.goto('/');
  await enterName(phone, 'Kai');
  await phone.goto('/signup');
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

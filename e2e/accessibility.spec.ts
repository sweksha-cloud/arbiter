import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { becomeGuest, expect, joinSession, test } from './helpers';

/** Fails on any WCAG 2.1 A or AA problem axe can detect automatically, listing each one. */
async function expectNoViolations(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`).join('\n  ')}`);
  expect(summary, `accessibility problems on ${screen}`).toEqual([]);
}

test('every main screen passes automated WCAG 2.1 AA checks', async ({ newPhone }) => {
  const host = await newPhone();

  await host.goto('/');
  await expect(host.getByLabel('What should your friends call you?')).toBeVisible();
  await expectNoViolations(host, 'home for a first-time visitor');

  await becomeGuest(host, 'Sweksha');
  await host.goto('/');
  await expect(host.getByText('Hi Sweksha.')).toBeVisible();
  await expectNoViolations(host, 'home');

  await host.goto('/preferences');
  await expect(host.getByRole('button', { name: /save/i })).toBeVisible();
  // Selected states have their own colours: one cuisine liked, one disliked, then saved.
  await host.getByRole('button', { name: /thai$/ }).click();
  await host.getByRole('button', { name: /pizza$/ }).click();
  await host.getByRole('button', { name: /pizza$/ }).click();
  await host.getByLabel('Protein at least (g)').fill('30');
  await host.getByLabel('Peanuts').check();
  await host.getByRole('button', { name: /save/i }).click();
  await expect(host.locator('.success')).toBeVisible();
  await expectNoViolations(host, 'saved preferences, with choices and a success message');

  await host.goto('/');
  await host.getByRole('button', { name: 'Start a session' }).click();
  await expect(host.getByText('Invite your friends')).toBeVisible();
  const invite = await host.getByLabel('Invite link').inputValue();
  await expectNoViolations(host, 'the session lobby');

  const friend = await newPhone();
  await joinSession(friend, invite, 'Alex');
  // A nutrition goal, so results include the published-nutrition box.
  await host.getByLabel('Calories at most').fill('700');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(host.getByText('1 of 2 submitted')).toBeVisible();
  await expectNoViolations(host, 'the lobby with a "submitted" badge');
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(host.locator('article').first()).toBeVisible();
  await expectNoViolations(host, 'results');

  // Pressed like and dislike buttons.
  await host.locator('article').nth(0).getByRole('button', { name: /👍/ }).click();
  await host.locator('article').nth(1).getByRole('button', { name: /👎/ }).click();
  await expect(host.locator('article').nth(1).getByRole('button', { name: /👎 1/ })).toBeVisible();
  await host.locator('article').nth(0).getByRole('button', { name: /^Vegan/ }).click();
  await expect(host.locator('article').nth(0).getByRole('button', { name: /^Vegan/ })).toHaveAttribute('aria-pressed', 'true');
  await host.locator('article details summary').first().click(); // An expanded "Hours" or locations list.
  await expectNoViolations(host, 'results with reactions and a nutrition mark');

  // Dark mode has its own colors, so check them too.
  await host.emulateMedia({ colorScheme: 'dark' });
  await expectNoViolations(host, 'results with reactions (dark mode)');
  await host.goto('/preferences');
  await expect(host.getByRole('button', { name: /save/i })).toBeVisible();
  await host.getByRole('button', { name: /save/i }).click();
  await expect(host.locator('.success')).toBeVisible();
  await expectNoViolations(host, 'saved preferences with choices (dark mode)');
  await host.emulateMedia({ colorScheme: 'light' });

  await host.goto('/s/ZZ99ZZ');
  await expect(host.getByText(/can.t find session/i)).toBeVisible();
  await expectNoViolations(host, 'session not found');
});

test('the account pages pass automated WCAG 2.1 AA checks', async ({ newPhone }) => {
  const phone = await newPhone();
  for (const [url, heading] of [
    ['/login', 'Log in'],
    ['/signup', 'Make an account'],
    ['/forgot-password', 'Reset your password'],
    ['/reset-password#token=example', 'Choose a new password'],
    ['/verify-email#token=example', 'Confirm your email'],
    ['/terms', 'Terms of Use'],
    ['/privacy', 'Privacy Policy'],
    ['/history', 'Past sessions']
  ] as const) {
    await phone.goto(url);
    await expect(phone.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expectNoViolations(phone, url);
  }

  // Error messages have their own colour; show one in light and dark mode.
  await phone.goto('/login');
  await phone.getByLabel('Email').fill('nobody@example.com');
  await phone.getByLabel('Password').fill('wrong password');
  await phone.getByRole('button', { name: 'Log in' }).click();
  await expect(phone.locator('.error')).toBeVisible();
  await expectNoViolations(phone, 'login with an error');
  await phone.emulateMedia({ colorScheme: 'dark' });
  await expectNoViolations(phone, 'login with an error (dark mode)');
  await phone.emulateMedia({ colorScheme: 'light' });

  await phone.goto('/signup');
  await phone.getByLabel('What should your friends call you?').fill('Sam');
  await phone.getByLabel('Email').fill(`a11y-${Date.now()}@example.com`);
  await phone.getByLabel('Password').fill('correct horse battery');
  await phone.getByRole('button', { name: 'Make my account' }).click();
  await expect(phone.getByText('Hi Sam.')).toBeVisible();
  for (const [url, heading] of [
    ['/account', 'Your account'],
    ['/history', 'Past sessions']
  ] as const) {
    await phone.goto(url);
    await expect(phone.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expectNoViolations(phone, `${url} (logged in)`);
  }
});

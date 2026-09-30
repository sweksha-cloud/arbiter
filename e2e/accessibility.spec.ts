import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { enterName, expect, joinSession, test } from './helpers';

/** Fails on any WCAG 2.1 A or AA problem axe can detect automatically, listing each one. */
async function expectNoViolations(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`).join('\n  ')}`);
  expect(summary, `accessibility problems on ${screen}`).toEqual([]);
}

test('every main screen passes automated WCAG 2.1 AA checks', async ({ newPhone }) => {
  const host = await newPhone();

  await host.goto('/');
  await expect(host.getByRole('textbox')).toBeVisible();
  await expectNoViolations(host, 'the name form');

  await enterName(host, 'Sweksha');
  await expect(host.getByRole('button', { name: 'Start a session' })).toBeVisible();
  await expectNoViolations(host, 'home');

  await host.goto('/preferences');
  await expect(host.getByRole('button', { name: /save/i })).toBeVisible();
  await expectNoViolations(host, 'saved preferences');

  await host.goto('/');
  await host.getByRole('button', { name: 'Start a session' }).click();
  await expect(host.getByText('Invite your friends')).toBeVisible();
  const invite = await host.getByLabel('Invite link').inputValue();
  await expectNoViolations(host, 'the session lobby');

  const friend = await newPhone();
  await joinSession(friend, invite, 'Alex');
  await host.getByRole('button', { name: 'Submit', exact: true }).click();
  await friend.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(host.locator('article').first()).toBeVisible();
  await expectNoViolations(host, 'results');

  // Dark mode has its own colors, so check them too.
  await host.emulateMedia({ colorScheme: 'dark' });
  await expectNoViolations(host, 'results (dark mode)');
  await host.goto('/preferences');
  await expect(host.getByRole('button', { name: /save/i })).toBeVisible();
  await expectNoViolations(host, 'saved preferences (dark mode)');
  await host.emulateMedia({ colorScheme: 'light' });

  await host.goto('/s/ZZ99ZZ');
  await expect(host.getByText(/can.t find session/i)).toBeVisible();
  await expectNoViolations(host, 'session not found');
});

import { test as base, devices, expect, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';

import { WEB_URL } from './api-server';

export { expect };

const PHONE: BrowserContextOptions = { ...devices['Pixel 7'], baseURL: WEB_URL };
const ALLOWED_LOCATION: BrowserContextOptions = {
  geolocation: { latitude: 37.3352, longitude: -121.8811 },
  permissions: ['geolocation']
};

interface PhoneOptions {
  /** Leave the location prompt unanswered instead of allowing it. */
  ignoreLocationPrompt?: boolean;
}

export const test = base.extend<{ newPhone: (options?: PhoneOptions) => Promise<Page> }>({
  /**
   * Opens a new phone with its own storage, so it gets its own guest identity.
   * The test fails if any phone hits an uncaught error in the page.
   */
  newPhone: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    const errors: string[] = [];
    await use(async ({ ignoreLocationPrompt = false } = {}) => {
      // Any `permissions` list, even an empty one, makes Chromium answer the
      // prompt itself, so an unanswered prompt needs the option left out.
      const context = await browser.newContext(ignoreLocationPrompt ? PHONE : { ...PHONE, ...ALLOWED_LOCATION });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      return page;
    });
    await Promise.all(contexts.map((context) => context.close()));
    expect(errors, 'uncaught errors in the page').toEqual([]);
  }
});

/** Fills in the name form shown to first-time visitors. */
export async function enterName(page: Page, name: string): Promise<void> {
  await page.getByRole('textbox').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Opens the home page as a new guest and starts a session. Returns its invite link and code. */
export async function hostSession(page: Page, name: string): Promise<{ invite: string; code: string }> {
  await page.goto('/');
  await enterName(page, name);
  await page.getByRole('button', { name: 'Start a session' }).click();
  await expect(page.getByText('Invite your friends')).toBeVisible();
  const invite = await page.getByLabel('Invite link').inputValue();
  const code = invite.split('/s/')[1] ?? '';
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  return { invite, code };
}

/** Opens an invite link as a new guest. */
export async function joinSession(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(invite);
  await enterName(page, name);
}

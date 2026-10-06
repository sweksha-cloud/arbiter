import { test as base, devices, expect, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { OUTBOX_DIR, WEB_URL } from './api-server';

export { expect };

/** A phone for each browser engine: an Android phone in Chromium, an iPhone in WebKit (Safari's engine). */
const PHONES: Record<string, BrowserContextOptions> = {
  chromium: { ...devices['Pixel 7'], baseURL: WEB_URL },
  webkit: { ...devices['iPhone 14'], baseURL: WEB_URL }
};
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
  newPhone: async ({ browser, browserName }, use) => {
    const PHONE = PHONES[browserName]!;
    const contexts: BrowserContext[] = [];
    const errors: string[] = [];
    await use(async ({ ignoreLocationPrompt = false } = {}) => {
      // Any `permissions` list, even an empty one, makes Chromium answer the
      // prompt itself, so an unanswered prompt needs the option left out.
      const context = await browser.newContext(ignoreLocationPrompt ? PHONE : { ...PHONE, ...ALLOWED_LOCATION });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', (error) => {
        // WebKit reports a background page preload cancelled by navigating away
        // as "Fetch API cannot load …?_rsc=… due to access control checks".
        // Next.js preloads links this way; nothing breaks and nobody sees it.
        if (browserName === 'webkit' && /_rsc=\S* due to access control checks/.test(error.message)) return;
        errors.push(error.message);
      });
      // The Content Security Policy must never block anything the app itself needs.
      page.on('console', (message) => {
        if (/Content Security Policy/i.test(message.text())) errors.push(message.text());
      });
      return page;
    });
    await Promise.all(contexts.map((context) => context.close()));
    expect(errors, 'uncaught errors or blocked content in the page').toEqual([]);
  }
});

/** Fills in the name form shown to first-time visitors. */
export async function enterName(page: Page, name: string): Promise<void> {
  await page.getByRole('textbox').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Becomes a guest without starting a session (the home page's name form also starts one). */
export async function becomeGuest(page: Page, name: string): Promise<void> {
  await page.goto('/preferences');
  await enterName(page, name);
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
}

/** A new guest's first step on the home page: their name, then "Start a session". */
export async function startAs(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('What should your friends call you?').fill(name);
  await page.getByRole('button', { name: 'Start a session' }).click();
}

export interface Setup {
  mode?: 'area' | 'between';
  /** A place to type; without one, "Use my current location". */
  place?: string;
}

/**
 * On the setup page: chooses where to meet, then "Create session". Ends in
 * the lobby, with the host's code and link pinned at the top.
 */
export async function setUpSession(page: Page, { mode = 'area', place }: Setup = {}): Promise<void> {
  await expect(page.getByRole('heading', { name: 'New session', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: mode === 'area' ? 'Search around an area' : 'Find a spot between us' }).click();
  const label = mode === 'area' ? 'Search near' : 'Where are you coming from?';
  if (place) {
    await page.getByLabel(`${label}: type a place`).fill(place);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText(`📍 ${place} (sample)`)).toBeVisible();
  } else {
    await page.getByRole('button', { name: /Use my current location/ }).click();
    await expect(page.getByText('📍 Your current location')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Create session' }).click();
  await expect(page.getByText('Your session')).toBeVisible();
}

/**
 * Opens the home page as a new guest, sets up a session (by default searching
 * around this phone's location) and creates it. Returns its invite link and code.
 */
export async function hostSession(page: Page, name: string, setup?: Setup): Promise<{ invite: string; code: string }> {
  await startAs(page, name);
  await setUpSession(page, setup);
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

/** The newest email the server "sent" to this address (written to OUTBOX_DIR). */
export async function lastEmailTo(address: string): Promise<{ to: string; subject: string; text: string }> {
  let found: { to: string; subject: string; text: string } | undefined;
  await expect
    .poll(async () => {
      const files = (await readdir(OUTBOX_DIR).catch(() => [])).filter((f) => f.includes(address)).sort();
      const newest = files.at(-1);
      found = newest ? JSON.parse(await readFile(path.join(OUTBOX_DIR, newest), 'utf8')) : undefined;
      return found;
    })
    .toBeTruthy();
  return found!;
}

/** Results open as a swipe deck (TRADEOFFS.md 22); this switches to the list of every place. */
export async function showList(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'See all as a list' }).click();
}


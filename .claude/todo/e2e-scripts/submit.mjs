import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors = [];
async function ctx(name) {
  const c = await browser.newContext({ ...mobile, geolocation: { latitude: 37.3352, longitude: -121.8811 }, permissions: ['geolocation'] });
  const p = await c.newPage();
  p.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  return p;
}
const host = await ctx('host');
const friend = await ctx('friend');

await host.goto('http://localhost:3000');
await host.fill('input', 'Sweksha');
await host.click('text=Continue');
await host.click('text=Start a session');
await host.getByText('0 of 1 submitted').waitFor();
const invite = await host.getByLabel('Invite link').inputValue();
console.log('host in session immediately with invite:', invite);

// Host submits alone: must NOT jump to results.
await host.click('text=I need vegetarian options');
await host.getByRole('button', { name: 'Submit', exact: true }).click();
await host.getByText('1 of 1 submitted').waitFor();
await host.waitForTimeout(500);
console.log('results shown with host alone?', (await host.locator('article').count()) > 0);
await host.screenshot({ path: `${out}/1-host-alone-submitted.png`, fullPage: true });

await friend.goto(invite);
await friend.fill('input', 'Alex');
await friend.click('text=Continue');
await friend.getByText('1 of 2 submitted').waitFor();
await host.getByText('1 of 2 submitted').waitFor();
console.log('both see 1 of 2 submitted');
await friend.screenshot({ path: `${out}/2-friend-1-of-2.png`, fullPage: true });
await host.screenshot({ path: `${out}/3-host-1-of-2.png`, fullPage: true });

// Friend submits -> results appear for both, no button press.
await friend.click('text=No fast food');
await friend.getByRole('button', { name: 'Submit', exact: true }).click();
await Promise.all([host.locator('article').first().waitFor(), friend.locator('article').first().waitFor()]);
console.log('results appeared automatically for both:', await host.locator('article h3').allTextContents());
await friend.locator('article').first().getByRole('button', { name: /👍/ }).click();
await host.locator('article').first().getByRole('button', { name: '👍 1' }).waitFor();
console.log('live reaction reached host');
await host.screenshot({ path: `${out}/4-host-results.png`, fullPage: true });
console.log('errors', errors);
await browser.close();

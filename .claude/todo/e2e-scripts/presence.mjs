import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, geolocation: { latitude: 37.3352, longitude: -121.8811 }, permissions: ['geolocation'] };
const errors = [];
const watch = (p, name) => {
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !m.text().includes('ERR_INTERNET_DISCONNECTED') && errors.push(`${name}: ${m.text()}`));
  return p;
};
const hostCtx = await browser.newContext(mobile);
const friendCtx = await browser.newContext(mobile);
let host = watch(await hostCtx.newPage(), 'host');
const friend = watch(await friendCtx.newPage(), 'friend');

await host.goto('http://localhost:3000');
await host.fill('input', 'Sweksha');
await host.click('text=Continue');
await host.click('text=Start a session');
const invite = await host.getByLabel('Invite link').inputValue();
const code = invite.split('/s/')[1];
await friend.goto(invite);
await friend.fill('input', 'Alex');
await friend.click('text=Continue');
await friend.getByText('0 of 2 submitted').waitFor();

// 1. Host goes back to the home page mid-session -> rejoin banner.
await host.click('text=← Home');
await host.getByText(`You're in session ${code}`).waitFor();
console.log('1. home shows rejoin banner for', code);
await host.screenshot({ path: `${out}/1-home-rejoin.png`, fullPage: true });

// 2. Friend sees host left (after the grace period), not immediately.
await friend.waitForTimeout(1500);
console.log('2a. notice within 1.5s (should be false):', await friend.getByText('has left the session').count() > 0);
await friend.getByText('Sweksha (the host) has left the session for now').waitFor({ timeout: 10000 });
console.log('2b. friend sees host-left notice');
await friend.screenshot({ path: `${out}/2-friend-host-left.png`, fullPage: true });

// 3. Host rejoins from the banner -> notice goes away for friend.
await host.getByRole('link', { name: 'Rejoin' }).click();
await host.getByText('0 of 2 submitted').waitFor();
await friend.getByText('has left the session').waitFor({ state: 'detached' });
console.log('3. host rejoined, friend notice cleared');

// 4. Host closes the tab entirely, opens the site again -> banner still offers rejoin.
await host.close();
host = watch(await hostCtx.newPage(), 'host2');
await host.goto('http://localhost:3000');
await host.getByText(`You're in session ${code}`).waitFor();
console.log('4. after closing the tab, home still offers rejoin');

// 5. Dismiss hides it.
await host.getByRole('button', { name: 'Dismiss' }).click();
console.log('5. dismissed, banner gone:', (await host.getByText("You're in session").count()) === 0);

// 6. Friend loses connection -> banner; comes back -> "Back online" then gone.
await friendCtx.setOffline(true);
await friend.getByText('You’re offline').waitFor();
console.log('6a. offline banner shown');
await friend.screenshot({ path: `${out}/3-offline.png` });
await friendCtx.setOffline(false);
await friend.getByText('Back online').waitFor({ timeout: 30000 });
console.log('6b. back online shown');
await friend.getByText('Back online').waitFor({ state: 'detached', timeout: 10000 });
console.log('6c. banner cleared');
console.log('errors', errors);
await browser.close();

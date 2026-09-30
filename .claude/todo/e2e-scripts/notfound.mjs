import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const errors = [];
const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, geolocation: { latitude: 37.3352, longitude: -121.8811 }, permissions: ['geolocation'] });
const p = await c.newPage();
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

// Old link, new visitor: name first, then the not-found screen.
await p.goto('http://localhost:3000/s/zz99zz');
await p.fill('input', 'Sam');
await p.click('text=Continue');
await p.getByText("We can't find session").waitFor();
console.log('heading:', await p.locator('h1').innerText());
await p.screenshot({ path: `${out}/1-not-found.png`, fullPage: true });

// "Enter a different code" with another bad code: stays on the screen with the new code.
await p.getByPlaceholder('e.g. K7QM3X').fill('abc123');
await p.click('text=Join session');
await p.getByText('ABC123').waitFor();
console.log('after bad code:', await p.locator('h1').innerText());

// Start a new session from the screen.
await p.click('text=Start a new session');
await p.getByText('Invite your friends').waitFor();
const invite = await p.getByLabel('Invite link').inputValue();
console.log('new session started:', invite);

// Lowercase link to a real session works.
const lower = invite.replace(/\/s\/(\w+)$/, (_, c) => `/s/${c.toLowerCase()}`);
const p2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await p2.goto(lower);
await p2.fill('input', 'Kai');
await p2.click('text=Continue');
await p2.getByText('Invite your friends').waitFor();
console.log('lowercase link joined OK:', lower);
console.log('errors', errors);
await browser.close();

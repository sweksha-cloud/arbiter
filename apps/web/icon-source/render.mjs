// Renders the app icons from icon.svg and icon-maskable.svg into every size
// the website and the installed app use. Run from the repo root:
//   node apps/web/icon-source/render.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const outputs = [
  ['icon.svg', 'public/icons/icon-192.png', 192],
  ['icon.svg', 'public/icons/icon-512.png', 512],
  ['icon-maskable.svg', 'public/icons/icon-maskable-512.png', 512],
  ['icon.svg', 'app/icon.png', 64],
  ['icon.svg', 'app/apple-icon.png', 180]
];

const browser = await chromium.launch();
for (const [source, target, size] of outputs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const svg = readFileSync(join(here, source), 'utf8');
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: join(web, target), omitBackground: false });
  await page.close();
  console.log(`${target} (${size}×${size})`);
}
await browser.close();

import { chromium } from '@playwright/test';
import { readFileSync, copyFileSync, writeFileSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:256px;height:256px}</style>${readFileSync('public/sakuya.svg', 'utf8')}`);
  await page.screenshot({ path: 'electron/sakuya.png', omitBackground: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  const images = []; let offset = header.length;
  for (const [i, size] of sizes.entries()) {
    await page.setViewportSize({ width: size, height: size });
    await page.locator('svg').evaluate((el, n) => { el.style.width = `${n}px`; el.style.height = `${n}px`; }, size);
    const png = await page.screenshot({ omitBackground: true }); images.push(png);
    const at = 6 + i * 16; header[at] = size === 256 ? 0 : size; header[at + 1] = header[at];
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12); offset += png.length;
  }
  writeFileSync('electron/sakuya.ico', Buffer.concat([header, ...images]));
} finally { await browser.close(); }
copyFileSync('public/sakuya.svg', 'public/favicon.svg');
console.log('Sakuya SVG, PNG and Windows ICO generated.');

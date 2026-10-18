import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((value) => localStorage.setItem('cargomove-home-theme', value), theme);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3000/previews/track-status.html');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `.tmp-track-blend-${theme}.png` });
  console.log(theme, await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, gradient: getComputedStyle(document.querySelector('.cm-track-hero'), '::before').backgroundImage })));
  await context.close();
}
await browser.close();

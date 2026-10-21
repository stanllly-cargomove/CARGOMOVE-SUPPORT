// Resize the existing CargoMove favicon; no generated or replacement branding.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const source = `data:image/webp;base64,${(await readFile('media/cargomove-favicon.webp')).toString('base64')}`;
  await mkdir('public/icons', { recursive: true });
  for (const [name, size, inset] of [
    ['icon-192.png', 192, 0.08],
    ['icon-512.png', 512, 0.08],
    ['icon-maskable-512.png', 512, 0.18],
    ['apple-touch-icon.png', 180, 0.08],
  ] as const) {
    const png = await page.evaluate(async ({ source, size, inset }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(image, size * inset, size * inset, size * (1 - inset * 2), size * (1 - inset * 2));
      return canvas.toDataURL('image/png').split(',')[1];
    }, { source, size, inset });
    await writeFile(`public/icons/${name}`, Buffer.from(png, 'base64'));
    console.log(`Created ${name} (${size}×${size})`);
  }
} finally {
  await browser.close();
}

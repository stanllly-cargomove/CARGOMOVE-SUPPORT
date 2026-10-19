import type { Page } from 'playwright-core';

export async function selectEirTime(page: Page, timestamp: string) {
  await page.getByRole('button', { name: 'EIR time (Malaysia)', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'EIR time (Malaysia) picker', exact: true });
  const target = timestamp.slice(0,10);
  for (let attempts=0; attempts<120; attempts++) {
    if (await picker.getByRole('button', { name: target, exact: true }).count()) break;
    const current = await picker.getByRole('button', { name: /^\d{4}-\d{2}-01$/, exact: true }).getAttribute('aria-label');
    await picker.getByRole('button', { name: current! < target ? 'Next month' : 'Previous month', exact: true }).click();
  }
  await picker.getByRole('button', { name: target, exact: true }).click();
  await picker.getByRole('option', { name: `Hour ${timestamp.slice(11,13)}`, exact: true }).click();
  await picker.getByRole('option', { name: `Minute ${timestamp.slice(14,16)}`, exact: true }).click();
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
}

import { expect, openApp, openNote, test } from './helpers';

// #115: footnote links jump inside the note; they must not go through the hash router.
test('115 footnote reference and back link stay on the note', async ({ page, api, vault }) => {
  const filler = Array.from({ length: 80 }, (_, i) => `Line ${i}.`).join('\n\n');
  await api.write(vault.id, 'Fn.md', `# Fn\n\nSee the note[^a].\n\n${filler}\n\n[^a]: The footnote text.\n`);
  await openApp(page, vault.id);
  await openNote(page, 'Fn.md');
  await page.getByTestId('mode-read').click();
  const url = page.url();
  await page.locator('sup.fn a').click();
  await expect(page.locator('li#fn-1')).toBeInViewport();
  expect(page.url()).toBe(url);
  await expect(page.locator('.note-title')).toHaveText('Fn');
  await page.locator('a.fn-back').click();
  await expect(page.locator('sup.fn a')).toBeInViewport();
  expect(page.url()).toBe(url);
});

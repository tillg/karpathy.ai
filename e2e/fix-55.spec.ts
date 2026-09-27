import { expect, openApp, openNote, test } from './helpers';

// #55: a missing-link style updates when the page appears elsewhere (AI, other device).
test('a link to a missing page turns normal once the page is created, in Read and Write mode', async ({ page, api, vault }) => {
  await api.write(vault.id, 'Links.md', '# Links\n\nSee [[Later page]].\n');
  await openApp(page, vault.id);
  await openNote(page, 'Links.md');
  await expect(page.locator('.cm-wl[data-target="Later page"]')).toHaveClass(/cm-wl-miss/);
  await page.getByTestId('mode-read').click();
  const link = page.locator('.rd a.wl[data-target="Later page"]');
  await expect(link).toHaveClass(/miss/);

  await api.write(vault.id, 'Later page.md', '# Later page\n');
  await expect(link).not.toHaveClass(/miss/);
  await page.getByTestId('mode-write').click();
  await expect(page.locator('.cm-wl[data-target="Later page"]')).not.toHaveClass(/cm-wl-miss/);
  await page.getByTestId('mode-read').click();
  await page.locator('.rd a.wl[data-target="Later page"]').click();
  await expect(page.locator('.note-title')).toHaveText('Later page');
});

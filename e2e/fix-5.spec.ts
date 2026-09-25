import { expect, openApp, openNote, test } from './helpers';

// Issue #5: the URL reflects vault + note; Back/Forward and reload work.
test('hash route: Back/Forward between notes, reload keeps the note (#5)', async ({ page, vault }) => {
  await openApp(page, vault.id);
  await expect(page).toHaveURL(new RegExp(`#/${vault.id}$`));
  await openNote(page, 'Home.md');
  await expect(page).toHaveURL(new RegExp(`#/${vault.id}/Home\\.md$`));
  await page.locator('.cm-wl[data-target="Ideas"]').click();
  await expect(page.locator('.note-title')).toHaveText('Ideas');
  await expect(page).toHaveURL(new RegExp(`#/${vault.id}/Ideas\\.md$`));
  expect(page.url()).not.toContain('token');

  await page.goBack();
  await expect(page.locator('.note-title')).toHaveText('Home');
  await page.goForward();
  await expect(page.locator('.note-title')).toHaveText('Ideas');

  await page.reload();
  await expect(page.locator('.note-title')).toHaveText('Ideas');
  await expect(page.locator('.cm-content')).toContainText('Back to');

  await page.goBack();
  await expect(page.locator('.note-title')).toHaveText('Home');
  await page.goBack();
  await expect(page.locator('.note-title')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/${vault.id}$`));
});

test('@iphone system Back pops the note off the tab (#5)', async ({ page, vault }) => {
  await openApp(page, vault.id);
  const app = page.locator('#app');
  await page.locator(`[data-testid="tree-item"][data-path="Home.md"]`).click();
  await expect(app).toHaveAttribute('data-dt', 'cur');
  await page.goBack();
  await expect(app).toHaveAttribute('data-sb', 'cur');
});

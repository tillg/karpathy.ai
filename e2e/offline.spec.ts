import { expect, openApp, openNote, test, treeItem } from './helpers';

test.describe('offline mode', () => {
  test('going offline: banner, open note stays readable, editing disabled', async ({ page, context, vault }) => {
    await openApp(page, vault.id);
    await openNote(page, 'Home.md');
    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('Welcome to the test vault');
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
    await expect(page.getByTestId('save-state')).toContainText('read-only');
    await expect(page.getByTestId('new-note')).toBeDisabled();
    await expect(page.getByTestId('delete-note')).toBeDisabled();
    await context.setOffline(false);
    await expect(page.getByTestId('offline-banner')).toBeHidden();
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
  });

  // Bug #1 (fixed): the dev stack now serves a service worker. Chromium refuses to register one
  // over the dev stack's self-signed certificate unless certificate errors are ignored.
  test.describe(() => {
    test.use({ launchOptions: { args: ['--ignore-certificate-errors'] } });
    test('offline: a previously opened note renders from the cache (also after a reload)', async ({ page, context, vault }) => {
      await openApp(page, vault.id);
      // Notes are cached as they are fetched through the service worker.
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
      await openNote(page, 'Home.md');
      await openNote(page, 'Ideas.md');
      await context.setOffline(true);
      await expect(page.getByTestId('offline-banner')).toBeVisible();
      // The file tree stays browsable from the cache.
      await expect(treeItem(page, 'Home.md')).toBeVisible({ timeout: 8_000 });
      await treeItem(page, 'Home.md').click();
      await expect(page.locator('.note-title')).toHaveText('Home', { timeout: 8_000 });
      await expect(page.locator('.cm-content')).toContainText('Welcome to the test vault');

      await page.reload();
      await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 8_000 });
      await treeItem(page, 'Ideas.md').click({ timeout: 8_000 });
      await expect(page.locator('.cm-content')).toContainText('Back to');
    });
  });
});

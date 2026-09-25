import { expect, openApp, openNote, test } from './helpers';

// Issue #17: following a wikilink in Read mode stays in Read mode.
test('wikilink in Read mode opens the target in Read mode (#17)', async ({ page, vault }) => {
  await openApp(page, vault.id);
  await openNote(page, 'Home.md');
  await page.getByTestId('mode-read').click();
  await page.getByTestId('read-view').locator('a.wl[data-target="Ideas"]').click();
  await expect(page.locator('.note-title')).toHaveText('Ideas');
  await expect(page.getByTestId('mode-read')).toHaveClass(/on/);
  await expect(page.getByTestId('read-view')).toContainText('Back to');
  await expect(page.locator('.cm-content')).toHaveCount(0);
});

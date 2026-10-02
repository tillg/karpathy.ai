import { expect, openApp, openNote, test } from './helpers';

// #104: narrowing to the phone layout with a note open keeps the note pushed.
test('104 narrowing to phone width keeps the open note visible', async ({ page, vault }) => {
  await openApp(page, vault.id);
  await openNote(page, 'Home.md');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-dt', 'cur');
  await expect(page.locator('.note-title')).toBeVisible();
});

import { expect, openApp, test, treeItem } from './helpers';

// #100: the file tree scrolls the open note's row into view when the open note changes.
test('100 tree scrolls to a note opened via URL', async ({ page, api, vault }) => {
  for (let i = 0; i < 60; i++) await api.write(vault.id, `a${String(i).padStart(2, '0')}.md`, `# A${i}\n`);
  await api.write(vault.id, 'zzz-last.md', '# Last\n');
  await openApp(page, vault.id);
  await expect(treeItem(page, 'zzz-last.md')).not.toBeInViewport(); // the tree overflows
  await page.evaluate((id) => { location.hash = `#/${id}/zzz-last.md`; }, vault.id);
  await expect(page.locator('.note-title')).toHaveText('zzz-last');
  const row = treeItem(page, 'zzz-last.md');
  await expect(row).toHaveAttribute('aria-current', 'page');
  await expect(row).toBeInViewport();
});

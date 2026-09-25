import { expect, openApp, test, treeItem } from './helpers';

// #6: a new note whose name differs only in case from an existing one is refused with a clear message.
test('new note differing only in case from an existing note is refused', async ({ page, api, vault }) => {
  page.on('dialog', (d) => void d.accept('IDEAS'));
  await openApp(page, vault.id);
  await expect(treeItem(page, 'Ideas.md')).toBeVisible();
  await page.getByTestId('new-note').click();
  await expect(page.getByTestId('toast')).toContainText('"Ideas.md" already exists');
  await expect(page.getByTestId('toast')).toContainText('case');
  expect(await api.file(vault.id, 'IDEAS.md')).toBeNull();
});

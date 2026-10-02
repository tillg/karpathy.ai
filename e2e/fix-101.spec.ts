import { expect, openApp, openNote, test, typeAtEnd, waitSaved } from './helpers';

// #101: Read mode shows the saved text, not the text as it was when the note was opened.
test('101 Read mode shows text typed and autosaved in Write mode', async ({ page, api, vault }) => {
  await api.write(vault.id, 'readme101.md', '# Readme\n\nOld text\n');
  await openApp(page, vault.id);
  await openNote(page, 'readme101.md');
  await typeAtEnd(page, 'brand new line');
  await waitSaved(page);
  await page.getByTestId('mode-read').click();
  await expect(page.getByTestId('read-view')).toContainText('brand new line');
  await page.getByTestId('mode-write').click();
  await expect(page.locator('.cm-content')).toContainText('brand new line');
  await page.getByTestId('mode-read').click();
  await expect(page.getByTestId('read-view')).toContainText('brand new line');
});

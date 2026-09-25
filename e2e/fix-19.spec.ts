import { expect, openApp, openNote, pushFromObsidian, test, waitSaved } from './helpers';

// #19: editing one line of a CRLF note keeps every other line (and its \r\n) unchanged.
test('CRLF note: a one-line edit is a one-line diff', async ({ page, api, vault }) => {
  pushFromObsidian(vault.bare, 'CRLF note.md', '# CRLF\r\n\r\nline one\r\nline two\r\nline three\r\n');
  await openApp(page, vault.id); // opening the vault pulls
  await openNote(page, 'CRLF note.md');
  await page.locator('.cm-line', { hasText: 'line two' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' EDITED');
  await waitSaved(page);
  expect((await api.file(vault.id, 'CRLF note.md'))?.content).toBe('# CRLF\r\n\r\nline one\r\nline two EDITED\r\nline three\r\n');
  const { diff } = await api.diff(vault.id, 'CRLF note.md');
  const changed = diff.split('\n').filter((l) => /^[-+](?![-+]{2} )/.test(l));
  expect(changed).toEqual(['-line two\r', '+line two EDITED\r']);
});

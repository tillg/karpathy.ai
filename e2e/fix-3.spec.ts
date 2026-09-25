import { expect, openApp, openNote, test, treeItem, typeAtEnd } from './helpers';

// Issue #3: a stale save on navigation must not lose the edits or target the wrong note.
test.describe('stale save while switching notes (#3)', () => {
  test('navigating away with a stale unsaved edit stays on the note; Overwrite saves that note', async ({ page, api, vault }) => {
    await openApp(page, vault.id);
    await openNote(page, 'Ideas.md');
    await typeAtEnd(page, '\nWICHTIGER UNGESPEICHERTER TEXT.');
    await api.write(vault.id, 'Ideas.md', '# Ideas\n\ntheirs\n');
    await treeItem(page, 'Home.md').click();

    const dialog = page.getByTestId('stale-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Ideas.md');
    await expect(page.locator('.note-title')).toHaveText('Ideas');
    await expect(page.locator('.cm-content')).toContainText('WICHTIGER UNGESPEICHERTER TEXT.');

    await page.getByTestId('stale-overwrite').click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await api.file(vault.id, 'Ideas.md'))?.content).toBe('# Ideas\n\nBack to [[Home]].\n\nWICHTIGER UNGESPEICHERTER TEXT.');
    expect((await api.file(vault.id, 'Home.md'))?.content).toContain('Welcome to the test vault');

    // Now navigation works.
    await treeItem(page, 'Home.md').click();
    await expect(page.locator('.note-title')).toHaveText('Home');
  });

  test('Reload after a blocked navigation drops the edits of that note', async ({ page, api, vault }) => {
    await openApp(page, vault.id);
    await openNote(page, 'Ideas.md');
    await typeAtEnd(page, '\nmine');
    await api.write(vault.id, 'Ideas.md', '# Ideas\n\ntheirs\n');
    await treeItem(page, 'Home.md').click();
    await expect(page.getByTestId('stale-dialog')).toBeVisible();
    await page.getByTestId('stale-reload').click();
    await expect(page.locator('.note-title')).toHaveText('Ideas');
    await expect(page.locator('.cm-content')).toContainText('theirs');
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    expect((await api.file(vault.id, 'Ideas.md'))?.content).toBe('# Ideas\n\ntheirs\n');
  });
});

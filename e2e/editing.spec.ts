import { expect, openApp, openNote, test, typeAtEnd, waitSaved } from './helpers';

test.describe('editor, autosave and live updates', () => {
  test('typing autosaves to the vault (debounced)', async ({ page, api, vault }) => {
    await openApp(page, vault.id);
    await openNote(page, 'Ideas.md');
    await typeAtEnd(page, '\nAutosaved line from e2e.');
    await expect(page.getByTestId('save-state')).toHaveText(/Unsaved changes|Saving/);
    await waitSaved(page);
    expect((await api.file(vault.id, 'Ideas.md'))?.content).toBe('# Ideas\n\nBack to [[Home]].\n\nAutosaved line from e2e.');
    // Frontmatter and wikilinks survive a round trip byte for byte.
    const note = (await api.files(vault.id)).find((f) => f.path.startsWith('wiki/') && f.type === 'file')!;
    const before = (await api.file(vault.id, note.path))!.content;
    await openNote(page, note.path);
    await typeAtEnd(page, 'X');
    await waitSaved(page);
    expect((await api.file(vault.id, note.path))!.content).toBe(`${before}X`);
  });

  test('stale save: file changed behind the editor with unsaved edits → dialog; overwrite keeps mine', async ({ page, api, vault }) => {
    await openApp(page, vault.id);
    await openNote(page, 'Ideas.md');
    await typeAtEnd(page, '\nmine');
    // Within the 1.5 s debounce, another writer (AI / other device) changes the file.
    await api.write(vault.id, 'Ideas.md', '# Ideas\n\ntheirs\n');
    const dialog = page.getByTestId('stale-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Ideas.md');
    // Unsaved edits are kept in the editor meanwhile.
    await expect(page.locator('.cm-content')).toContainText('mine');
    await page.getByTestId('stale-overwrite').click();
    await expect(dialog).toBeHidden();
    await waitSaved(page);
    expect((await api.file(vault.id, 'Ideas.md'))?.content).toBe('# Ideas\n\nBack to [[Home]].\n\nmine');
  });

  test('stale save: reload drops my edits and shows the other version', async ({ page, api, vault }) => {
    await openApp(page, vault.id);
    await openNote(page, 'Ideas.md');
    await typeAtEnd(page, '\nmine');
    await api.write(vault.id, 'Ideas.md', '# Ideas\n\ntheirs\n');
    await expect(page.getByTestId('stale-dialog')).toBeVisible();
    await page.getByTestId('stale-reload').click();
    await expect(page.getByTestId('stale-dialog')).toBeHidden();
    await expect(page.locator('.cm-content')).toContainText('theirs');
    await expect(page.locator('.cm-content')).not.toContainText('mine');
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    expect((await api.file(vault.id, 'Ideas.md'))?.content).toBe('# Ideas\n\ntheirs\n');
  });

  test('file changed elsewhere with no unsaved edits → silent reload + notice', async ({ page, api, vault }) => {
    await openApp(page, vault.id);
    await openNote(page, 'Ideas.md');
    await api.write(vault.id, 'Ideas.md', '# Ideas\n\nChanged by the AI.\n');
    await expect(page.locator('.cm-content')).toContainText('Changed by the AI.');
    await expect(page.getByTestId('toast')).toContainText('Updated by AI or another device');
    await expect(page.getByTestId('stale-dialog')).toBeHidden();
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
  });

  test('changes badge follows the event stream (no reload) and matches git status', async ({ page, api, vault }) => {
    await openApp(page, vault.id);
    const badge = page.getByTestId('changes-badge');
    await expect(badge).toHaveAttribute('data-count', '0');
    await expect(badge).toHaveText(/All committed/);

    await api.write(vault.id, 'Ideas.md', '# Ideas\n\nedit 1\n');
    await expect(badge).toHaveAttribute('data-count', '1');
    await api.write(vault.id, 'New from elsewhere.md', '# New\n');
    await expect(badge).toHaveAttribute('data-count', '2');
    await expect(badge).toHaveText(/2 uncommitted/);
    // New file shows up in the tree without a reload, too.
    await expect(page.locator('[data-testid="tree-item"][data-path="New from elsewhere.md"]')).toBeVisible();
    expect((await api.changes(vault.id)).length).toBe(2);
    await expect(page.getByTestId('section-changes').locator('.count')).toHaveText('2');
  });

  test('event stream reconnects after the connection drops', async ({ page, context, api, vault }) => {
    await openApp(page, vault.id);
    const badge = page.getByTestId('changes-badge');
    await expect(badge).toHaveAttribute('data-count', '0');
    // Drop the connection (as iOS does in the background), change the vault meanwhile, come back.
    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    await api.write(vault.id, 'Ideas.md', '# Ideas\n\nwhile offline\n');
    await page.waitForTimeout(1000);
    await context.setOffline(false);
    await expect(page.getByTestId('offline-banner')).toBeHidden();
    await expect(badge).toHaveAttribute('data-count', '1');
  });
});

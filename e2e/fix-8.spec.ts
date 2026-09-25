import { expect, openApp, openNote, test, treeItem, typeAtEnd } from './helpers';

const discard = (api: { ctx: { post(u: string): Promise<unknown> } }, id: string, path: string) =>
  api.ctx.post(`/api/vaults/${id}/discard?path=${encodeURIComponent(path)}`);

// Issue #8: the open note is deleted elsewhere.
test.describe('open note deleted elsewhere (#8)', () => {
  test('banner; Close closes the note', async ({ page, api, vault }) => {
    await api.write(vault.id, 'Zombie.md', '# Zombie\n');
    await openApp(page, vault.id);
    await openNote(page, 'Zombie.md');
    await discard(api, vault.id, 'Zombie.md');
    const banner = page.getByTestId('deleted-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('deleted');
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
    await expect(treeItem(page, 'Zombie.md')).toHaveCount(0);
    await banner.getByTestId('deleted-close').click();
    await expect(page.locator('.note-title')).toHaveCount(0);
  });

  test('unsaved edits: Keep as new note recreates it with my text', async ({ page, api, vault }) => {
    await api.write(vault.id, 'Zombie.md', '# Zombie\n');
    await openApp(page, vault.id);
    await openNote(page, 'Zombie.md');
    await typeAtEnd(page, 'my text');
    await discard(api, vault.id, 'Zombie.md');
    const banner = page.getByTestId('deleted-banner');
    await expect(banner).toBeVisible();
    await page.waitForTimeout(2000); // the autosave must not resurrect it on its own
    expect(await api.file(vault.id, 'Zombie.md')).toBeNull();
    await banner.getByTestId('deleted-keep').click();
    await expect(banner).toBeHidden();
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    expect((await api.file(vault.id, 'Zombie.md'))?.content).toBe('# Zombie\nmy text');
    await expect(treeItem(page, 'Zombie.md')).toBeVisible();
  });
});

import { expect, openApp, test } from './helpers';

// New-note names the backend rejects (400 bad-name) show its readable reason.
for (const name of ['CON', 'a<b', 'folder/']) {
  test(`new note “${name}” is refused with a readable reason`, async ({ page, api, vault }) => {
    page.on('dialog', (d) => void d.accept(name));
    await openApp(page, vault.id);
    await page.getByTestId('new-note').click();
    await expect(page.getByTestId('toast')).toContainText('Can’t create');
    await expect(page.getByTestId('toast')).toContainText(name === 'folder/' ? 'must not end with "/"' : name === 'CON' ? 'reserved name' : 'isn\'t allowed');
    expect((await api.changes(vault.id))).toEqual([]);
  });
}

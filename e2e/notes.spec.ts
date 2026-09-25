import { expect, openApp, openNote, test, treeItem } from './helpers';

test.describe('file tree and notes', () => {
  test('file tree lists the vault, folders collapse, a note opens in Write mode', async ({ page, api, vault }) => {
    await openApp(page, vault.id);
    const files = (await api.files(vault.id)).filter((f) => f.type === 'file' && f.path.endsWith('.md'));
    for (const f of files) await expect(treeItem(page, f.path)).toBeAttached();
    const dir = (await api.files(vault.id)).find((f) => f.type === 'dir')!;
    const child = files.find((f) => f.path.startsWith(`${dir.path}/`))!;
    await expect(treeItem(page, child.path)).toBeVisible();
    await treeItem(page, dir.path).click();
    await expect(treeItem(page, child.path)).toHaveCount(0);
    await treeItem(page, dir.path).click();
    await expect(treeItem(page, child.path)).toBeVisible();

    await openNote(page, 'Home.md');
    await expect(page.getByTestId('mode-write')).toHaveClass(/on/);
    await expect(page.locator('.cm-content')).toContainText('Welcome to the test vault');
    await expect(page.locator('.cm-content')).toContainText('ÄÖÜ ß é è — unicode check.');
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    await expect(page.locator('.crumb')).toHaveText('Home.md');
    await page.screenshot({ path: test.info().outputPath('home-write.png') });
  });

  test('Read/Write toggle; wikilink click navigates in both modes', async ({ page, vault }) => {
    await openApp(page, vault.id);
    await openNote(page, 'Home.md');

    // Write mode: [[Ideas]] is a decorated, clickable link.
    const wl = page.locator('.cm-wl[data-target="Ideas"]');
    await expect(wl).toBeVisible();
    await wl.click();
    await expect(page.locator('.note-title')).toHaveText('Ideas');

    // Read mode: rendered, not editable; [[Home]] navigates back.
    await page.getByTestId('mode-read').click();
    await expect(page.getByTestId('read-view')).toBeVisible();
    await expect(page.locator('.cm-content')).toHaveCount(0);
    await expect(page.getByTestId('read-view').locator('h1')).toHaveText('Ideas');
    await page.screenshot({ path: test.info().outputPath('ideas-read.png') });
    await page.getByTestId('read-view').locator('a.wl[data-target="Home"]').click();
    await expect(page.locator('.note-title')).toHaveText('Home');
    // Following a link keeps Read mode (issue #17).
    await expect(page.getByTestId('mode-read')).toHaveClass(/on/);

    await page.getByTestId('mode-read').click();
    await expect(page.getByTestId('read-view')).toContainText('Welcome to the test vault');
    await page.getByTestId('mode-write').click();
    await expect(page.locator('.cm-content')).toBeVisible();
  });

  test('link to a missing page shows a notice instead of navigating', async ({ page, api, vault }) => {
    await api.write(vault.id, 'Dangling.md', '# Dangling\n\nSee [[Nowhere Page]].\n');
    await openApp(page, vault.id);
    await openNote(page, 'Dangling.md');
    await page.locator('.cm-wl-miss').click();
    await expect(page.getByTestId('toast')).toContainText('No page “Nowhere Page” yet');
    await expect(page.locator('.note-title')).toHaveText('Dangling');
  });

  test('create a note', async ({ page, api, vault }) => {
    page.on('dialog', (d) => void d.accept('E2E Created'));
    await openApp(page, vault.id);
    await page.getByTestId('new-note').click();
    await expect(treeItem(page, 'E2E Created.md')).toBeVisible();
    await expect(page.locator('.note-title')).toHaveText('E2E Created');
    await expect(page.locator('.cm-content')).toContainText('# E2E Created');
    expect((await api.file(vault.id, 'E2E Created.md'))?.content).toBe('# E2E Created\n');
  });

  test('delete a note', async ({ page, api, vault }) => {
    page.on('dialog', (d) => void d.accept());
    await openApp(page, vault.id);
    await openNote(page, 'Ideas.md');
    await page.getByTestId('delete-note').click();
    await expect(page.getByTestId('toast')).toContainText('Deleted Ideas.md');
    await expect(treeItem(page, 'Ideas.md')).toHaveCount(0);
    await expect(page.locator('.note-title')).toHaveCount(0);
    expect(await api.file(vault.id, 'Ideas.md')).toBeNull();
    expect(await api.changes(vault.id)).toContainEqual({ path: 'Ideas.md', kind: 'deleted' });
  });

  test('search finds text and opens the hit', async ({ page, vault }) => {
    await openApp(page, vault.id);
    await page.getByTestId('section-search').click();
    await page.getByTestId('search-input').fill('unicode check');
    const hit = page.locator('[data-testid="search-result"][data-path="Home.md"]');
    await expect(hit).toBeVisible();
    await expect(page.locator('.search .meta')).toHaveText('1 matches · 1 notes');
    await hit.click();
    await expect(page.locator('.note-title')).toHaveText('Home');

    await page.getByTestId('search-input').fill('zzqqxx-nothing');
    await expect(page.locator('.search .empty')).toContainText('No results');
  });
});

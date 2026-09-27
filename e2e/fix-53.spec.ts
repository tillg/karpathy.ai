import { expect, openApp, test, treeItem } from './helpers';

// #53: folders start collapsed (except the open note's path); expansion is kept per vault
// across tab switches and reloads.
test('folders start collapsed, expansion survives a reload, the open note\'s folders open', async ({ page, api, vault }) => {
  await api.write(vault.id, 'wiki/concepts/deep.md', '# Deep\n');
  await openApp(page, vault.id);
  const wiki = treeItem(page, 'wiki');
  await expect(wiki).toHaveAttribute('aria-expanded', 'false');
  await expect(treeItem(page, 'Home.md')).toBeVisible();
  await expect(treeItem(page, 'wiki/concepts')).toHaveCount(0);

  await wiki.click();
  await expect(wiki).toHaveAttribute('aria-expanded', 'true');
  await expect(treeItem(page, 'wiki/concepts')).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(treeItem(page, 'wiki')).toHaveAttribute('aria-expanded', 'true');
  await expect(treeItem(page, 'wiki/concepts')).toHaveAttribute('aria-expanded', 'false');
  await treeItem(page, 'wiki').click();
  await expect(treeItem(page, 'wiki/concepts')).toHaveCount(0);

  // Opening a note elsewhere (search) reveals its folders.
  await page.getByTestId('section-search').click();
  await page.getByTestId('search-input').fill('Deep');
  await page.locator('[data-testid="search-result"][data-path="wiki/concepts/deep.md"]').click();
  await expect(page.locator('.note-title')).toHaveText('deep');
  await page.getByTestId('section-files').click();
  await expect(treeItem(page, 'wiki/concepts/deep.md')).toHaveAttribute('aria-current', 'page');
  await expect(treeItem(page, 'wiki')).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: 'tmp/fix6/53-desktop.png' });
});

test('@iphone collapse/expand state survives switching tabs', async ({ page, api, vault }) => {
  await api.write(vault.id, 'other/x.md', '# X\n');
  await openApp(page, vault.id);
  const wiki = treeItem(page, 'wiki');
  await expect(wiki).toHaveAttribute('aria-expanded', 'false');
  await wiki.click();
  await expect(wiki).toHaveAttribute('aria-expanded', 'true');
  await page.getByTestId('tab-search').click();
  await page.getByTestId('tab-files').click();
  await expect(treeItem(page, 'wiki')).toHaveAttribute('aria-expanded', 'true');
  await expect(treeItem(page, 'other')).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: 'tmp/fix6/53-iphone.png' });
});

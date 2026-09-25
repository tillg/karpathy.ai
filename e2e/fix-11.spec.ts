import { expect, openApp, test } from './helpers';

// #11: change rows keep the file name visible (the folder part is truncated), full path in the title.
test('changes list keeps file names of long paths distinguishable', async ({ page, api, vault }) => {
  const a = 'raw/articles/some deeper folder/Graph Wissen 0.md';
  const b = 'raw/articles/some deeper folder/Graph Wissen 0.conflict-2026-09-25.md';
  await api.write(vault.id, a, '# A\n');
  await api.write(vault.id, b, '# B\n');
  await openApp(page, vault.id);
  await page.getByTestId('section-changes').click();
  for (const p of [a, b]) {
    const row = page.locator(`[data-testid="change-item"][data-path="${p}"]`);
    const base = row.locator('.pbase');
    await expect(base).toHaveText(p.split('/').pop()!);
    // Not cut off: the whole file name fits.
    expect(await base.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(row.locator('.plabel')).toHaveAttribute('title', p);
  }
  await page.locator('#sidebar').screenshot({ path: 'tmp/fix2/11-changes.png' });
});

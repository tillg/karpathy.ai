import { expect, openApp, test } from './helpers';

// #7: a capped result list says so; the same query gives the same results.
test('search: truncation hint and deterministic results', async ({ page, api }) => {
  const vault = await api.createVault('search-cap', 250);
  try {
    await openApp(page, vault.id);
    await page.getByTestId('section-search').click();
    const input = page.getByTestId('search-input');
    const run = async (q: string) => {
      await input.fill(q);
      await expect(page.getByTestId('search-meta')).toBeVisible();
      await expect(page.locator('.search .meta')).not.toHaveText('');
      return page.getByTestId('search-result').evaluateAll((els) => els.map((e) => e.getAttribute('data-path')));
    };
    const first = await run('vault');
    await expect(page.getByTestId('search-truncated')).toHaveText('Showing first 200 matches — refine your search');
    await page.locator('#sidebar').screenshot({ path: 'tmp/fix2/7-search.png' });
    await input.fill('');
    await expect(page.getByTestId('search-meta')).toBeHidden();
    expect(await run('vault')).toEqual(first);

    // A narrow query is not truncated.
    await run('Welcome to the test vault');
    await expect(page.getByTestId('search-truncated')).toBeHidden();
  } finally {
    await api.removeVault(vault.id);
  }
});

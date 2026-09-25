import { expect, openApp, test } from './helpers';

// Review finding: a failed vault-list fetch (backend restarting, 502) made the app treat the
// active vault as removed and wipe its unsaved drafts.
test('a failed vault list does not delete the active vault\'s drafts', async ({ page, vault }) => {
  const key = `karpathy.draft:${vault.id}:never-opened.md`;
  await page.addInitScript(([k]) => {
    if (!localStorage.getItem('karpathy.e2e-draft-seeded')) {
      localStorage.setItem('karpathy.e2e-draft-seeded', '1');
      localStorage.setItem(k!, JSON.stringify({ base: 'whatever', text: 'my unsaved words' }));
    }
  }, [key]);
  let failed = 0;
  await page.route('**/api/vaults', (route) => (failed++ === 0 ? route.fulfill({ status: 502, body: 'bad gateway' }) : route.continue()));
  await openApp(page, vault.id).catch(() => undefined); // the switcher may not show the vault while the list failed
  await expect.poll(() => failed).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toContain('my unsaved words');
});

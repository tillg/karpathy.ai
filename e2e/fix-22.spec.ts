import { expect, makeRemote, openApp, runId, test, uid } from './helpers';

// #22: a clone-failed vault never shows another vault's Changes; Retry re-runs the clone (#23).
test('clone-failed vault: no foreign changes, error shown, Retry clones', async ({ page, api, vault }) => {
  page.on('dialog', (d) => void d.accept());
  const name = `e2e-later-${runId()}-${uid()}`;
  const later = await api.addVault(name, `e2e/${name}`); // remote doesn't exist yet
  try {
    await expect.poll(async () => (await api.vault(later.id)).state, { timeout: 60_000 }).toBe('clone-failed');
    await api.write(vault.id, 'rem/n1.md', '# n1\n');
    await openApp(page, vault.id);
    await page.getByTestId('section-changes').click();
    await expect(page.getByTestId('change-item')).toHaveCount(1);

    await page.getByTestId('vault-switcher').click();
    await page.locator(`[data-testid="vault-option"][data-vault="${later.id}"]`).click();
    await expect(page.getByTestId('vault-switcher')).toContainText(name);
    await expect(page.getByTestId('changes-unavailable')).toContainText('could not be cloned');
    await expect(page.getByTestId('change-item')).toHaveCount(0);
    await expect(page.getByTestId('commit-button')).toHaveCount(0);
    // Nor the previous vault's status (count on the Changes tab, git pill).
    await expect(page.getByTestId('section-changes')).toHaveText('Changes');
    await expect(page.getByTestId('changes-badge')).toHaveCount(0);
    await expect(page.getByTestId('clone-failed')).toContainText('could not be cloned:');
    await page.screenshot({ path: 'tmp/fix3/22-clone-failed.png' });

    // The repo exists now: Retry in the admin area clones it.
    makeRemote(name);
    await page.getByTestId('manage-vaults-cta').click();
    const row = page.locator(`[data-testid="admin-vault"][data-vault="${later.id}"]`);
    await row.screenshot({ path: 'tmp/fix3/22-retry.png' });
    await row.getByTestId('vault-retry').click();
    await expect(row).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    await page.getByTestId('admin').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByTestId('changes-unavailable')).toHaveCount(0);
    await expect(page.getByTestId('commit-button')).toBeVisible();
    await expect(page.getByTestId('change-item')).toHaveCount(0);
  } finally {
    await api.removeVault(later.id);
  }
});

import { expect, makeRemote, openApp, runId, test, treeItem, uid } from './helpers';

test.describe('admin area', () => {
  test('add a vault → cloned → in the switcher; edit its name; remove it', async ({ page, api }) => {
    const name = `e2e-admin-${runId()}-${uid()}`;
    makeRemote(name);
    page.on('dialog', (d) => void d.accept());
    await openApp(page);

    await page.getByTestId('open-admin').click();
    const admin = page.getByTestId('admin');
    await expect(admin).toBeVisible();
    await page.getByTestId('admin-name').fill(name);
    await page.getByTestId('admin-repo').fill(`e2e/${name}`);
    await page.getByTestId('admin-add').click();

    const row = admin.locator(`[data-testid="admin-vault"][data-vault="${name}"]`);
    await expect(row).toBeVisible();
    // The admin list polls while cloning.
    await expect(row).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });

    // Edit the display name.
    await row.getByTestId('vault-edit').click();
    await row.getByTestId('edit-name').fill(`${name} renamed`);
    await row.getByTestId('edit-save').click();
    await expect(row).toContainText(`${name} renamed`);
    expect((await api.vault(name)).name).toBe(`${name} renamed`);

    // Appears in the vault switcher and can be activated.
    await admin.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByTestId('vault-switcher').click();
    const opt = page.locator(`[data-testid="vault-option"][data-vault="${name}"]`);
    await expect(opt).toContainText(`${name} renamed`);
    await opt.click();
    await expect(page.getByTestId('vault-switcher')).toContainText(`${name} renamed`);
    await expect(treeItem(page, 'Home.md')).toBeVisible();

    // Remove (confirm dialog auto-accepted).
    await page.getByTestId('open-admin').click();
    await row.getByTestId('vault-remove').click();
    await expect(row).toHaveCount(0);
    expect((await api.vaults()).some((v) => v.id === name)).toBe(false);
  });

  test('a repo that cannot be cloned shows clone-failed with the git error', async ({ page, api }) => {
    const name = `e2e-missing-${runId()}-${uid()}`;
    page.on('dialog', (d) => void d.accept());
    await openApp(page);
    await page.getByTestId('open-admin').click();
    await page.getByTestId('admin-name').fill(name);
    await page.getByTestId('admin-repo').fill(`e2e/${name}`);
    await page.getByTestId('admin-add').click();
    const row = page.locator(`[data-testid="admin-vault"][data-vault="${name}"]`);
    await expect(row).toHaveAttribute('data-state', 'clone-failed', { timeout: 60_000 });
    await expect(row.locator('.form-error')).not.toBeEmpty();
    await row.getByTestId('vault-remove').click();
    await expect(row).toHaveCount(0);
    expect((await api.vaults()).some((v) => v.id === name)).toBe(false);
  });

  test('an invalid repo name is rejected inline', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('open-admin').click();
    await page.getByTestId('admin-repo').fill('not a repo');
    await page.getByTestId('admin-add').click();
    await expect(page.getByTestId('admin-error')).toContainText('owner/name');
  });

  test('vault switcher switches file tree between vaults', async ({ page, api, vault }) => {
    const other = await api.createVault('switch-b');
    try {
      await api.write(other.id, 'Only-in-B.md', '# Only in B\n');
      await openApp(page, vault.id);
      await expect(treeItem(page, 'Home.md')).toBeVisible();
      await expect(treeItem(page, 'Only-in-B.md')).toHaveCount(0);

      await page.getByTestId('vault-switcher').click();
      await page.locator(`[data-testid="vault-option"][data-vault="${other.id}"]`).click();
      await expect(page.getByTestId('vault-switcher')).toContainText(other.name);
      await expect(treeItem(page, 'Only-in-B.md')).toBeVisible();

      // The choice survives a reload.
      await page.reload();
      await expect(treeItem(page, 'Only-in-B.md')).toBeVisible();
    } finally {
      await api.removeVault(other.id);
    }
  });
});

import { expect, openApp, pushFromObsidian, test } from './helpers';

// #21: no commit reminder while the vault is in Conflict; it may come back once resolved.
test('commit reminder stays away during a conflict', async ({ page, api, vault }) => {
  const threshold = (await api.settings()).commitReminderThreshold;
  await api.write(vault.id, 'Ideas.md', '# Ideas mine\n\nBack to [[Home]].\n');
  for (let i = 0; i < threshold; i++) await api.write(vault.id, `R${i}.md`, `# R${i}\n`);
  pushFromObsidian(vault.bare, 'Ideas.md', '# Ideas theirs\n\nBack to [[Home]].\n');
  // The commit's pull runs into the conflict.
  const res = await api.ctx.post(`/api/vaults/${vault.id}/commit`, { data: { message: 'x' } });
  expect(res.status()).toBe(409);
  expect((await api.status(vault.id)).state).toBe('conflict');

  await openApp(page, vault.id);
  await expect(page.getByTestId('conflict-banner')).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('reminder-dialog')).toBeHidden();

  await page.getByTestId('section-changes').click();
  const item = page.locator('[data-testid="conflict-item"][data-path="Ideas.md"]');
  await item.getByTestId('keep-mine').click();
  await item.getByTestId('resolve').click();
  await expect(page.getByTestId('conflict-banner')).toBeHidden();
  await expect(page.getByTestId('reminder-dialog')).toBeVisible();
});

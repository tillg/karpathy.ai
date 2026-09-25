import { expect, openApp, pushFromObsidian, test } from './helpers';

// #10: the conflict card shows a line diff (mine vs theirs), not two full files; it opens larger.
test('conflict shows a line diff of mine vs theirs and a roomy compare dialog', async ({ page, api, vault }) => {
  const body = Array.from({ length: 40 }, (_, i) => `Line ${i} of a long note.`).join('\n');
  pushFromObsidian(vault.bare, 'Long.md', `# Long\n\n${body}\nlast base\n`);
  await api.ctx.post(`/api/vaults/${vault.id}/open`);
  await expect.poll(async () => (await api.file(vault.id, 'Long.md'))?.content ?? '').toContain('last base');
  await api.write(vault.id, 'Long.md', `# Long\n\n${body}\nlast MINE\n`);
  pushFromObsidian(vault.bare, 'Long.md', `# Long\n\n${body}\nlast THEIRS\n`);
  await api.ctx.post(`/api/vaults/${vault.id}/open`);
  await expect.poll(async () => (await api.status(vault.id)).state).toBe('conflict');

  await openApp(page, vault.id);
  await page.getByTestId('section-changes').click();
  const item = page.locator('[data-testid="conflict-item"][data-path="Long.md"]');
  const diff = item.getByTestId('conflict-diff');
  // The differing line (at the end of the file) is visible without scrolling; unchanged lines are collapsed.
  await expect(diff.locator('[data-op="mine"]')).toHaveText(/last MINE/);
  await expect(diff.locator('[data-op="theirs"]')).toHaveText(/last THEIRS/);
  await expect(diff.locator('[data-op="mine"]')).toBeInViewport();
  await expect(diff).toContainText('unchanged lines');
  await expect(diff).not.toContainText('Line 5 of');
  await page.screenshot({ path: 'tmp/fix2/10-conflict-card.png' });

  await item.getByTestId('conflict-compare').click();
  const dlg = page.getByTestId('conflict-compare-dialog');
  await expect(dlg).toBeVisible();
  expect((await dlg.boundingBox())!.width).toBeGreaterThan(900);
  await expect(dlg.getByTestId('conflict-diff').locator('[data-op="mine"]')).toHaveText(/last MINE/);
  await page.screenshot({ path: 'tmp/fix2/10-conflict-compare.png', animations: 'disabled' });

  // Resolve right from the dialog.
  await dlg.getByTestId('keep-mine').click();
  await dlg.getByTestId('resolve').click();
  await expect.poll(async () => (await api.status(vault.id)).state).toBe('ready');
  expect((await api.file(vault.id, 'Long.md'))?.content).toContain('last MINE');
});

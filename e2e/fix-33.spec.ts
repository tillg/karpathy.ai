import { expect, openApp, test } from './helpers';

// #33: files that change after the commit dialog opened (e.g. the AI writing while the commit
// waited) must not be committed silently under the old message.
test('commit refuses when more changes arrived, then commits the reviewed set', async ({ page, api, vault }) => {
  await api.write(vault.id, 'first.md', 'one\n');
  await openApp(page, vault.id);
  await page.getByTestId('changes-badge').first().click();
  await page.getByTestId('commit-button').click();
  const msg = page.getByTestId('commit-message');
  await expect(msg).toBeEnabled({ timeout: 20_000 });
  await api.write(vault.id, 'arrived-later.md', 'two\n');
  await page.getByTestId('commit-submit').click();
  await expect(page.getByRole('alert')).toContainText('arrived-later.md');
  await msg.fill('Add first and arrived-later');
  await page.getByTestId('commit-submit').click();
  await expect(page.getByTestId('changes-badge').first()).toHaveAttribute('data-count', '0', { timeout: 20_000 });
});

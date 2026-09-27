import { expect, openApp, test } from './helpers';

// #62: text typed right after "New chat" belongs to the new chat, never to the one just left.
test.use({ serviceWorkers: 'block' }); // page.route must see the fetch (see fix-14)
test('the composer belongs to the new chat as soon as it is shown', async ({ page, api, vault }) => {
  page.on('dialog', (d) => void d.accept());
  await openApp(page, vault.id);
  if (!(await page.getByTestId('new-chat').isVisible())) await page.getByTestId('chat-toggle').click();
  await page.getByTestId('new-chat').click();
  await expect(page.getByTestId('chat-messages')).toContainText('New chat');
  const composer = page.getByTestId('chat-composer');
  await composer.fill('draft for chat A');

  // Creating the next chat is slow (server latency): the leave of chat A must not own the composer meanwhile.
  await page.route((u) => u.pathname === `/api/vaults/${vault.id}/chats`, async (r) => {
    if (r.request().method() === 'POST') await new Promise((ok) => setTimeout(ok, 1500));
    await r.continue();
  });
  await page.getByTestId('new-chat').click();
  await composer.fill('Say hi.');
  await expect(page.getByTestId('chat-messages')).toContainText('New chat');
  await page.waitForTimeout(2000); // past the delayed create + leave
  await expect(composer).toHaveValue('Say hi.');
  await expect(composer).toBeEnabled();
  // Exactly one chat left: A (empty) was cleaned up, the new one is open.
  await page.unrouteAll();
  await expect.poll(async () => (await (await api.ctx.get(`/api/vaults/${vault.id}/chats`)).json()).length).toBe(1);
});

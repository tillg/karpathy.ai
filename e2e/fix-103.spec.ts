import { expect, openApp, test } from './helpers';

// #103: a chat is titled with its full first prompt; the list cuts it with CSS ellipsis at the real width.
const PROMPT = 'Compare Similaun and Cevedale for a trip in late April and tell me which one needs less equipment overall';

test('103 chat list shows the full first prompt, with a tooltip', async ({ page, vault, api }) => {
  await openApp(page, vault.id);
  await page.getByTestId('new-chat').click();
  await expect(page.getByTestId('chat-messages')).toContainText('New chat');
  await page.getByTestId('chat-composer').fill(PROMPT);
  await page.getByTestId('chat-send').click();
  await expect.poll(async () => {
    const list = await (await api.ctx.get(`/api/vaults/${vault.id}/chats`)).json() as { title: string }[];
    return list[0]?.title;
  }).toBe(PROMPT);
  await page.getByTestId('chat-back').click();
  const nm = page.getByTestId('chat-item').first().locator('.nm');
  await expect(nm).toHaveText(PROMPT);
  await expect(nm).toHaveAttribute('title', PROMPT);
});

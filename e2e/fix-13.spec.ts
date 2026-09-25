import { expect, openApp, test } from './helpers';

// #13: a queued prompt is visible while it waits; stopping it puts the text back into the
// composer, and the never-used chat doesn't stay behind in the list.
test('queued prompt: visible bubble, stop restores it, no orphan chat', async ({ page, vault }) => {
  test.setTimeout(10 * 60_000);
  page.on('dialog', (d) => void d.accept());
  await openApp(page, vault.id);

  // Chat A: a real (slow) turn keeps the vault's turn slot busy.
  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-composer').fill('Read every note in this vault and write a detailed summary of each.');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-stop')).toBeVisible();
  await page.getByTestId('chat-back').click();
  await expect(page.getByTestId('chat-item')).toHaveCount(1);

  // Chat B: queued behind A.
  await page.getByTestId('new-chat').click();
  const text = 'QUEUED PROMPT to be stopped';
  await page.getByTestId('chat-composer').fill(text);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-queued')).toBeVisible();
  await expect(page.getByTestId('chat-pending')).toHaveText(text);
  // Still there after the stream attached (it used to vanish right away).
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('chat-pending')).toHaveText(text);
  await page.screenshot({ path: 'tmp/fix2/13-queued.png' });

  await page.getByTestId('chat-stop').click();
  await expect(page.getByTestId('chat-composer')).toHaveValue(text);
  await expect(page.getByTestId('chat-pending')).toBeHidden();
  await expect(page.getByTestId('chat-queued')).toBeHidden();
  await page.screenshot({ path: 'tmp/fix2/13-stopped.png' });

  // Leaving the never-used chat B deletes it: only A is listed.
  await page.getByTestId('chat-back').click();
  await expect(page.getByTestId('chat-item')).toHaveCount(1);

  // Clean up: stop A.
  await page.getByTestId('chat-item').click();
  if (await page.getByTestId('chat-stop').isVisible()) await page.getByTestId('chat-stop').click();
  await expect(page.getByTestId('chat-send')).toBeVisible({ timeout: 60_000 });
});

// #13 (reopened): the queued prompt comes from the server, so it survives a reload / another
// device; the chat list marks running/queued chats and titles them by their first prompt.
test('queued prompt survives a reload; list shows markers; stop restores it', async ({ page, vault }) => {
  test.setTimeout(10 * 60_000);
  page.on('dialog', (d) => void d.accept());
  await openApp(page, vault.id);

  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-composer').fill('Read every note in this vault and write a detailed summary of each.');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-stop')).toBeVisible();
  await page.getByTestId('chat-back').click();
  await expect(page.getByTestId('chat-item')).toHaveCount(1);

  await page.getByTestId('new-chat').click();
  const text = 'RELOAD QUEUED prompt';
  await page.getByTestId('chat-composer').fill(text);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-queued')).toBeVisible();

  await page.reload();
  const items = page.getByTestId('chat-item');
  await expect(items).toHaveCount(2);
  const queued = items.filter({ hasText: text });
  await expect(queued.getByTestId('chat-turn')).toHaveAttribute('data-turn', 'queued');
  await expect(items.filter({ hasText: 'Read every note' }).getByTestId('chat-turn')).toHaveAttribute('data-turn', 'running');
  await page.screenshot({ path: 'tmp/fix3/13-list-markers.png' });

  await queued.click();
  await expect(page.getByTestId('chat-queued')).toBeVisible();
  await expect(page.getByTestId('chat-pending')).toHaveText(text);
  await page.screenshot({ path: 'tmp/fix3/13-queued-after-reload.png' });
  await page.getByTestId('chat-stop').click();
  await expect(page.getByTestId('chat-composer')).toHaveValue(text);
  await expect(page.getByTestId('chat-pending')).toBeHidden();

  // Clean up: stop A.
  await page.getByTestId('chat-back').click();
  await items.filter({ hasText: 'Read every note' }).click();
  if (await page.getByTestId('chat-stop').isVisible()) await page.getByTestId('chat-stop').click();
  await expect(page.getByTestId('chat-send')).toBeVisible({ timeout: 60_000 });
});

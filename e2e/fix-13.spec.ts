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

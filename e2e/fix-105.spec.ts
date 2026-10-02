import { expect, openApp, test } from './helpers';

// #105: a chat scrolled to the end stays at the end when its width changes (swap, resize); one scrolled up keeps its position.
const MSGS = '#chat [role="region"][aria-label="Messages"]';

async function chatWithContent(page: import('@playwright/test').Page, vaultId: string) {
  await openApp(page, vaultId);
  await page.getByTestId('new-chat').click();
  await expect(page.getByTestId('chat-messages')).toContainText('New chat');
  // Text that reflows taller when the column gets narrower; no model turn needed.
  await page.locator(MSGS).evaluate((el) => {
    const pad = document.createElement('div');
    pad.id = 'pad';
    pad.textContent = Array.from({ length: 150 }, (_, i) => `Paragraph ${i} of a long answer that wraps differently in each column width.`).join(' ');
    el.append(pad);
  });
  await page.waitForTimeout(300); // let the observers see the new height before the test scrolls
}
const gap = (page: import('@playwright/test').Page) => page.locator(MSGS).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);

test('105 a chat at the bottom stays at the bottom when its width changes', async ({ page, vault }) => {
  await chatWithContent(page, vault.id);
  const swap = page.getByTestId('main-swap');
  await swap.evaluate((el: HTMLElement) => el.click());
  await expect(swap).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 1700, height: 800 });
  await page.waitForTimeout(300); // one settled layout before the test scrolls
  await page.locator(MSGS).evaluate((el) => { el.scrollTop = el.scrollHeight; });
  expect(await gap(page)).toBeLessThanOrEqual(2);
  // Narrower main column: the text reflows taller.
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.waitForTimeout(300); // a few frames: the observer reacts at once, nothing else may rescue the position
  expect(await gap(page)).toBeLessThanOrEqual(2);
  // Swap back to the 380 px side column: taller still.
  await page.setViewportSize({ width: 1700, height: 800 });
  await page.waitForTimeout(300); // one settled layout before the test scrolls
  await page.locator(MSGS).evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await swap.evaluate((el: HTMLElement) => el.click());
  await expect(swap).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(300); // a few frames: the observer reacts at once, nothing else may rescue the position
  expect(await gap(page)).toBeLessThanOrEqual(2);
});

test('105 a chat scrolled up keeps its position when the width changes', async ({ page, vault }) => {
  await chatWithContent(page, vault.id);
  await page.locator(MSGS).evaluate((el) => { el.scrollTop = 300; });
  const swap = page.getByTestId('main-swap');
  await swap.evaluate((el: HTMLElement) => el.click());
  await expect(swap).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(500);
  expect(await page.locator(MSGS).evaluate((el) => el.scrollTop)).toBe(300);
});

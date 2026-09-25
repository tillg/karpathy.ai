import type { Page } from '@playwright/test';
import { expect, openApp, test, treeItem } from './helpers';

/** Tabs `n` times from the page start; returns where focus went (pane id, x). */
async function tabWalk(page: Page, n: number) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const out: { pane: string; x: number; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    out.push(await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return { pane: el.closest('.pane')?.id ?? el.closest('nav')?.id ?? 'none', x: Math.round(el.getBoundingClientRect().x), label: (el.getAttribute('data-testid') ?? el.textContent ?? '').slice(0, 30) };
    }));
  }
  return out;
}

// #26: Tab never walks into the closed overlay sidebar / chat (or panes covered on the phone).
test('@ipad Tab skips the closed overlay sidebar and chat; mode toggle exposes the mode', async ({ page, vault }) => {
  await openApp(page, vault.id);
  await page.getByTestId('sidebar-toggle').click();
  await treeItem(page, 'Home.md').click();
  await expect(page.locator('.note-title')).toHaveText('Home');
  await expect(page.locator('#app')).not.toHaveClass(/sbopen/);
  const walk = await tabWalk(page, 12);
  expect(walk.filter((f) => f.pane !== 'detail' && f.pane !== 'none'), JSON.stringify(walk)).toEqual([]);
  expect(walk.every((f) => f.x >= 0), JSON.stringify(walk)).toBe(true);
  expect(walk.some((f) => f.label === 'mode-write')).toBe(true);

  await expect(page.getByTestId('mode-write')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('mode-read')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('mode-read').click();
  await expect(page.getByTestId('mode-read')).toHaveAttribute('aria-pressed', 'true');

  // Open overlay: the sidebar is reachable, the covered note isn't.
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.locator('#app')).toHaveClass(/sbopen/);
  const open = await tabWalk(page, 6);
  expect(open.every((f) => f.pane === 'sidebar'), JSON.stringify(open)).toBe(true);
});

test('@iphone Tab skips the list covered by a pushed note', async ({ page, vault }) => {
  await openApp(page, vault.id);
  await treeItem(page, 'Home.md').click();
  await expect(page.locator('#app')).toHaveAttribute('data-dt', 'cur');
  const walk = await tabWalk(page, 12);
  expect(walk.filter((f) => f.pane !== 'detail' && f.pane !== 'tabbar' && f.pane !== 'none'), JSON.stringify(walk)).toEqual([]);
});

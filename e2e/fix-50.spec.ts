import { expect, openApp, test } from './helpers';

// #50: on iPad, opening the overlay sidebar moves focus into it.
test('@ipad opening the overlay sidebar focuses inside it; Escape returns to the toggle', async ({ page, vault }) => {
  await openApp(page, vault.id);
  await page.getByTestId('sidebar-toggle').click();
  await expect.poll(() => page.evaluate(() => !!document.getElementById('sidebar')?.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
});

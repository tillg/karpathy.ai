import { expect, openApp, openNote, test } from './helpers';

// Issue #4: a silent reload keeps the reading position and the cursor.
test('silent reload after an external edit keeps scroll position and cursor (#4)', async ({ page, api, vault }) => {
  const lines = Array.from({ length: 3000 }, (_, i) => `Line ${i + 1}`);
  await api.write(vault.id, 'Long.md', `${lines.join('\n')}\n`);
  await openApp(page, vault.id);
  await openNote(page, 'Long.md');
  const scroller = page.locator('#detail .scroll');
  await scroller.evaluate((e) => { e.scrollTop = 40_000; });
  await page.waitForTimeout(300);
  const target = page.locator('.cm-line', { hasText: /^Line \d+$/ }).nth(5);
  const label = (await target.textContent())!;
  await target.click();
  await page.keyboard.press('End');
  const before = await scroller.evaluate((e) => e.scrollTop);

  lines[4] = 'Line 5 changed by the AI';
  await api.write(vault.id, 'Long.md', `${lines.join('\n')}\n`);
  await expect(page.getByTestId('toast')).toContainText('Updated by AI or another device');
  const after = await scroller.evaluate((e) => e.scrollTop);
  expect(Math.abs(after - before)).toBeLessThan(40);

  // The cursor stayed at the end of the clicked line.
  await page.keyboard.type('!');
  await expect.poll(async () => (await api.file(vault.id, 'Long.md'))?.content, { timeout: 10_000 }).toContain(`\n${label}!\n`);
});

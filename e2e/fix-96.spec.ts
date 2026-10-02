import { expect, openApp, openNote, test } from './helpers';

// #96: table cells break between words, never mid-word; a too-wide table scrolls sideways.
test('96 Read mode tables do not break words mid-word', async ({ page, api, vault }) => {
  const head = ['Activity', 'Dolomites', 'Duration', 'Difficulty', 'Altitude', 'Location', 'Remarks', 'Equipment', 'Season', 'Guide', 'Price', 'Booking', 'Meeting point', 'Language', 'Group size'];
  const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const md = [
    '# Table', '',
    row(head), row(head.map(() => '---')),
    row(head.map((h) => `${h} value`)), '',
  ].join('\n');
  await api.write(vault.id, 'Table.md', md);
  await openApp(page, vault.id);
  await openNote(page, 'Table.md');
  await page.getByTestId('mode-read').click();
  const th = page.getByTestId('read-view').locator('th', { hasText: 'Activity' });
  await expect(th).toBeVisible();
  const broken = await th.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    // One line of text: a single client rect (a mid-word break would add a second one).
    return range.getClientRects().length > 1;
  });
  expect(broken).toBe(false);
  expect(await th.evaluate((el) => getComputedStyle(el).wordBreak)).toBe('normal');
  // Wider than the column: the table scrolls itself and stays inside the column.
  const t = await page.getByTestId('read-view').locator('table').evaluate((el) => ({
    scroll: el.scrollWidth, client: el.clientWidth, width: el.getBoundingClientRect().width,
    col: (el.closest('.rd') as HTMLElement).getBoundingClientRect().width,
  }));
  expect(t.scroll).toBeGreaterThan(t.client);
  expect(t.width).toBeLessThanOrEqual(t.col + 0.5);
});

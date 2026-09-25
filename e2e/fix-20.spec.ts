import { expect, openApp, pushFromObsidian, test, treeItem } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
  + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

// #20: a binary file (image pushed from Obsidian) opens as a placeholder, never in the editor.
test('binary file: placeholder, not editable, never saved', async ({ page, api, vault }) => {
  pushFromObsidian(vault.bare, 'media/pic.png', PNG);
  const puts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'PUT') puts.push(r.url()); });
  await openApp(page, vault.id);
  await treeItem(page, 'media/pic.png').click();
  await expect(page.getByTestId('binary-file')).toContainText('Binary file');
  await expect(page.locator('.cm-content')).toHaveCount(0);
  await expect(page.getByTestId('mode-toggle')).toHaveCount(0);
  await page.screenshot({ path: 'tmp/fix3/20-binary.png' });
  await page.keyboard.type('x');
  await page.waitForTimeout(2500);
  expect(puts).toEqual([]);
  expect(await api.changes(vault.id)).toEqual([]);
});

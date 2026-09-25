import { TOKEN, expect, test } from './helpers';

test.describe('token screen', () => {
  test('wrong token is rejected, right token shows the shell and is remembered', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('token-input')).toBeVisible();
    await expect(page.getByTestId('token-submit')).toBeDisabled();

    await page.getByTestId('token-input').fill('not-the-token');
    await page.getByTestId('token-submit').click();
    await expect(page.getByRole('alert')).toHaveText('That token was not accepted.');
    await expect(page.getByTestId('vault-switcher')).toHaveCount(0);

    await page.getByTestId('token-input').fill(TOKEN);
    await page.getByTestId('token-submit').click();
    await expect(page.getByTestId('vault-switcher')).toBeVisible();

    // Stored on the device: a reload goes straight to the shell.
    await page.reload();
    await expect(page.getByTestId('vault-switcher')).toBeVisible();
    await expect(page.getByTestId('token-input')).toHaveCount(0);
  });

  test('a stored token that the server rejects drops back to the token screen', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('karpathy.token', 'stale-token'));
    await page.goto('/');
    await expect(page.getByTestId('token-input')).toBeVisible();
  });
});

test.describe('PWA', () => {
  test('icons are served', async ({ request }) => {
    for (const p of ['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/favicon.ico']) {
      const res = await request.get(p);
      expect(res.status(), p).toBe(200);
      expect(res.headers()['content-type'], p).toMatch(/image\//);
    }
  });

  // Bug #1: the dev stack (the documented e2e target) serves no manifest and no service worker.
  test('page links a web app manifest with name, start_url and icons', async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href', { timeout: 5_000 });
    expect(href).toBeTruthy();
    const res = await request.get(href!);
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m.name).toBe('karpathy.ai');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    expect(m.icons.length).toBeGreaterThanOrEqual(2);
  });
});

import { expect, openApp, test } from './helpers';

// Dev and prodtest builds report `dev`; a deployed release reports its version (deploy-e2e sets it).
const expected = process.env.E2E_EXPECT_VERSION ?? 'dev';

test('settings dialog shows the server and the PWA version', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('open-admin').click();
  const admin = page.getByTestId('admin');
  await expect(admin.getByTestId('version-server')).toHaveText(expected);
  await expect(admin.getByTestId('version-pwa')).toHaveText(expected);
  await admin.getByTestId('version-server').scrollIntoViewIfNeeded();
  await admin.screenshot({ path: `tmp/e2e/version-${test.info().project.name}.png`, scale: 'css' });
});

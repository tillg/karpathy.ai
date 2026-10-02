import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_URL, ROOT, TOKEN, expect, test } from './helpers';

// The home-screen app on iOS has its own storage, so the QR code must be scannable inside the app:
// the token screen's "Scan QR code" reads it with the camera. Chromium's fake camera plays a video
// of the login link's QR code (qrencode + ffmpeg); WebKit can't fake a camera.
const dir = join(ROOT, 'tmp/e2e');
const png = join(dir, 'login-qr.png');
const video = join(dir, 'login-qr.y4m');
mkdirSync(dir, { recursive: true });
execFileSync('qrencode', ['-s', '10', '-m', '4', '-o', png, `${BASE_URL}/#token=${encodeURIComponent(TOKEN)}`]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', png, '-t', '2', '-r', '10',
  '-vf', 'scale=640:640,pad=640:640', '-pix_fmt', 'yuv420p', '-f', 'yuv4mpegpipe', video]);

test.use({
  permissions: ['camera'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] },
});

test('the token screen scans the login QR code with the camera', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium can fake a camera');
  await page.goto('/');
  await page.getByTestId('token-scan').click();
  await expect(page.getByTestId('vault-switcher')).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => localStorage.getItem('karpathy.token'))).toBe(TOKEN);
});

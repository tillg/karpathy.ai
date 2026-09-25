import { expect, openApp, test } from './helpers';

// Issue #2: #app must not be scrollable at all, so CM's scrollIntoView (search hit opened during
// the phone slide transition) can't shift the layout sideways. Deterministic check of the cause;
// the timing-dependent repro is mobile.spec.ts › search tab.
test('@iphone #app cannot be scrolled sideways while a pane is off screen (#2)', async ({ page, vault }) => {
  await openApp(page, vault.id);
  await page.getByTestId('tab-search').click();
  await page.getByTestId('search-input').fill('unicode check');
  // During the slide transition, try to scroll #app every frame (as scrollIntoView would).
  const max = page.evaluate(() => new Promise<number>((done) => {
    const app = document.querySelector('#app')!;
    let m = 0;
    const t0 = performance.now();
    const f = () => {
      app.scrollLeft = 40;
      m = Math.max(m, app.scrollLeft);
      if (performance.now() - t0 < 800) requestAnimationFrame(f); else done(m);
    };
    requestAnimationFrame(f);
  }));
  await page.locator('[data-testid="search-result"][data-path="Home.md"]').click();
  expect(await max).toBe(0);
  await expect(page.locator('#app')).toHaveAttribute('data-dt', 'cur');
});

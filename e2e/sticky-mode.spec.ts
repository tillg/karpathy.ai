import { expect, openApp, openNote, test, treeItem } from './helpers';

// The Write/Read mode is a preference: only the toggle changes it (media-embeds-sticky-mode).
test('Read mode stays when opening from the tree, search and the Changes list', async ({ page, api, vault }) => {
  await api.write(vault.id, 'Ideas.md', '# Ideas\n\nBack to [[Home]]. Changed.\n');
  await openApp(page, vault.id);
  await openNote(page, 'Home.md');
  await page.getByTestId('mode-read').click();
  await expect(page.getByTestId('read-view')).toBeVisible();

  const stillRead = async (title: string) => {
    await expect(page.locator('.note-title')).toHaveText(title);
    await expect(page.getByTestId('mode-read')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('read-view')).toBeVisible();
    await expect(page.locator('.cm-content')).toHaveCount(0);
  };

  await treeItem(page, 'Ideas.md').click();
  await stillRead('Ideas');

  await page.getByTestId('section-search').click();
  await page.getByTestId('search-input').fill('Welcome');
  await page.locator('[data-testid="search-result"][data-path="Home.md"]').click();
  await stillRead('Home');

  await page.getByTestId('section-changes').click();
  await page.locator('[data-testid="change-item"][data-path="Ideas.md"] button[title="Open note"]').click();
  await stillRead('Ideas');
});

test('mode preference survives a reload', async ({ page, vault }) => {
  await openApp(page, vault.id);
  await openNote(page, 'Home.md');
  await expect(page.getByTestId('mode-write')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('mode-read').click();
  await page.reload();
  await treeItem(page, 'Ideas.md').click();
  await expect(page.locator('.note-title')).toHaveText('Ideas');
  await expect(page.getByTestId('mode-read')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cm-content')).toHaveCount(0);

  await page.getByTestId('mode-write').click();
  await page.reload();
  await treeItem(page, 'Ideas.md').click();
  await expect(page.locator('.note-title')).toHaveText('Ideas');
  await expect(page.getByTestId('mode-write')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cm-content')).toBeVisible();
});

// ---- Place: hit position, Back, mode switch (a 400+ line note with a link in every section) ----
const SECTIONS = 40;
const longNote = () => {
  const out = ['# Long', ''];
  for (let i = 1; i <= SECTIONS; i++) {
    out.push(`## Section ${i}`, '', `Intro of section ${i}. Back to [[Home]].`, '', i === 18 ? 'The rare word is zebrafish here.' : `Filler text of section ${i}.`, '', `More filler text of section ${i}.`, '');
  }
  return out.join('\n');
};
const lineOfText = (text: string, needle: string) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;

/** Position of an element relative to the scroll pane: top below the header overlay (52px) means "first visible". */
const relTop = (page: import('@playwright/test').Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => {
    const sc = el.closest('.scroll')!;
    return el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
  });
const scrollTop = (page: import('@playwright/test').Page) => page.locator('#detail .scroll').evaluate((e) => e.scrollTop);
const viewportH = (page: import('@playwright/test').Page) => page.locator('#detail .scroll').evaluate((e) => e.clientHeight);

test('Read mode scrolls to the hit and highlights it', async ({ page, api, vault }) => {
  const text = longNote();
  await api.write(vault.id, 'Long.md', text);
  await api.write(vault.id, 'Linker.md', '# Linker\n\nSee [[Long#Section 38]].\n');
  await openApp(page, vault.id);
  await openNote(page, 'Home.md');
  await page.getByTestId('mode-read').click();

  const line = lineOfText(text, 'zebrafish');
  await page.getByTestId('section-search').click();
  await page.getByTestId('search-input').fill('zebrafish');
  await page.locator('[data-testid="search-result"][data-path="Long.md"]').click();
  const block = page.locator(`.read [data-line="${line}"]`);
  await expect(block).toHaveClass(/hit/);
  const top = await relTop(page, `.read [data-line="${line}"]`);
  expect(top).toBeGreaterThan(0);
  expect(top).toBeLessThan(await viewportH(page));
  await expect(block).not.toHaveClass(/hit/, { timeout: 4000 });

  await page.getByTestId('section-files').click();
  await treeItem(page, 'Linker.md').click();
  await expect(page.locator('.note-title')).toHaveText('Linker');
  await page.getByTestId('read-view').locator('a.wl').click();
  await expect(page.locator('.note-title')).toHaveText('Long');
  const h = page.locator('.read h2', { hasText: /^Section 38$/ });
  await expect(h).toBeVisible();
  await expect.poll(() => relTop(page, '.read h2:text-is("Section 38")')).toBeGreaterThan(0);
  expect(await relTop(page, '.read h2:text-is("Section 38")')).toBeLessThan(await viewportH(page));
});

test('Back returns to the same place', async ({ page, api, vault }) => {
  await api.write(vault.id, 'Long.md', longNote());
  await openApp(page, vault.id);
  await openNote(page, 'Home.md');
  await page.getByTestId('mode-read').click();
  await treeItem(page, 'Long.md').click();
  await expect(page.locator('.note-title')).toHaveText('Long');
  const sc = page.locator('#detail .scroll');
  // A fresh open lands at the top.
  expect(await scrollTop(page)).toBe(0);

  await sc.evaluate((e) => { e.scrollTop = (e.scrollHeight - e.clientHeight) * 0.6; });
  await page.waitForTimeout(200);
  const before = await scrollTop(page);
  expect(before).toBeGreaterThan(500);
  await page.locator('.read a.wl').evaluateAll((as) => {
    const sc = document.querySelector('#detail .scroll')!.getBoundingClientRect();
    (as.find((a) => { const r = a.getBoundingClientRect(); return r.top > sc.top + 60 && r.bottom < sc.bottom; }) as HTMLElement).click();
  });
  await expect(page.locator('.note-title')).toHaveText('Home');
  await page.goBack();
  await expect(page.locator('.note-title')).toHaveText('Long');
  await expect.poll(async () => Math.abs((await scrollTop(page)) - before), { timeout: 5000 }).toBeLessThan(10);

  // Write mode.
  await page.getByTestId('mode-write').click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.waitForTimeout(1500); // the editor is still moving to the line it took over from Read mode
  await sc.evaluate((e) => { e.scrollTop = (e.scrollHeight - e.clientHeight) * 0.6; });
  await page.waitForTimeout(500);
  expect(await scrollTop(page)).toBeGreaterThan(500);
  // CodeMirror's pixel heights are estimates until measured, so compare the text at the top, not scrollTop.
  const firstLine = () => page.locator('.cm-line').evaluateAll((ls) => {
    const sc = document.querySelector('#detail .scroll') as HTMLElement;
    const top = sc.getBoundingClientRect().top + parseFloat(getComputedStyle(sc).paddingTop);
    return ls.find((l) => l.getBoundingClientRect().bottom > top + 1 && l.textContent)?.textContent ?? null;
  });
  // Wait until CodeMirror stopped shifting the content while it measures lines.
  let wBefore = await firstLine();
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(400);
    const now = await firstLine();
    if (now === wBefore) break;
    wBefore = now;
  }
  expect(wBefore).toMatch(/section \d+|Section \d+/);
  await treeItem(page, 'Ideas.md').click();
  await expect(page.locator('.note-title')).toHaveText('Ideas');
  await page.goBack();
  await expect(page.locator('.note-title')).toHaveText('Long');
  await expect.poll(firstLine, { timeout: 5000 }).toBe(wBefore);

  // A fresh open from the tree lands at the top again.
  await treeItem(page, 'Ideas.md').click();
  await expect(page.locator('.note-title')).toHaveText('Ideas');
  await treeItem(page, 'Long.md').click();
  await expect(page.locator('.note-title')).toHaveText('Long');
  await page.waitForTimeout(500);
  expect(await scrollTop(page)).toBe(0);
});

test('mode switch keeps the place', async ({ page, api, vault }) => {
  await api.write(vault.id, 'Long.md', longNote());
  await openApp(page, vault.id);
  await openNote(page, 'Home.md');
  await page.getByTestId('mode-read').click();
  await treeItem(page, 'Long.md').click();
  await expect(page.locator('.note-title')).toHaveText('Long');

  // Read: heading H far down is the first visible block (just below the header overlay).
  await page.locator('.read h2:text-is("Section 30")').evaluate((el) => {
    const sc = el.closest('.scroll') as HTMLElement;
    sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - parseFloat(getComputedStyle(sc).paddingTop);
  });
  await page.waitForTimeout(200);
  await page.getByTestId('mode-write').click();
  const quarter = (await viewportH(page)) / 4;
  const hLine = page.locator('.cm-line', { hasText: /^## Section 30$/ });
  await expect(hLine).toBeVisible();
  // The editor lays out first, then scrolls the line to the top.
  await expect.poll(() => hLine.evaluate((el) => el.getBoundingClientRect().top - el.closest('.scroll')!.getBoundingClientRect().top)).toBeGreaterThan(0);
  await expect.poll(() => hLine.evaluate((el) => el.getBoundingClientRect().top - el.closest('.scroll')!.getBoundingClientRect().top)).toBeLessThan(quarter);
  expect(await page.evaluate(() => !!document.activeElement?.closest('.cm-content'))).toBe(false);

  // Write: scroll up to another heading K, then Read keeps it.
  await page.locator('#detail .scroll').evaluate((e) => { e.scrollTop -= 3000; });
  await page.waitForTimeout(400);
  // Put the first visible heading K at the top of the pane (below the header overlay).
  const k = await page.locator('.cm-line').evaluateAll((ls) => {
    const sc = document.querySelector('#detail .scroll') as HTMLElement;
    const top = sc.getBoundingClientRect().top + parseFloat(getComputedStyle(sc).paddingTop);
    const h = ls.find((l) => l.getBoundingClientRect().top >= top && /^## Section \d+$/.test(l.textContent ?? ''));
    if (!h) return null;
    sc.scrollTop += h.getBoundingClientRect().top - top;
    return h.textContent;
  });
  await page.waitForTimeout(300);
  expect(k).not.toBeNull();
  await page.getByTestId('mode-read').click();
  await expect(page.getByTestId('read-view')).toBeVisible();
  await expect.poll(async () => {
    const t2 = await relTop(page, `.read h2:text-is("${k!.slice(3)}")`);
    return t2 > 0 && t2 < quarter;
  }).toBe(true);
});

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, makeConflict, openApp, openNote, test } from './helpers';

// Automated WCAG 2.1 A/AA + best-practice scan (axe-core) of the main screens, light and dark
// (issues #39–#47). Only serious/critical findings fail; moderate/minor best-practice rules
// (e.g. `region`) are reported by axe but not asserted.
//
// Deliberately excluded:
// - `.cm-content` (the CodeMirror editor): its contenteditable internals (dimmed `[[ ]]`/`#`
//   syntax markers, selection layers) are editor chrome, not page content; Read mode renders
//   the same note as HTML and is scanned instead.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function scan(page: Page, label: string) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    // Let open/fade animations finish (axe would measure half-transparent colours); spinners loop forever.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));
    const r = await new AxeBuilder({ page }).withTags(TAGS).exclude('.cm-content').analyze();
    const bad = r.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`).join(' | ')}`);
    expect.soft(bad, `axe: ${label} (${colorScheme})`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: null });
}

test.describe('accessibility (axe)', () => {
  test('token screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('token-input')).toBeVisible();
    await scan(page, 'token screen');
  });

  test('desktop shell: note (write + read), search, changes, commit dialog, admin dialog, chat', async ({ page, api, vault }) => {
    await api.write(vault.id, 'Code.md', `# Code\n\nSee [[Home]].\n\n\`\`\`\n${'const wide = 1; '.repeat(30)}\n\`\`\`\n`);
    await openApp(page, vault.id);
    await openNote(page, 'Home.md');
    await scan(page, 'shell, Write mode');

    await page.getByTestId('mode-read').click();
    await expect(page.getByTestId('read-view').locator('a.wl').first()).toBeVisible();
    await scan(page, 'Read mode');
    // Wide code block: keyboard-scrollable (#45).
    await page.locator('[data-testid="tree-item"][data-path="Code.md"]').click();
    await page.getByTestId('mode-read').click();
    await expect(page.getByTestId('read-view').locator('pre')).toHaveAttribute('tabindex', '0');
    await scan(page, 'Read mode, code block');

    await page.getByTestId('section-search').click();
    await page.getByTestId('search-input').fill('Wissen');
    await expect(page.getByTestId('search-meta')).toBeVisible();
    await scan(page, 'search');

    await api.write(vault.id, 'Ideas.md', '# Ideas\n\nchanged\n');
    await page.getByTestId('section-changes').click();
    await expect(page.getByTestId('change-item')).toHaveCount(2);
    await page.getByTestId('change-item').first().locator('.chg-main').click();
    await expect(page.getByTestId('diff')).toBeVisible();
    await scan(page, 'changes');

    await page.getByTestId('commit-button').click();
    await expect(page.getByTestId('commit-message')).toBeEnabled({ timeout: 30_000 });
    await scan(page, 'commit dialog');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('commit-dialog')).toBeHidden();

    await page.getByTestId('open-admin').click();
    await expect(page.getByTestId('admin-vault').first()).toBeVisible();
    await scan(page, 'admin dialog');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('admin')).toBeHidden();

    if (!(await page.locator('#chat').isVisible())) await page.getByTestId('chat-toggle').click();
    await expect(page.locator('#chat')).toBeVisible();
    await scan(page, 'chat list');
    await page.getByTestId('new-chat').click();
    await expect(page.getByTestId('chat-messages')).toContainText('New chat');
    await scan(page, 'chat conversation');
  });

  test('conflict view and the larger compare dialog', async ({ page, api, vault }) => {
    await makeConflict(api, vault);
    await openApp(page, vault.id);
    await page.getByTestId('section-changes').click();
    const item = page.locator('[data-testid="conflict-item"][data-path="Ideas.md"]');
    await expect(item).toContainText('# Ideas theirs');
    await scan(page, 'conflict view');
    await item.getByTestId('conflict-compare').click();
    await expect(page.getByTestId('conflict-compare-dialog')).toBeVisible();
    await scan(page, 'conflict compare dialog');
  });

  test('@iphone phone: files, note, search, changes, chat', async ({ page, api, vault }) => {
    await openApp(page, vault.id);
    await scan(page, 'phone files');
    await page.locator('[data-testid="tree-item"][data-path="Home.md"]').click();
    await expect(page.locator('#app')).toHaveAttribute('data-dt', 'cur');
    await scan(page, 'phone note');
    await page.getByTestId('back').click();
    await page.getByTestId('tab-search').click();
    await page.getByTestId('search-input').fill('Wissen');
    await expect(page.getByTestId('search-meta')).toBeVisible();
    await scan(page, 'phone search');
    await api.write(vault.id, 'Ideas.md', '# Ideas\n\nchanged\n');
    await page.getByTestId('tab-changes').click();
    await expect(page.getByTestId('change-item')).toHaveCount(1);
    await scan(page, 'phone changes');
    await page.getByTestId('tab-chat').click();
    await scan(page, 'phone chat');
  });
});

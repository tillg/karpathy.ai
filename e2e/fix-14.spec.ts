import type { Page } from '@playwright/test';
import { expect, openApp, openNote, test, waitSaved } from './helpers';

const HOME = '# Home\n\nWelcome to the test vault.';

/** Like helpers.typeAtEnd, but clicks the title line (the middle of Home.md is a wikilink). */
async function typeAtEnd(page: Page, text: string) {
  await page.locator('.cm-line').first().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}

// Issue #14: unsaved edits survive reload/close/offline.
test.describe('unsaved drafts survive (#14)', () => {
  test('reload within the autosave window keeps the edit (warns first)', async ({ page, api, vault }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.type()); void d.accept(); });
    await openApp(page, vault.id);
    await openNote(page, 'Home.md');
    await typeAtEnd(page, ' RELOAD-DRAFT');
    await page.reload();
    await expect(page.locator('.note-title')).toHaveText('Home');
    await expect(page.locator('.cm-content')).toContainText('RELOAD-DRAFT');
    await expect.poll(async () => (await api.file(vault.id, 'Home.md'))?.content).toContain('RELOAD-DRAFT');
    await waitSaved(page);
    expect(dialogs).toContain('beforeunload');
  });

  test('a save that failed offline is retried when back online', async ({ page, context, api, vault }) => {
    await openApp(page, vault.id);
    await openNote(page, 'Home.md');
    await typeAtEnd(page, ' OFFLINE-DRAFT');
    await context.setOffline(true);
    await expect(page.getByTestId('save-state')).toContainText('Unsaved changes');
    await page.waitForTimeout(2500); // the debounced save fails meanwhile
    await context.setOffline(false);
    await waitSaved(page);
    expect((await api.file(vault.id, 'Home.md'))?.content).toContain('OFFLINE-DRAFT');
  });

  test('a persisted draft whose base changed on the server opens the stale-save flow', async ({ page, api, vault }) => {
    page.on('dialog', (d) => void d.accept());
    await openApp(page, vault.id);
    await openNote(page, 'Home.md');
    // Saves fail (server unreachable for PUTs), so the edit only lives in the local draft.
    await page.route((u) => u.pathname.endsWith('/file'), (r) => (r.request().method() === 'PUT' ? r.abort() : r.continue()));
    await typeAtEnd(page, ' LOCAL-ONLY');
    await expect(page.getByTestId('toast')).toContainText('Save failed');
    await api.write(vault.id, 'Home.md', `${HOME}\n\nchanged elsewhere\n`);
    await page.reload();
    await page.unrouteAll();
    await expect(page.locator('.note-title')).toHaveText('Home');
    await expect(page.getByTestId('stale-dialog')).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('LOCAL-ONLY');
    await page.getByTestId('stale-overwrite').click();
    await waitSaved(page);
    expect((await api.file(vault.id, 'Home.md'))?.content).toContain('LOCAL-ONLY');
  });
});

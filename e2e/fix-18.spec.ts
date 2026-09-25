import { expect, openApp, openNote, remoteShow, test, typeAtEnd } from './helpers';

// #18: with only an unsaved edit (inside the autosave debounce), Commit is enabled and commits it.
test('commit is enabled while the only change is still unsaved', async ({ page, api, vault }) => {
  await openApp(page, vault.id);
  await openNote(page, 'Ideas.md');
  await page.getByTestId('section-changes').click();
  await expect(page.getByTestId('commit-button')).toBeDisabled();
  await typeAtEnd(page, '\nOnly unsaved change.');
  await expect(page.getByTestId('commit-button')).toBeEnabled({ timeout: 1000 }); // before the 1.5 s autosave
  await page.getByTestId('commit-button').click();
  await expect(page.getByTestId('commit-message')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('commit-message').fill('e2e: unsaved-only commit');
  await page.getByTestId('commit-submit').click();
  await expect(page.getByTestId('toast')).toContainText('Committed and pushed');
  expect(remoteShow(vault.bare, 'Ideas.md')).toContain('Only unsaved change.');
  expect(await api.changes(vault.id)).toEqual([]);
});

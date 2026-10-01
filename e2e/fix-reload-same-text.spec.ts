import { backendExec, expect, openApp, openNote, test, typeAtEnd, waitSaved } from './helpers';

// Found on the demo vault: after typing (saved), a reload that brings back the text the note was
// opened with (discard, the AI reverting it, another device) left the typed text in the editor.
test.describe('editor follows a reload back to the opened text', () => {
  test('discard from the Changes panel clears the typed text in the open note', async ({ page, api, vault }) => {
    page.on('dialog', (d) => void d.accept());
    await openApp(page, vault.id);
    await openNote(page, 'Ideas.md');
    await typeAtEnd(page, '\nTYPED-THEN-DISCARDED');
    await waitSaved(page);
    await page.getByTestId('section-changes').click();
    const item = page.locator('[data-testid="change-item"][data-path="Ideas.md"]');
    await item.locator('.chg-main').click();
    await item.getByTestId('discard').click();
    await expect(page.getByTestId('changes-badge')).toHaveAttribute('data-count', '0');
    await page.getByTestId('section-files').click();
    await expect(page.locator('.cm-content')).not.toContainText('TYPED-THEN-DISCARDED');
    expect((await api.file(vault.id, 'Ideas.md'))?.content).not.toContain('TYPED-THEN-DISCARDED');
  });

  test('the AI restores the original text on disk → the editor shows it', async ({ page, api, vault }) => {
    await openApp(page, vault.id);
    await openNote(page, 'Ideas.md');
    await typeAtEnd(page, '\nTYPED-THEN-REVERTED');
    await waitSaved(page);
    // Straight on the vault volume, like opencode's file tools (API saves count as the editor's own).
    backendExec('git', '-C', `/vaults/${vault.id}`, 'checkout', '--', 'Ideas.md');
    await expect(page.getByTestId('toast')).toContainText('Updated by AI or another device');
    await expect(page.locator('.cm-content')).not.toContainText('TYPED-THEN-REVERTED');
    // Typing on must not resurrect the reverted text.
    await typeAtEnd(page, ' more');
    await waitSaved(page);
    expect((await api.file(vault.id, 'Ideas.md'))?.content).not.toContain('TYPED-THEN-REVERTED');
  });
});

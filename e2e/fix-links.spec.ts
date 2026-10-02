import { expect, openApp, openNote, test } from './helpers';

const NOTE = `---
related: ["[[Ideas]]", Ideas, other.md, nothing-here]
sources: [other]
tags: [Ideas]
---
# Links

[wiki]([[Ideas]])

[[Ideas]] [[Missing note]] [ext](https://example.com/x) [mail](mailto:a@b.c)

[rel](sub/other.md) [enc](sub/my%20note.md) [gone](sub/gone.md)
`;

test('109 wikilinks have a real href; 110 external links open in a new tab; 116 relative links stay in the app; 108 frontmatter values link', async ({ page, api, vault }) => {
  await api.write(vault.id, 'links.md', NOTE.replace('[wiki]([[Ideas]])\n\n', ''));
  await api.write(vault.id, 'sub/other.md', '# Other\n');
  await api.write(vault.id, 'sub/my note.md', '# My note\n');
  await openApp(page, vault.id);
  await openNote(page, 'links.md');
  await page.getByTestId('mode-read').click();
  const rd = page.locator('.read .rd');
  // 109
  await expect(rd.locator('a.wl', { hasText: 'Ideas' })).toHaveAttribute('href', `#/${vault.id}/Ideas.md`);
  await expect(rd.locator('a.wl.miss')).toHaveAttribute('href', '#');
  await expect(page.locator('.props a.wl', { hasText: 'Ideas' }).first()).toHaveAttribute('href', `#/${vault.id}/Ideas.md`);
  // 110
  for (const t of ['ext', 'mail']) {
    await expect(rd.getByRole('link', { name: t })).toHaveAttribute('target', '_blank');
    await expect(rd.getByRole('link', { name: t })).toHaveAttribute('rel', 'noopener noreferrer');
  }
  // 116
  await expect(rd.getByRole('link', { name: 'enc' })).toHaveAttribute('href', `#/${vault.id}/sub/my%20note.md`);
  await expect(rd.getByRole('link', { name: 'gone' })).toHaveAttribute('href', 'sub/gone.md');
  await rd.getByRole('link', { name: 'enc' }).click();
  await expect(page.locator('.note-title')).toHaveText('my note');
  expect(new URL(page.url()).pathname).toBe('/');
  await page.getByTestId('mode-read').click();
  await page.goBack();
  await page.getByTestId('mode-read').click();
  await rd.getByRole('link', { name: 'rel' }).click();
  await expect(page.locator('.note-title')).toHaveText('other');
  // 108
  await page.goBack();
  await page.getByTestId('mode-read').click();
  const prop = (k: string) => page.locator('.props .prop').filter({ has: page.locator(`span:first-child:text-is("${k}")`) });
  await expect(prop('related').locator('.chip a')).toHaveCount(3); // [[Ideas]], Ideas, other.md
  await expect(prop('related').locator('.chip').filter({ hasText: 'nothing-here' }).locator('a')).toHaveCount(0);
  await expect(prop('sources').locator('.chip a')).toHaveCount(1);
  await expect(prop('tags').locator('.chip a')).toHaveCount(0);
  await prop('related').locator('.chip a', { hasText: 'other.md' }).click();
  await expect(page.locator('.note-title')).toHaveText('other');
});

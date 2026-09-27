import { expect, openApp, openNote, test, type Api, type TestVault } from './helpers';

const NOTE = `---
tags:
  - concept
  - llm
  - "meta"
sources: [karpathy-llm-wiki-gist.md, source-05.md]
related: ["[[entities/andrej-karpathy]]", "[[Ideas]]"]
aliases: [LLM-Wiki, "Compiled wiki"]
title: "LLM wiki: a pattern"
---
# LLM wiki
`;

async function seed(api: Api, vault: TestVault) {
  await api.write(vault.id, 'llm-wiki.md', NOTE);
  await api.write(vault.id, 'entities/andrej-karpathy.md', '# Andrej Karpathy\n');
}

async function check(page: import('@playwright/test').Page, api: Api, vault: TestVault, shot: string) {
  await page.getByTestId('mode-read').click();
  const props = page.locator('.read .props');
  const prop = (k: string) => props.locator('.prop').filter({ has: page.locator(`span:first-child:text-is("${k}")`) });
  await expect(prop('tags').locator('.chip')).toHaveText(['concept', 'llm', 'meta']);
  await expect(prop('sources').locator('.chip')).toHaveText(['karpathy-llm-wiki-gist.md', 'source-05.md']);
  await expect(prop('aliases').locator('.chip')).toHaveText(['LLM-Wiki', 'Compiled wiki']);
  await expect(prop('title')).toContainText('LLM wiki: a pattern');
  const text = (await props.innerText());
  expect(text).not.toMatch(/[[\]"]|^\s*- /m);
  await page.screenshot({ path: shot });
  await prop('related').locator('a.wl', { hasText: 'andrej-karpathy' }).click();
  await expect(page.locator('.note-title')).toHaveText('andrej-karpathy');
  expect((await api.file(vault.id, 'llm-wiki.md'))?.content).toBe(NOTE);
}

// #58: Read mode shows frontmatter values without YAML syntax; [[links]] in them are clickable.
test('Read mode renders frontmatter lists as chips and property wikilinks as links', async ({ page, api, vault }) => {
  await seed(api, vault);
  await openApp(page, vault.id);
  await openNote(page, 'llm-wiki.md');
  await check(page, api, vault, 'tmp/fix6/58-desktop.png');
});

test('@iphone frontmatter chips and links on the phone', async ({ page, api, vault }) => {
  await seed(api, vault);
  await openApp(page, vault.id);
  await openNote(page, 'llm-wiki.md');
  await check(page, api, vault, 'tmp/fix6/58-iphone.png');
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { frontmatterFields, renderMarkdown, splitFrontmatter, toHtml } from './markdown';

describe('splitFrontmatter', () => {
  it('splits a leading block', () => {
    expect(splitFrontmatter('---\ntype: x\ntags: [a, b]\n---\n# T\n')).toEqual({ frontmatter: 'type: x\ntags: [a, b]', body: '# T\n' });
  });
  it('ignores notes without one', () => {
    expect(splitFrontmatter('# T\n---\n').frontmatter).toBeNull();
  });
  it('reads key/value pairs', () => {
    expect(frontmatterFields('type: x\ntags: [a, b]')).toEqual([['type', 'x'], ['tags', ['a', 'b']]]);
  });
});

describe('frontmatterFields (#58: readable values)', () => {
  it('reads block lists, inline lists and quoted scalars without YAML syntax', () => {
    const fm = [
      'tags:',
      '  - concept',
      '  - llm',
      '  - "meta"',
      'sources: [karpathy-llm-wiki-gist.md, source-05.md]',
      'related: ["[[entities/andrej-karpathy]]", "[[zettelkasten]]"]',
      'aliases: [LLM-Wiki, "Compiled wiki", \'it\'\'s\']',
      'title: "Hello: world"',
      "note: 'single'",
      'flush:',
      '- a',
      '- b',
      'empty:',
      'none: []',
      'commas: ["a, b", c]',
    ].join('\n');
    expect(frontmatterFields(fm)).toEqual([
      ['tags', ['concept', 'llm', 'meta']],
      ['sources', ['karpathy-llm-wiki-gist.md', 'source-05.md']],
      ['related', ['[[entities/andrej-karpathy]]', '[[zettelkasten]]']],
      ['aliases', ['LLM-Wiki', 'Compiled wiki', "it's"]],
      ['title', 'Hello: world'],
      ['note', 'single'],
      ['flush', ['a', 'b']],
      ['empty', ''],
      ['none', []],
      ['commas', ['a, b', 'c']],
    ]);
  });

  it('joins continued plain scalars and keeps unknown shapes as raw text', () => {
    const fm = [
      'summary: first',
      '  second',
      'nested:',
      '  a: 1',
      '  b: [x]',
      'block: |',
      '  line one',
      '  line two',
      'broken: [a, b',
      'map: {a: 1}',
      '# a comment',
      'last: x # not a comment in this parser',
    ].join('\n');
    expect(frontmatterFields(fm)).toEqual([
      ['summary', 'first second'],
      ['nested', 'a: 1\nb: [x]'],
      ['block', 'line one\nline two'],
      ['broken', '[a, b'],
      ['map', '{a: 1}'],
      ['last', 'x # not a comment in this parser'],
    ]);
  });
});

describe('toHtml', () => {
  it('renders wikilinks with alias and missing marker', () => {
    const html = toHtml('See [[concepts/llm-wiki|the wiki]] and [[nope]].', (t) => t === 'concepts/llm-wiki');
    expect(html).toContain('<a href="#" class="wl" data-target="concepts/llm-wiki|the wiki">the wiki</a>');
    expect(html).toContain('<a href="#" class="wl miss" data-target="nope">nope</a>');
  });
});

describe('renderMarkdown (Obsidian syntax)', () => {
  const r = (md: string) => renderMarkdown(md, () => true);

  it('#102 task list items keep a non-interactive marker (no input)', () => {
    const html = r('- [x] done\n- [ ] open\n');
    expect(html).not.toContain('<input');
    expect(html).toContain('data-done="true"');
    expect(html).toContain('data-done="false"');
    expect(html).toContain('☑');
    expect(html).toContain('☐');
    expect(html).toContain('done');
  });

  it('#111 callouts become a titled block', () => {
    const html = r('> [!warning] Careful\n> Hot **stuff**\n> second line\n\n> [!note]-\n> body\n\n> plain quote\n');
    expect(html).toContain('<div class="callout" data-callout="warning">');
    expect(html).toContain('<div class="callout-title">Careful</div>');
    expect(html).toMatch(/<div class="callout-body">[\s\S]*Hot <strong>stuff<\/strong>[\s\S]*second line[\s\S]*<\/div>/);
    expect(html).toContain('data-callout="note"');
    expect(html).toContain('<div class="callout-title">Note</div>');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('[!');
  });

  it('#112 %%comments%% are hidden, except in code', () => {
    const html = r('a %%secret%% b\n\n%%\nmulti\nline\n%%\n\nkeep `%%code%%` here\n\n```\n%%block%%\n```\n');
    expect(html).not.toContain('secret');
    expect(html).not.toContain('multi');
    expect(html).toContain('<code>%%code%%</code>');
    expect(html).toContain('%%block%%');
    expect(html).toContain('a  b');
  });

  it('#113 ==highlight== becomes <mark>', () => {
    expect(r('x ==hot== y')).toContain('<mark>hot</mark>');
    expect(r('`==no==`')).not.toContain('<mark>');
  });

  it('#114 ![[note]] renders as an embed link without "!"', () => {
    const html = r('see ![[concepts/x|Label]] now');
    expect(html).toMatch(/<a [^>]*class="wl embed"[^>]*data-target="concepts\/x\|Label"[^>]*>Label<\/a>/);
    expect(html).not.toContain('!<a');
    expect(html).not.toContain('![[');
  });

  it('#115 footnotes render a superscript link and a footnotes section', () => {
    const html = r('Claim[^1] and more[^note].\n\n[^1]: First *source*.\n[^note]: Second.\n');
    expect(html).toMatch(/<sup[^>]*><a href="#fn-1"[^>]*>1<\/a><\/sup>/);
    expect(html).toMatch(/<sup[^>]*><a href="#fn-2"[^>]*>2<\/a><\/sup>/);
    expect(html).toContain('<section class="footnotes">');
    expect(html).toMatch(/<li id="fn-1">[\s\S]*First <em>source<\/em>\./);
    expect(html).toContain('id="fn-2"');
    expect(html).not.toContain('[^');
  });
});

import { describe, expect, it } from 'vitest';
import { frontmatterFields, splitFrontmatter, toHtml } from './markdown';

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

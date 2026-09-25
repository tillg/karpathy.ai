import { describe, expect, it } from 'vitest';
import { frontmatterProps, splitFrontmatter, toHtml } from './markdown';

describe('splitFrontmatter', () => {
  it('splits a leading block', () => {
    expect(splitFrontmatter('---\ntype: x\ntags: [a, b]\n---\n# T\n')).toEqual({ frontmatter: 'type: x\ntags: [a, b]', body: '# T\n' });
  });
  it('ignores notes without one', () => {
    expect(splitFrontmatter('# T\n---\n').frontmatter).toBeNull();
  });
  it('reads key/value pairs', () => {
    expect(frontmatterProps('type: x\ntags: [a, b]')).toEqual([['type', 'x'], ['tags', '[a, b]']]);
  });
});

describe('toHtml', () => {
  it('renders wikilinks with alias and missing marker', () => {
    const html = toHtml('See [[concepts/llm-wiki|the wiki]] and [[nope]].', (t) => t === 'concepts/llm-wiki');
    expect(html).toContain('<a href="#" class="wl" data-target="concepts/llm-wiki|the wiki">the wiki</a>');
    expect(html).toContain('<a href="#" class="wl miss" data-target="nope">nope</a>');
  });
});

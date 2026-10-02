// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';
import { resolveRelativeLink } from './wikilink';

const paths = ['Wiki/index.md', 'Wiki/My Note.md', 'Home.md', 'Wiki/sub/deep.md', 'img/a.png'];

describe('116 resolveRelativeLink', () => {
  it('resolves ../ relative to the note folder', () => expect(resolveRelativeLink('../Wiki/index.md', 'Notes/x.md', paths)).toBe('Wiki/index.md'));
  it('resolves siblings and adds .md', () => expect(resolveRelativeLink('index', 'Wiki/x.md', paths)).toBe('Wiki/index.md'));
  it('decodes %20 and drops #fragment / ?query', () => expect(resolveRelativeLink('My%20Note.md#top', 'Wiki/x.md', paths)).toBe('Wiki/My Note.md'));
  it('treats a leading slash as vault root', () => expect(resolveRelativeLink('/Home.md', 'Wiki/x.md', paths)).toBe('Home.md'));
  it('returns null for missing targets, external URLs, anchors and escapes above the root', () => {
    expect(resolveRelativeLink('nope.md', 'Wiki/x.md', paths)).toBeNull();
    expect(resolveRelativeLink('https://example.com/index.md', 'Wiki/x.md', paths)).toBeNull();
    expect(resolveRelativeLink('#heading', 'Wiki/x.md', paths)).toBeNull();
    expect(resolveRelativeLink('../../Home.md', 'Wiki/x.md', paths)).toBeNull();
  });
});

describe('109 wikilink href', () => {
  const ctx = { href: (t: string) => (t === 'Home' ? '#/v/Home.md' : null), relative: () => null };
  it('uses the target note route when it exists, else a non-navigating #', () => {
    const html = renderMarkdown('[[Home]] and [[Nope]]', (t) => t === 'Home', ctx);
    expect(html).toContain('href="#/v/Home.md"');
    expect(html).toContain('href="#" class="wl miss"');
  });
});

describe('110 external links', () => {
  it('open in a new tab with noopener noreferrer', () => {
    const html = renderMarkdown('[a](https://example.com) [m](mailto:x@y.z) [h](http://e.org)', () => true);
    expect(html.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(3);
  });
  it('does not touch in-page anchors or relative links', () => {
    const html = renderMarkdown('[a](#top) [b](other.md)', () => true);
    expect(html).not.toContain('target=');
  });
});

describe('116 relative note links', () => {
  const ctx = { href: () => null, relative: (h: string) => (h === '../Wiki/index.md' ? { path: 'Wiki/index.md', href: '#/v/Wiki/index.md' } : null) };
  it('become the note route with data-note', () => {
    const html = renderMarkdown('[i](../Wiki/index.md) [x](missing.md)', () => true, ctx);
    expect(html).toContain('href="#/v/Wiki/index.md"');
    expect(html).toContain('data-note="Wiki/index.md"');
    expect(html).toContain('href="missing.md"');
  });
});

describe('116 forged data-note', () => {
  const ctx = { href: () => null, relative: () => null };
  it('is removed from raw HTML links that do not resolve', () => {
    const html = renderMarkdown('<a data-note="../../x" href="https://x.com">e</a> <a data-note="y.md" href="other.md">r</a>', () => true, ctx);
    expect(html).not.toContain('data-note');
  });
});

describe('116 relative links from the vault root (chat)', () => {
  it('resolve against the root when from is empty', () => {
    expect(resolveRelativeLink('Wiki/index.md', '', ['Wiki/index.md'])).toBe('Wiki/index.md');
  });
});

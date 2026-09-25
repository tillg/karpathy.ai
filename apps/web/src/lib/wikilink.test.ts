import { describe, expect, it } from 'vitest';
import { parseWikilink, resolveWikilink, wikilinkLabel } from './wikilink';

const paths = ['index.md', 'log.md', 'wiki/concepts/llm-wiki.md', 'wiki/entities/obsidian.md', 'raw/notes.txt', 'wiki/entities/Andrej Karpathy.md'];

describe('parseWikilink', () => {
  it('parses target, heading and alias', () => {
    expect(parseWikilink('concepts/llm-wiki#Kernidee|the idea')).toEqual({ target: 'concepts/llm-wiki', heading: 'Kernidee', alias: 'the idea' });
    expect(parseWikilink('index')).toEqual({ target: 'index' });
    expect(parseWikilink('#Local heading')).toEqual({ target: '', heading: 'Local heading' });
  });
  it('labels with alias or last segment', () => {
    expect(wikilinkLabel(parseWikilink('a/b/c|Alias'))).toBe('Alias');
    expect(wikilinkLabel(parseWikilink('a/b/c#h'))).toBe('c');
  });
});

describe('resolveWikilink', () => {
  it('resolves an exact path', () => expect(resolveWikilink('raw/notes.txt', paths)).toBe('raw/notes.txt'));
  it('adds .md', () => expect(resolveWikilink('wiki/concepts/llm-wiki', paths)).toBe('wiki/concepts/llm-wiki.md'));
  it('matches a path suffix', () => expect(resolveWikilink('entities/obsidian', paths)).toBe('wiki/entities/obsidian.md'));
  it('matches a basename anywhere, case-insensitive', () => {
    expect(resolveWikilink('llm-wiki', paths)).toBe('wiki/concepts/llm-wiki.md');
    expect(resolveWikilink('andrej karpathy', paths)).toBe('wiki/entities/Andrej Karpathy.md');
  });
  it('returns null when nothing matches', () => {
    expect(resolveWikilink('concepts/rag', paths)).toBeNull();
    expect(resolveWikilink('', paths)).toBeNull();
  });
});

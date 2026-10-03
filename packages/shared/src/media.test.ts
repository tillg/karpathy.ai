import { describe, expect, it } from 'vitest';
import { MEDIA, isPdf, mediaKind, rawType } from './media.js';

describe('mediaKind', () => {
  it.each([
    ['a/B.PNG', 'image'],
    ['x.svg', 'image'],
    ['x.mov', 'video'],
    ['x.webm', 'video'],
    ['x.m4a', 'audio'],
    ['x.opus', 'audio'],
    ['x.md', null],
    ['x.pdf', null],
    ['png', null],
    ['dir.png/file', null],
  ])('%s → %s', (path, kind) => expect(mediaKind(path)).toBe(kind));

  it('has the Content-Types the raw route serves', () => {
    expect(MEDIA.png?.type).toBe('image/png');
    expect(MEDIA.jpg?.type).toBe('image/jpeg');
    expect(MEDIA.svg?.type).toBe('image/svg+xml');
    expect(MEDIA.mov?.type).toBe('video/quicktime');
    expect(MEDIA.mp3?.type).toBe('audio/mpeg');
    expect(MEDIA.m4a?.type).toBe('audio/mp4');
  });
});

describe('rawType / isPdf', () => {
  it('serves media inline with its type, everything else as an attachment', () => {
    expect(rawType('a/B.PNG')).toEqual({ type: 'image/png', attachment: false });
    expect(rawType('doc.pdf')).toEqual({ type: 'application/pdf', attachment: true });
    expect(rawType('x.bin')).toEqual({ type: 'application/octet-stream', attachment: true });
    expect(rawType('Home.md')).toEqual({ type: 'application/octet-stream', attachment: true });
    expect(rawType('noext')).toEqual({ type: 'application/octet-stream', attachment: true });
  });
  it('knows a PDF by extension only', () => {
    expect(isPdf('a/X.PDF')).toBe(true);
    expect(isPdf('pdf')).toBe(false);
    expect(isPdf('x.pdf.png')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { parseLoginCode } from './login-code';

describe('parseLoginCode (QR code of `just token <target> --qr`)', () => {
  it('takes the token from a login link', () => {
    expect(parseLoginCode('https://app.karpathy.app/#token=abc123')).toBe('abc123');
    expect(parseLoginCode('https://localhost:9444/#token=a%2Bb')).toBe('a+b');
  });

  it('rejects anything that is not a login link', () => {
    expect(parseLoginCode('https://example.com/')).toBeNull();
    expect(parseLoginCode('hello')).toBeNull();
    expect(parseLoginCode('https://app.karpathy.app/#token=')).toBeNull();
  });
});

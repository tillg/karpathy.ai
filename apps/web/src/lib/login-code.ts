/** The token from a login link `<app url>/#token=…` (`just token <target> --qr`), or null. */
export function parseLoginCode(text: string): string | null {
  const token = /#token=([^&]+)/.exec(text)?.[1];
  return token ? decodeURIComponent(token) : null;
}

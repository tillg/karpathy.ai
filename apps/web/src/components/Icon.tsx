// Framework7 Icons (MIT, SF-Symbols look) via ligatures, bundled from npm.
export function Icon({ n, size }: { n: string; size?: number }) {
  return <i className="f7-icons" aria-hidden style={size ? { fontSize: size } : undefined}>{n}</i>;
}

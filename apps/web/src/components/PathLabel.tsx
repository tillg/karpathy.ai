/** A vault path shown as file name (never cut off; wraps if needed) with the folder below it. */
export function PathLabel({ path, className = '' }: { path: string; className?: string }) {
  const i = path.lastIndexOf('/');
  return (
    <span className={`plabel ${className}`} title={path}>
      <span className="pbase">{path.slice(i + 1)}</span>
      {i >= 0 && <span className="pdir">{path.slice(0, i)}</span>}
    </span>
  );
}

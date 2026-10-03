// Position helpers for Read mode: top-level blocks carry `data-line` (their source line, see markdown.ts).

const blocks = (scroller: HTMLElement) => [...scroller.querySelectorAll<HTMLElement>('.read .rd > [data-line]')];
const lineOf = (b: HTMLElement) => Number(b.dataset.line);

/** Source line of the first block still visible below the header overlay (the pane's top padding). */
export function topBlockLine(scroller: HTMLElement): number | undefined {
  const top = scroller.getBoundingClientRect().top + parseFloat(getComputedStyle(scroller).paddingTop);
  const all = blocks(scroller);
  const b = all.find((x) => x.getBoundingClientRect().bottom > top + 1) ?? all[all.length - 1];
  return b ? lineOf(b) : undefined;
}

/** The last block that starts at or before `line`. */
export function blockAtLine(scroller: HTMLElement, line: number): HTMLElement | null {
  let hit: HTMLElement | null = null;
  for (const b of blocks(scroller)) if (lineOf(b) <= line) hit = b;
  return hit;
}

/** Scrolls the pane so the block of `line` is at the top (below the header) or centered. Returns the block. */
export function scrollToLine(scroller: HTMLElement, line: number, align: 'top' | 'center'): HTMLElement | null {
  const b = blockAtLine(scroller, line);
  if (!b) return null;
  if (align === 'center') b.scrollIntoView({ block: 'center' });
  else scroller.scrollTop += b.getBoundingClientRect().top - scroller.getBoundingClientRect().top - parseFloat(getComputedStyle(scroller).paddingTop);
  return b;
}

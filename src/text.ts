/** Width of `text` set in the given size, in points. */
export type Measure = (text: string, size: number, bold?: boolean) => number;

/** Greedy word wrap. Explicit `\n` always breaks; a word wider than `maxWidth` gets a line of its own. */
export function wrapGreedy(measure: Measure, text: string, size: number, maxWidth: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let current = words[0]!;
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (measure(candidate, size, bold) <= maxWidth) current = candidate;
      else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

/**
 * Wraps into as few lines as greedy wrapping needs, but with lines as even as possible
 * ("Manufacture / Product Parts" rather than "Manufacture Product / Parts").
 */
export function wrapBalanced(measure: Measure, text: string, size: number, maxWidth: number, bold = false): string[] {
  const greedy = wrapGreedy(measure, text, size, maxWidth, bold);
  if (greedy.length <= 1) return greedy;
  let lo = 0;
  let hi = maxWidth;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (wrapGreedy(measure, text, size, mid, bold).length <= greedy.length) hi = mid;
    else lo = mid;
  }
  return wrapGreedy(measure, text, size, hi, bold);
}

export function widestLine(measure: Measure, lines: readonly string[], size: number, bold = false): number {
  return lines.reduce((w, line) => Math.max(w, measure(line, size, bold)), 0);
}

/** Levenshtein edit distance, case-insensitive. */
export function editDistance(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** The candidate closest to `word`, if it is close enough to be a plausible typo. */
export function closest(word: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const d = editDistance(word, c);
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  const limit = Math.max(2, Math.floor(word.length / 3));
  return best !== undefined && bestDistance <= limit ? best : undefined;
}

/** Collapses runs of spaces, keeping explicit line breaks. */
export function normalizeLabel(label: string): string {
  return label
    .split('\n')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0)
    .join('\n');
}

/** A label on one line, as written otherwise: line breaks and runs of spaces become one space. */
export function flatLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

/** The key two labels must share to be the same arrow: case, whitespace and line breaks don't matter. */
export function labelKey(label: string): string {
  return flatLabel(label).toLowerCase();
}

/**
 * Levenshtein edit distance (insert, delete, substitute; each costs 1), extended with
 * adjacent transpositions (optimal string alignment), so "sl" is one edit from "ls".
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * "Did you mean" candidates: names within edit distance `max` (default 2) of `input`,
 * closest first, ties alphabetical. Never suggests the input itself.
 */
export function didYouMean(input: string, names: readonly string[], max = 2): string[] {
  const q = input.toLowerCase();
  return names
    .map((n) => ({ n, d: levenshtein(q, n.toLowerCase()) }))
    .filter((x) => x.d > 0 && x.d <= max)
    .sort((a, b) => a.d - b.d || a.n.localeCompare(b.n))
    .map((x) => x.n);
}

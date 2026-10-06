// Helpers for comparing the three ASR conditions against the target word.

export type DiffSegment = { text: string; ok: boolean };

/**
 * Marks which characters of the transcript match the target (longest common
 * subsequence, whitespace ignored). Characters outside the LCS are `ok: false`.
 */
export function diffTranscript(transcript: string, target: string): DiffSegment[] {
  const chars = Array.from(transcript);
  const letters = chars.flatMap((char, index) => (/\s/.test(char) ? [] : [index]));
  const goal = Array.from(target.replace(/\s+/g, ""));
  const rows = letters.length;
  const cols = goal.length;
  const table = Array.from({ length: rows + 1 }, () =>
    Array.from({ length: cols + 1 }, () => 0),
  );
  for (let i = rows - 1; i >= 0; i--)
    for (let j = cols - 1; j >= 0; j--)
      table[i][j] =
        chars[letters[i]] === goal[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);

  const matched = new Set<number>();
  for (let i = 0, j = 0; i < rows && j < cols; ) {
    if (chars[letters[i]] === goal[j]) {
      matched.add(letters[i]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }

  const segments: DiffSegment[] = [];
  chars.forEach((char, index) => {
    const ok = /\s/.test(char) || matched.has(index);
    const last = segments[segments.length - 1];
    if (last && last.ok === ok) last.text += char;
    else segments.push({ text: char, ok });
  });
  return segments;
}

export function isExactMatch(transcript: string, target: string) {
  const normalize = (text: string) => text.replace(/\s+/g, "");
  return Boolean(target) && normalize(transcript) === normalize(target);
}

export type RankDelta = { kind: "up" | "down" | "same"; label: string };

/** Change of the target's rank versus the zero-shot baseline (null = not in the Top K). */
export function rankDelta(
  baseline: number | null,
  current: number | null,
  topK = 5,
): RankDelta {
  if (baseline === null && current === null)
    return { kind: "same", label: `Still not in Top ${topK}` };
  if (baseline === null) return { kind: "up", label: `Into Top ${topK}` };
  if (current === null) return { kind: "down", label: `Out of Top ${topK}` };
  if (current === baseline) return { kind: "same", label: "Same rank" };
  const steps = Math.abs(baseline - current);
  return current < baseline
    ? { kind: "up", label: `Up ${steps}` }
    : { kind: "down", label: `Down ${steps}` };
}

// Revised Romanization of Korean, applied to how the text is pronounced:
// liaison (연음), palatalization, aspiration with ㅎ, nasalization and ㄹ assimilation.
// Tensification is not written in RR, so it is ignored.

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

// Initial consonants, indexed as in the Unicode Hangul syllable block.
const INITIALS = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s",
  "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
];
const MEDIALS = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae",
  "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i",
];

const I = { G: 0, N: 2, D: 3, R: 5, M: 6, B: 7, S: 9, SS: 10, NONE: 11, J: 12, CH: 14, K: 15, T: 16, P: 17, H: 18 };
const VOWEL_I = 20;

type Coda = "" | "k" | "n" | "t" | "l" | "m" | "p" | "ng";

// Per final consonant (index 1–27): its neutralized coda before a consonant, and how it
// splits before a vowel: [coda that stays, initial that moves to the next syllable].
const FINALS: Record<number, { coda: Coda; liaison: [Coda, number] }> = {
  1: { coda: "k", liaison: ["", I.G] }, // ㄱ
  2: { coda: "k", liaison: ["", 1] }, // ㄲ
  3: { coda: "k", liaison: ["k", I.S] }, // ㄳ
  4: { coda: "n", liaison: ["", I.N] }, // ㄴ
  5: { coda: "n", liaison: ["n", I.J] }, // ㄵ
  6: { coda: "n", liaison: ["", I.N] }, // ㄶ
  7: { coda: "t", liaison: ["", I.D] }, // ㄷ
  8: { coda: "l", liaison: ["", I.R] }, // ㄹ
  9: { coda: "k", liaison: ["l", I.G] }, // ㄺ
  10: { coda: "m", liaison: ["l", I.M] }, // ㄻ
  11: { coda: "l", liaison: ["l", I.B] }, // ㄼ
  12: { coda: "l", liaison: ["l", I.S] }, // ㄽ
  13: { coda: "l", liaison: ["l", I.T] }, // ㄾ
  14: { coda: "p", liaison: ["l", I.P] }, // ㄿ
  15: { coda: "l", liaison: ["", I.R] }, // ㅀ
  16: { coda: "m", liaison: ["", I.M] }, // ㅁ
  17: { coda: "p", liaison: ["", I.B] }, // ㅂ
  18: { coda: "p", liaison: ["p", I.S] }, // ㅄ
  19: { coda: "t", liaison: ["", I.S] }, // ㅅ
  20: { coda: "t", liaison: ["", I.SS] }, // ㅆ
  21: { coda: "ng", liaison: ["ng", I.NONE] }, // ㅇ
  22: { coda: "t", liaison: ["", I.J] }, // ㅈ
  23: { coda: "t", liaison: ["", I.CH] }, // ㅊ
  24: { coda: "k", liaison: ["", I.K] }, // ㅋ
  25: { coda: "t", liaison: ["", I.T] }, // ㅌ
  26: { coda: "p", liaison: ["", I.P] }, // ㅍ
  27: { coda: "", liaison: ["", I.NONE] }, // ㅎ
};
const H_FINALS = new Set([6, 15, 27]); // ㄶ, ㅀ, ㅎ
const ASPIRATED: Record<number, number> = { [I.G]: I.K, [I.D]: I.T, [I.J]: I.CH };

type Syllable = { initial: number; medial: number; final: number; coda: Coda };

function romanizeRun(run: Syllable[]): string {
  for (let i = 0; i < run.length; i++) {
    const current = run[i];
    current.coda = current.final ? FINALS[current.final].coda : "";
    const next = run[i + 1];
    if (!next || !current.final) continue;

    if (next.initial === I.NONE) {
      const [stay, moved] = FINALS[current.final].liaison;
      current.coda = stay;
      if (moved !== I.NONE) {
        next.initial =
          next.medial === VOWEL_I && moved === I.D
            ? I.J
            : next.medial === VOWEL_I && moved === I.T
              ? I.CH
              : moved;
      }
      continue;
    }

    if (H_FINALS.has(current.final) && next.initial in ASPIRATED) {
      next.initial = ASPIRATED[next.initial];
      current.coda = current.final === 6 ? "n" : current.final === 15 ? "l" : "";
      continue;
    }
    if (current.final === 27 && next.initial === I.N) current.coda = "n";

    if (next.initial === I.R) {
      if (current.coda === "n") current.coda = "l";
      else if (current.coda !== "l" && current.coda !== "") next.initial = I.N;
    } else if (next.initial === I.N && current.coda === "l") {
      next.initial = I.R;
    }

    if (next.initial === I.N || next.initial === I.M) {
      if (current.coda === "k") current.coda = "ng";
      else if (current.coda === "t") current.coda = "n";
      else if (current.coda === "p") current.coda = "m";
    }
  }

  return run
    .map((syllable, i) => {
      const previous = run[i - 1];
      const initial =
        syllable.initial === I.R && previous?.coda === "l" ? "l" : INITIALS[syllable.initial];
      return initial + MEDIALS[syllable.medial] + syllable.coda;
    })
    .join("");
}

/** Romanizes Hangul syllables; any other character is kept as it is. */
export function romanizeKorean(text: string): string {
  let output = "";
  let run: Syllable[] = [];
  const flush = () => {
    if (run.length) output += romanizeRun(run);
    run = [];
  };
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0)!;
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const offset = code - HANGUL_BASE;
      run.push({
        initial: Math.floor(offset / 588),
        medial: Math.floor((offset % 588) / 28),
        final: offset % 28,
        coda: "",
      });
    } else {
      flush();
      output += char;
    }
  }
  flush();
  return output;
}

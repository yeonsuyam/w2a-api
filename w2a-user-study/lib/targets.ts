import { csvRows } from "./words.ts";
import { romanizeKorean } from "./romanize.ts";

export const ENTITY_DOMAINS = ["roads", "content", "restaurants", "stations"] as const;
export type EntityDomain = (typeof ENTITY_DOMAINS)[number];

export type TargetWord = { entityId: string; korean: string; romanized: string };

/** Parses an L2-KPNS `{domain}_200.csv` (columns: korean, optional entity_id/id, romanized). */
export function parseTargetCsv(text: string): TargetWord[] {
  const [headers, ...rows] = csvRows(text.replace(/^﻿/, ""));
  if (!headers) return [];
  const column = (name: string) => headers.findIndex((header) => header.trim() === name);
  const korean = column("korean");
  if (korean < 0) throw new Error("Target CSV needs a korean column.");
  const id = column("entity_id") >= 0 ? column("entity_id") : column("id");
  const romanized = column("romanized");
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const word = row[korean]?.trim();
    if (!word || seen.has(word)) return [];
    seen.add(word);
    return [
      {
        entityId: id >= 0 ? (row[id]?.trim() ?? "") : "",
        korean: word,
        romanized: (romanized >= 0 && row[romanized]?.trim()) || romanizeKorean(word),
      },
    ];
  });
}

export function targetsByDomain(
  csvTexts: Partial<Record<string, string>>,
): Record<EntityDomain, TargetWord[]> {
  return Object.fromEntries(
    ENTITY_DOMAINS.map((domain) => {
      const text = csvTexts[domain];
      return [domain, text ? parseTargetCsv(text) : []];
    }),
  ) as Record<EntityDomain, TargetWord[]>;
}

/** A random target, different from `current` whenever the list allows it. */
export function randomTarget(
  words: TargetWord[],
  current?: TargetWord | null,
  random: () => number = Math.random,
): TargetWord | null {
  if (!words.length) return null;
  const pool =
    current && words.length > 1 ? words.filter((word) => word.korean !== current.korean) : words;
  return pool[Math.floor(random() * pool.length)] ?? pool[0];
}

/** Romanizes an ASR transcript, preferring the official romanization of a known entity. */
export function romanizeTranscript(
  transcript: string,
  known: { entity?: string; korean?: string; romanized: string }[],
): string {
  const key = transcript.replace(/\s+/g, "");
  const match = known.find(
    (item) => item.romanized && (item.entity ?? item.korean ?? "").replace(/\s+/g, "") === key,
  );
  return match ? match.romanized : romanizeKorean(transcript);
}

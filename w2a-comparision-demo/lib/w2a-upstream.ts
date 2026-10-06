// Shared by the /api routes that proxy the wake2adapt serving API (w2a-api/server.py).

export function env(name: string) {
  const value = globalThis.process?.env?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
export type RetrievedEntity = {
  rank: number;
  entityId: string;
  entity: string;
  romanized: string;
  score: number;
  distance: number;
  ipa: string;
};
export type UpstreamResult = {
  asr_result?: unknown;
  asr_ipa?: unknown;
  asr_adaptation?: unknown;
  domain?: unknown;
  lexicon_size?: unknown;
  retrieved?: unknown;
  retr_entities?: unknown;
  timing?: unknown;
  detail?: unknown;
};
export function retrievedFrom(value: unknown): RetrievedEntity[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, position) => {
    if (typeof item !== "object" || item === null) return [];
    const hit = item as Record<string, unknown>;
    if (typeof hit.entity !== "string") return [];
    return [
      {
        rank: typeof hit.rank === "number" ? hit.rank : position + 1,
        entityId: typeof hit.entity_id === "string" ? hit.entity_id : "",
        entity: hit.entity,
        romanized: typeof hit.romanized === "string" ? hit.romanized.trim() : "",
        score: typeof hit.score === "number" ? hit.score : 0,
        distance: typeof hit.distance === "number" ? hit.distance : 0,
        ipa: typeof hit.ipa === "string" ? hit.ipa : "",
      },
    ];
  });
}

export function apiBase(): string | undefined {
  return env("W2A_API_URL")?.replace(/\/+$/, "");
}

/** Error text from a FastAPI error body, or a generic message. */
export function upstreamError(result: { detail?: unknown }, status: number) {
  return typeof result.detail === "string" ? result.detail : `Service returned ${status}.`;
}

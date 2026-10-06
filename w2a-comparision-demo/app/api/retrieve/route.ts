import { apiBase, retrievedFrom, upstreamError } from "../../../lib/w2a-upstream.ts";

const DOMAINS = new Set(["roads", "content", "restaurants", "stations"]);

/** Phonetic entity search for an ASR transcript (no GPU): proxies POST /retrieve. */
export async function POST(request: Request) {
  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return Response.json({ error: "Expected form data." }, { status: 400 });
  }
  const text = data.get("text");
  const domain = data.get("domain");
  const topK = Number(data.get("topK") ?? 10);
  if (typeof text !== "string" || !text.trim() || text.length > 200)
    return Response.json({ error: "Provide the transcript text." }, { status: 400 });
  if (typeof domain !== "string" || !DOMAINS.has(domain))
    return Response.json({ error: "Unknown entity domain." }, { status: 400 });
  if (!Number.isInteger(topK) || topK < 1 || topK > 10)
    return Response.json({ error: "topK must be an integer from 1 to 10." }, { status: 400 });
  const base = apiBase();
  if (!base) return Response.json({ error: "W2A_API_URL is not configured." }, { status: 503 });

  const upstream = new FormData();
  upstream.append("text", text.trim());
  upstream.append("domain", domain);
  upstream.append("top_k", String(topK));
  try {
    const response = await fetch(base + "/retrieve", {
      method: "POST",
      body: upstream,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
    });
    const result = (await response.json()) as {
      detail?: unknown;
      retrieved?: unknown;
      text_ipa?: unknown;
      timing?: unknown;
    };
    if (!response.ok) throw new Error(upstreamError(result, response.status));
    return Response.json({
      retrieved: retrievedFrom(result.retrieved),
      textIpa: typeof result.text_ipa === "string" ? result.text_ipa : "",
      timing: typeof result.timing === "object" ? result.timing : null,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not reach the entity search." },
      { status: 502 },
    );
  }
}

import { apiBase, upstreamError } from "../../../../lib/w2a-upstream.ts";

/** Stops a running (or waiting) /transcribe call by the requestId it was sent with. */
export async function POST(request: Request) {
  let requestId: unknown;
  try {
    requestId = (await request.formData()).get("requestId");
  } catch {
    return Response.json({ error: "Expected form data." }, { status: 400 });
  }
  if (typeof requestId !== "string" || !/^[\w-]{1,64}$/.test(requestId))
    return Response.json({ error: "Provide a requestId." }, { status: 400 });
  const base = apiBase();
  if (!base) return Response.json({ status: "not_configured" }, { status: 202 });
  const upstream = new FormData();
  upstream.append("request_id", requestId);
  try {
    const response = await fetch(base + "/cancel", {
      method: "POST",
      body: upstream,
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json()) as { detail?: unknown; was_running?: unknown };
    if (!response.ok) throw new Error(upstreamError(result, response.status));
    return Response.json({ status: "cancelled", wasRunning: result.was_running === true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not reach the ASR service." },
      { status: 502 },
    );
  }
}

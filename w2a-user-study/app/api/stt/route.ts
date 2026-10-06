import { env, retrievedFrom, type UpstreamResult } from "../../../lib/w2a-upstream.ts";
const MAX_BYTES = 10 * 1024 * 1024;
// wake2adapt serving API (w2a-api/server.py). Unset W2A_API_URL keeps the demo standalone.
const UPSTREAM_TIMEOUT_MS = 120_000;
const DOMAINS = new Set(["roads", "content", "restaurants", "stations"]);

type UpstreamOptions = {
  topK?: string;
  /** Lets POST /api/stt/cancel stop this request on the server. */
  requestId?: string;
  /** ASR only; the client then calls /api/retrieve so the two stages show separately. */
  skipRetrieval?: boolean;
  /** Aborted when the browser cancels its request. */
  signal?: AbortSignal;
};
async function transcribeUpstream(
  apiUrl: string,
  audio: File,
  domain: string,
  referenceAudio?: File,
  referenceText?: string,
  options: UpstreamOptions = {},
) {
  const upstream = new FormData();
  upstream.append("audio", audio, audio.name || "recording");
  if (referenceAudio && referenceText) {
    upstream.append("ref_audio", referenceAudio, referenceAudio.name || "reference");
    upstream.append("ref_text", referenceText);
  }
  upstream.append("domain", domain);
  upstream.append("top_k", options.topK ?? env("W2A_TOP_K") ?? "5");
  if (options.requestId) upstream.append("request_id", options.requestId);
  if (options.skipRetrieval) upstream.append("with_retrieval", "false");
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/transcribe`, {
    method: "POST",
    body: upstream,
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  });
  const result = (await response.json()) as UpstreamResult;
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : `Transcription service returned ${response.status}.`,
    );
  if (typeof result.asr_result !== "string")
    throw new Error("Transcription service returned an invalid asr_result.");
  return result;
}
export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    return Response.json({ error: "Expected multipart form data." }, { status: 415 });
  if (Number(request.headers.get("content-length")) > MAX_BYTES)
    return Response.json({ error: "Recording must be smaller than 10 MB." }, { status: 413 });
  // Bound streamed requests too, including those without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Missing recording." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  let audio: File;
  let wordId: string;
  let domain: string;
  let topK: string | undefined;
  let requestId: string | undefined;
  let skipRetrieval = false;
  let referenceAudio: File | undefined;
  let referenceText: string | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return Response.json({ error: "Recording must be smaller than 10 MB." }, { status: 413 });
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const data = await new Response(body, {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
    const uploaded = data.get("audio");
    const word = data.get("word");
    const uploadedId = data.get("wordId");
    const uploadedDomain = data.get("domain");
    if (
      !(uploaded instanceof File) ||
      !uploaded.size ||
      !uploaded.type.startsWith("audio/") ||
      typeof word !== "string" ||
      !word.trim() ||
      word.length > 200 ||
      typeof uploadedId !== "string"
    )
      return Response.json({ error: "Provide an audio file, word, and wordId." }, { status: 400 });
    const domainValue =
      typeof uploadedDomain === "string" && uploadedDomain.trim()
        ? uploadedDomain.trim()
        : (env("W2A_DOMAIN") ?? "roads");
    if (!DOMAINS.has(domainValue))
      return Response.json({ error: "Unknown entity domain." }, { status: 400 });
    const purpose = data.get("purpose") ?? "practice";
    if (purpose !== "greeting" && purpose !== "practice")
      return Response.json({ error: "Unknown recording purpose." }, { status: 400 });
    if (purpose === "greeting") {
      // The greeting is the 1-shot reference; it is replayed with every practice
      // request instead of being enrolled or persisted here.
      return Response.json({ status: "received", purpose, bytes: uploaded.size }, { status: 202 });
    }
    const uploadedReference = data.get("referenceAudio");
    const uploadedReferenceText = data.get("referenceText");
    const referenceFile =
      uploadedReference instanceof File && uploadedReference.size > 0
        ? uploadedReference
        : undefined;
    const referenceValue =
      typeof uploadedReferenceText === "string" && uploadedReferenceText.trim()
        ? uploadedReferenceText.trim()
        : undefined;
    if (
      Boolean(referenceFile) !== Boolean(referenceValue) ||
      (referenceFile && !referenceFile.type.startsWith("audio/")) ||
      (referenceValue && referenceValue.length > 200)
    )
      return Response.json(
        {
          error: "Reference audio and reference text must be provided together.",
        },
        { status: 400 },
      );
    audio = uploaded;
    wordId = uploadedId;
    // Optional: how many entities to retrieve (the demo asks for 10 and slices client-side).
    const uploadedTopK = data.get("topK");
    if (typeof uploadedTopK === "string" && uploadedTopK.trim()) {
      const value = Number(uploadedTopK);
      if (!Number.isInteger(value) || value < 1 || value > 10)
        return Response.json({ error: "topK must be an integer from 1 to 10." }, { status: 400 });
      topK = String(value);
    }
    const uploadedRequestId = data.get("requestId");
    if (typeof uploadedRequestId === "string" && /^[\w-]{1,64}$/.test(uploadedRequestId))
      requestId = uploadedRequestId;
    skipRetrieval = data.get("skipRetrieval") === "1";
    domain = domainValue;
    referenceAudio = referenceFile;
    referenceText = referenceValue;
  } catch {
    return Response.json({ error: "Invalid recording upload." }, { status: 400 });
  }
  const apiUrl = env("W2A_API_URL");
  if (!apiUrl)
    // No serving API configured: accept the upload without inventing a transcript.
    return Response.json(
      {
        status: "received",
        transcript: null,
        wordId,
        bytes: audio.size,
        referenceReceived: Boolean(referenceAudio),
        adaptationStatus: "not_configured",
      },
      { status: 202 },
    );
  try {
    const result = await transcribeUpstream(
      apiUrl,
      audio,
      domain,
      referenceAudio,
      referenceText,
      { topK, requestId, skipRetrieval, signal: request.signal },
    );
    return Response.json({
      status: "ok",
      transcript: typeof result.asr_result === "string" ? result.asr_result : "",
      asrIpa: typeof result.asr_ipa === "string" ? result.asr_ipa : "",
      wordId,
      bytes: audio.size,
      referenceReceived: Boolean(referenceAudio),
      adaptationStatus: result.asr_adaptation === true ? "reference_audio" : "zero_shot",
      domain: typeof result.domain === "string" ? result.domain : "",
      lexiconSize: typeof result.lexicon_size === "number" ? result.lexicon_size : 0,
      retrieved: retrievedFrom(result.retrieved),
      timing: typeof result.timing === "object" ? result.timing : null,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.message
            ? error.message
            : "Could not reach the transcription service.",
      },
      { status: 502 },
    );
  }
}

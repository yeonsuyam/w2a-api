const MAX_BYTES = 10 * 1024 * 1024;
// wake2adapt serving API (w2a-api/server.py). Unset W2A_API_URL keeps the demo standalone.
const UPSTREAM_TIMEOUT_MS = 120_000;
function env(name: string) {
  const value = globalThis.process?.env?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
type RetrievedEntity = {
  rank: number;
  entity: string;
  score: number;
  distance: number;
  ipa: string;
};
type UpstreamResult = {
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
function retrievedFrom(value: unknown): RetrievedEntity[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, position) => {
    if (typeof item !== 'object' || item === null) return [];
    const hit = item as Record<string, unknown>;
    if (typeof hit.entity !== 'string') return [];
    return [
      {
        rank: typeof hit.rank === 'number' ? hit.rank : position + 1,
        entity: hit.entity,
        score: typeof hit.score === 'number' ? hit.score : 0,
        distance: typeof hit.distance === 'number' ? hit.distance : 0,
        ipa: typeof hit.ipa === 'string' ? hit.ipa : '',
      },
    ];
  });
}
async function transcribeUpstream(
  apiUrl: string,
  audio: File,
  referenceAudio?: File,
  referenceText?: string,
) {
  const upstream = new FormData();
  upstream.append('audio', audio, audio.name || 'recording');
  if (referenceAudio && referenceText) {
    upstream.append(
      'ref_audio',
      referenceAudio,
      referenceAudio.name || 'reference',
    );
    upstream.append('ref_text', referenceText);
  }
  upstream.append('domain', env('W2A_DOMAIN') ?? 'roads');
  upstream.append('top_k', env('W2A_TOP_K') ?? '5');
  const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/transcribe`, {
    method: 'POST',
    body: upstream,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const result = (await response.json()) as UpstreamResult;
  if (!response.ok)
    throw new Error(
      typeof result.detail === 'string'
        ? result.detail
        : `Transcription service returned ${response.status}.`,
    );
  if (typeof result.asr_result !== 'string')
    throw new Error('Transcription service returned an invalid asr_result.');
  return result;
}
export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data'))
    return Response.json(
      { error: 'Expected multipart form data.' },
      { status: 415 },
    );
  if (Number(request.headers.get('content-length')) > MAX_BYTES)
    return Response.json(
      { error: 'Recording must be smaller than 10 MB.' },
      { status: 413 },
    );
  // Bound streamed requests too, including those without Content-Length.
  const reader = request.body?.getReader();
  if (!reader)
    return Response.json({ error: 'Missing recording.' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  let audio: File;
  let wordId: string;
  let referenceAudio: File | undefined;
  let referenceText: string | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return Response.json(
          { error: 'Recording must be smaller than 10 MB.' },
          { status: 413 },
        );
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
      headers: { 'Content-Type': request.headers.get('content-type')! },
    }).formData();
    const uploaded = data.get('audio');
    const word = data.get('word');
    const uploadedId = data.get('wordId');
    if (
      !(uploaded instanceof File) ||
      !uploaded.size ||
      !uploaded.type.startsWith('audio/') ||
      typeof word !== 'string' ||
      !word.trim() ||
      word.length > 200 ||
      typeof uploadedId !== 'string'
    )
      return Response.json(
        { error: 'Provide an audio file, word, and wordId.' },
        { status: 400 },
      );
    const purpose = data.get('purpose') ?? 'practice';
    if (purpose !== 'greeting' && purpose !== 'practice')
      return Response.json(
        { error: 'Unknown recording purpose.' },
        { status: 400 },
      );
    if (purpose === 'greeting') {
      // The greeting is the 1-shot reference; it is replayed with every practice
      // request instead of being enrolled or persisted here.
      return Response.json(
        { status: 'received', purpose, bytes: uploaded.size },
        { status: 202 },
      );
    }
    const uploadedReference = data.get('referenceAudio');
    const uploadedReferenceText = data.get('referenceText');
    const referenceFile =
      uploadedReference instanceof File && uploadedReference.size > 0
        ? uploadedReference
        : undefined;
    const referenceValue =
      typeof uploadedReferenceText === 'string' && uploadedReferenceText.trim()
        ? uploadedReferenceText.trim()
        : undefined;
    if (
      Boolean(referenceFile) !== Boolean(referenceValue) ||
      (referenceFile && !referenceFile.type.startsWith('audio/')) ||
      (referenceValue && referenceValue.length > 200)
    )
      return Response.json(
        {
          error:
            'Reference audio and reference text must be provided together.',
        },
        { status: 400 },
      );
    audio = uploaded;
    wordId = uploadedId;
    referenceAudio = referenceFile;
    referenceText = referenceValue;
  } catch {
    return Response.json(
      { error: 'Invalid recording upload.' },
      { status: 400 },
    );
  }
  const apiUrl = env('W2A_API_URL');
  if (!apiUrl)
    // No serving API configured: accept the upload without inventing a transcript.
    return Response.json(
      {
        status: 'received',
        transcript: null,
        wordId,
        bytes: audio.size,
        referenceReceived: Boolean(referenceAudio),
        adaptationStatus: 'not_configured',
      },
      { status: 202 },
    );
  try {
    const result = await transcribeUpstream(
      apiUrl,
      audio,
      referenceAudio,
      referenceText,
    );
    return Response.json({
      status: 'ok',
      transcript:
        typeof result.asr_result === 'string' ? result.asr_result : '',
      asrIpa: typeof result.asr_ipa === 'string' ? result.asr_ipa : '',
      wordId,
      bytes: audio.size,
      referenceReceived: Boolean(referenceAudio),
      adaptationStatus:
        result.asr_adaptation === true ? 'reference_audio' : 'zero_shot',
      domain: typeof result.domain === 'string' ? result.domain : '',
      lexiconSize:
        typeof result.lexicon_size === 'number' ? result.lexicon_size : 0,
      retrieved: retrievedFrom(result.retrieved),
      timing: typeof result.timing === 'object' ? result.timing : null,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.message
            ? error.message
            : 'Could not reach the transcription service.',
      },
      { status: 502 },
    );
  }
}

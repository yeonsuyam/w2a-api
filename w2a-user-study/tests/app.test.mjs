import test from "node:test";
import assert from "node:assert/strict";
import { parseWords } from "../lib/words.ts";
import { POST } from "../app/api/stt/route.ts";
test("imports JSON strings and CSV with BOM and escaped fields", () => {
  assert.equal(parseWords('["하늘"]', "words.json")[0].korean, "하늘");
  assert.deepEqual(
    parseWords('\uFEFFid,korean,meaning\r\n1,안녕,"Hello, ""friend"""', "words.csv")[0],
    { id: "1", korean: "안녕", meaning: 'Hello, "friend"' },
  );
  assert.throws(() => parseWords("[]", "words.json"));
  assert.throws(() => parseWords("meaning\nhello", "words.csv"));
});
test("accepts audio and leaves transcription empty", async () => {
  const data = new FormData();
  data.append("audio", new Blob(["sample"], { type: "audio/webm" }), "recording.webm");
  data.append("word", "안녕");
  data.append("wordId", "1");
  data.append("purpose", "practice");
  data.append("referenceAudio", new Blob(["greeting"], { type: "audio/webm" }), "greeting.webm");
  data.append("referenceText", "Hello");
  const response = await POST(
    new Request("http://localhost/api/stt", { method: "POST", body: data }),
  );
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    status: "received",
    transcript: null,
    wordId: "1",
    bytes: 6,
    referenceReceived: true,
    adaptationStatus: "not_configured",
  });
});
test("accepts zero-shot practice without a reference", async () => {
  const data = new FormData();
  data.append("audio", new Blob(["sample"], { type: "audio/webm" }), "recording.webm");
  data.append("word", "가로수길");
  data.append("wordId", "zero");
  data.append("purpose", "practice");
  const response = await POST(
    new Request("http://localhost/api/stt", { method: "POST", body: data }),
  );
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    status: "received",
    transcript: null,
    wordId: "zero",
    bytes: 6,
    referenceReceived: false,
    adaptationStatus: "not_configured",
  });
});
test("rejects missing audio, incorrect media, and oversized uploads", async () => {
  assert.equal(
    (await POST(new Request("http://localhost/api/stt", { method: "POST", body: "{}" }))).status,
    415,
  );
  const data = new FormData();
  data.append("word", "안녕");
  assert.equal(
    (await POST(new Request("http://localhost/api/stt", { method: "POST", body: data }))).status,
    400,
  );
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/stt", {
          method: "POST",
          headers: {
            "content-type": "multipart/form-data",
            "content-length": String(11 * 1024 * 1024),
          },
          body: "test",
        }),
      )
    ).status,
    413,
  );
});

test("accepts greeting enrollment without claiming adaptation", async () => {
  const data = new FormData();
  data.append("audio", new Blob(["hello"], { type: "audio/mp4" }), "greeting.mp4");
  data.append("word", "Hello");
  data.append("wordId", "greeting");
  data.append("purpose", "greeting");
  const response = await POST(
    new Request("http://localhost/api/stt", { method: "POST", body: data }),
  );
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    status: "received",
    purpose: "greeting",
    bytes: 5,
  });
});
test("rejects incomplete or invalid optional references", async () => {
  for (const entry of [
    { reference: undefined, text: "안녕" },
    { reference: new Blob([], { type: "audio/webm" }), text: "안녕" },
    { reference: new Blob(["bad"], { type: "text/plain" }), text: "안녕" },
    {
      reference: new Blob(["greeting"], { type: "audio/webm" }),
      text: undefined,
    },
  ]) {
    const data = new FormData();
    data.append("audio", new Blob(["word"], { type: "audio/webm" }), "word.webm");
    data.append("word", "하늘");
    data.append("wordId", "1");
    data.append("purpose", "practice");
    if (entry.reference) data.append("referenceAudio", entry.reference, "greeting.webm");
    if (entry.text) data.append("referenceText", entry.text);
    const response = await POST(
      new Request("http://localhost/api/stt", { method: "POST", body: data }),
    );
    assert.equal(response.status, 400);
  }
});

function practiceRequest(domain = "roads") {
  const data = new FormData();
  data.append("audio", new Blob(["sample"], { type: "audio/webm" }), "recording.webm");
  data.append("word", "상곡안길");
  data.append("wordId", "1");
  data.append("domain", domain);
  data.append("purpose", "practice");
  data.append("referenceAudio", new Blob(["greeting"], { type: "audio/webm" }), "greeting.webm");
  data.append("referenceText", "안녕");
  return new Request("http://localhost/api/stt", {
    method: "POST",
    body: data,
  });
}
function zeroShotRequest(domain = "roads") {
  const data = new FormData();
  data.append("audio", new Blob(["sample"], { type: "audio/webm" }), "recording.webm");
  data.append("word", "가로수길");
  data.append("wordId", "zero");
  data.append("domain", domain);
  data.append("purpose", "practice");
  return new Request("http://localhost/api/stt", {
    method: "POST",
    body: data,
  });
}
async function withStubbedApi(fetchStub, run) {
  const originalFetch = globalThis.fetch;
  process.env.W2A_API_URL = "http://api.test/";
  globalThis.fetch = fetchStub;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.W2A_API_URL;
  }
}
test("forwards practice uploads to the wake2adapt serving API", async () => {
  const calls = [];
  const result = await withStubbedApi(
    (url, init) => {
      calls.push({ url, body: init.body });
      return Promise.resolve(
        Response.json({
          asr_result: "상국안길",
          asr_ipa: "saŋkukankil",
          asr_adaptation: true,
          domain: "roads",
          lexicon_size: 36927,
          retrieved: [
            {
              rank: 1,
              entity_id: "RD16245",
              entity: "상곡안길",
              romanized: "sang-gog-an-gil",
              score: 0.91,
              distance: 1,
              ipa: "saŋkokankil",
            },
          ],
          retr_entities: ["상곡안길"],
          timing: { total_s: 1.2 },
        }),
      );
    },
    async () => {
      const response = await POST(practiceRequest());
      assert.equal(response.status, 200);
      return response.json();
    },
  );
  assert.equal(calls[0].url, "http://api.test/transcribe");
  assert.equal(calls[0].body.get("ref_text"), "안녕");
  assert.equal(calls[0].body.get("domain"), "roads");
  assert.equal(calls[0].body.get("top_k"), "5");
  assert.ok(calls[0].body.get("audio") instanceof Blob);
  assert.ok(calls[0].body.get("ref_audio") instanceof Blob);
  assert.equal(result.transcript, "상국안길");
  assert.equal(result.asrIpa, "saŋkukankil");
  assert.equal(result.adaptationStatus, "reference_audio");
  assert.equal(result.lexiconSize, 36927);
  assert.deepEqual(result.retrieved, [
    {
      rank: 1,
      entityId: "RD16245",
      entity: "상곡안길",
      romanized: "sang-gog-an-gil",
      score: 0.91,
      distance: 1,
      ipa: "saŋkokankil",
    },
  ]);
});
test("forwards zero-shot uploads without reference fields", async () => {
  const calls = [];
  const result = await withStubbedApi(
    (url, init) => {
      calls.push({ url, body: init.body });
      return Promise.resolve(
        Response.json({
          asr_result: "가로수길",
          asr_ipa: "karosukil",
          asr_adaptation: false,
          domain: "roads",
          lexicon_size: 36927,
          retrieved: [],
          timing: { total_s: 0.8 },
        }),
      );
    },
    async () => {
      const response = await POST(zeroShotRequest());
      assert.equal(response.status, 200);
      return response.json();
    },
  );
  assert.equal(calls[0].url, "http://api.test/transcribe");
  assert.equal(calls[0].body.get("ref_text"), null);
  assert.equal(calls[0].body.get("ref_audio"), null);
  assert.equal(calls[0].body.get("top_k"), "5");
  assert.equal(result.referenceReceived, false);
  assert.equal(result.adaptationStatus, "zero_shot");
});
test("reports an unreachable transcription service", async () => {
  const response = await withStubbedApi(
    () => Promise.reject(new Error("fetch failed")),
    () => POST(practiceRequest()),
  );
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "fetch failed");
});

test("forwards the selected entity domain and rejects unknown domains", async () => {
  const calls = [];
  await withStubbedApi(
    (url, init) => {
      calls.push({ url, body: init.body });
      return Promise.resolve(
        Response.json({
          asr_result: "가로수길",
          asr_ipa: "karosukil",
          asr_adaptation: false,
          domain: "stations",
          lexicon_size: 678,
          retrieved: [],
          timing: { total_s: 0.8 },
        }),
      );
    },
    () => POST(zeroShotRequest("stations")),
  );
  assert.equal(calls[0].body.get("domain"), "stations");

  const response = await POST(zeroShotRequest("unknown"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Unknown entity domain.");
});

test("rejects successful ASR responses with a missing transcript instead of showing no speech", async () => {
  const response = await withStubbedApi(
    () => Promise.resolve(Response.json({ renamed_transcript: "안녕" })),
    () => POST(practiceRequest()),
  );
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /invalid asr_result/);
});

test("reports upstream HTTP errors to the practice UI", async () => {
  const response = await withStubbedApi(
    () => Promise.resolve(Response.json({ detail: "Could not decode audio" }, { status: 400 })),
    () => POST(practiceRequest()),
  );
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "Could not decode audio");
});
test("forwards a requested topK and rejects out-of-range values", async () => {
  const calls = [];
  const request = (topK) => {
    const data = new FormData();
    data.append("audio", new Blob(["sample"], { type: "audio/webm" }), "recording.webm");
    data.append("word", "가로수길");
    data.append("wordId", "zero");
    data.append("domain", "roads");
    data.append("purpose", "practice");
    data.append("topK", topK);
    return new Request("http://localhost/api/stt", { method: "POST", body: data });
  };
  await withStubbedApi(
    (url, init) => {
      calls.push({ url, body: init.body });
      return Promise.resolve(Response.json({ asr_result: "가로수길", asr_adaptation: false }));
    },
    async () => {
      assert.equal((await POST(request("10"))).status, 200);
      assert.equal((await POST(request("11"))).status, 400);
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.get("top_k"), "10");
});
test("forwards requestId and ASR-only mode to /transcribe", async () => {
  const calls = [];
  const data = new FormData();
  data.append("audio", new Blob(["sample"], { type: "audio/webm" }), "recording.webm");
  data.append("word", "가로수길");
  data.append("wordId", "zero");
  data.append("domain", "roads");
  data.append("purpose", "practice");
  data.append("requestId", "abc-123");
  data.append("skipRetrieval", "1");
  await withStubbedApi(
    (url, init) => {
      calls.push({ url, body: init.body });
      return Promise.resolve(Response.json({ asr_result: "가로수길", asr_adaptation: false }));
    },
    async () => {
      const response = await POST(new Request("http://localhost/api/stt", { method: "POST", body: data }));
      assert.equal(response.status, 200);
    },
  );
  assert.equal(calls[0].body.get("request_id"), "abc-123");
  assert.equal(calls[0].body.get("with_retrieval"), "false");
});

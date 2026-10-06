import test from "node:test";
import assert from "node:assert/strict";
import { POST as cancel } from "../app/api/stt/cancel/route.ts";
import { POST as retrieve } from "../app/api/retrieve/route.ts";

async function withApi(stub, run) {
  const original = globalThis.fetch;
  process.env.W2A_API_URL = "http://api.test";
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
    delete process.env.W2A_API_URL;
  }
}
const form = (entries) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return new Request("http://localhost/x", { method: "POST", body: data });
};

test("cancel forwards the request id to /cancel", async () => {
  const calls = [];
  const response = await withApi(
    (url, init) => {
      calls.push({ url, body: init.body });
      return Promise.resolve(Response.json({ request_id: "r1", was_running: true }));
    },
    () => cancel(form({ requestId: "r1" })),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "cancelled", wasRunning: true });
  assert.equal(calls[0].url, "http://api.test/cancel");
  assert.equal(calls[0].body.get("request_id"), "r1");
  assert.equal((await cancel(form({ requestId: "bad id!" }))).status, 400);
});

test("retrieve proxies /retrieve and maps hits", async () => {
  const calls = [];
  const response = await withApi(
    (url, init) => {
      calls.push({ url, body: init.body });
      return Promise.resolve(
        Response.json({
          retrieved: [{ rank: 1, entity_id: "RD3", entity: "가로수길", romanized: "garosu-gil", score: 1, distance: 0, ipa: "x" }],
          timing: { retrieval_s: 0.5 },
        }),
      );
    },
    () => retrieve(form({ text: "가로수길", domain: "roads", topK: "10" })),
  );
  const body = await response.json();
  assert.equal(calls[0].url, "http://api.test/retrieve");
  assert.equal(calls[0].body.get("top_k"), "10");
  assert.equal(body.retrieved[0].entityId, "RD3");
  assert.equal(body.timing.retrieval_s, 0.5);
  assert.equal((await retrieve(form({ text: "x", domain: "nope" }))).status, 400);
});

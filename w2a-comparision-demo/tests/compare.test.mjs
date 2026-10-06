import test from "node:test";
import assert from "node:assert/strict";
import { diffTranscript, isExactMatch, rankDelta } from "../lib/compare.ts";

test("marks transcript characters that differ from the target", () => {
  assert.deepEqual(diffTranscript("가로수글", "가로수길"), [
    { text: "가로수", ok: true },
    { text: "글", ok: false },
  ]);
  assert.deepEqual(diffTranscript("가로 수길", "가로수길"), [{ text: "가로 수길", ok: true }]);
  assert.deepEqual(diffTranscript("", "가로수길"), []);
  assert.ok(isExactMatch("가로 수길", "가로수길"));
  assert.ok(!isExactMatch("가로수", "가로수길"));
});

test("describes rank changes against the zero-shot baseline", () => {
  assert.deepEqual(rankDelta(7, 1), { kind: "up", label: "Up 6" });
  assert.deepEqual(rankDelta(1, 3), { kind: "down", label: "Down 2" });
  assert.deepEqual(rankDelta(2, 2), { kind: "same", label: "Same rank" });
  assert.equal(rankDelta(null, 4).kind, "up");
  assert.equal(rankDelta(3, null).kind, "down");
  assert.equal(rankDelta(null, null).kind, "same");
  assert.equal(rankDelta(null, 2, 3).label, "Into Top 3");
});

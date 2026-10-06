import test from "node:test";
import assert from "node:assert/strict";
import { romanizeKorean } from "../lib/romanize.ts";
import {
  parseTargetCsv,
  randomTarget,
  romanizeTranscript,
  targetsByDomain,
} from "../lib/targets.ts";

test("romanizes Korean with Revised Romanization sound changes", () => {
  const cases = {
    가로수길: "garosugil",
    종로: "jongno",
    신라: "silla",
    같이: "gachi",
    왕십리: "wangsimni",
    설날: "seollal",
    독립: "dongnip",
    좋아: "joa",
    읽어: "ilgeo",
    묵호: "mukho",
    "안녕 안드로이드": "annyeong andeuroideu",
    "Hello 서울!": "Hello seoul!",
  };
  for (const [korean, expected] of Object.entries(cases))
    assert.equal(romanizeKorean(korean), expected, korean);
});

test("parses L2-KPNS _200.csv target words", () => {
  const words = parseTargetCsv(
    "﻿entity_id,korean,romanized,phonemes\nRD00003,가로수길,garosu-gil,x\nRD1,칠성천길,,y\nRD2,가로수길,dup,z\n",
  );
  assert.deepEqual(words, [
    { entityId: "RD00003", korean: "가로수길", romanized: "garosu-gil" },
    { entityId: "RD1", korean: "칠성천길", romanized: "chilseongcheongil" },
  ]);
  assert.deepEqual(targetsByDomain({}).roads, []);
  assert.throws(() => parseTargetCsv("romanized\nx"));
});

test("random target avoids the current word", () => {
  const words = parseTargetCsv("korean\n가\n나\n다");
  for (let i = 0; i < 20; i++)
    assert.notEqual(randomTarget(words, words[1])?.korean, "나");
  assert.equal(randomTarget([], null), null);
  assert.equal(randomTarget(words.slice(0, 1), words[0])?.korean, "가");
});

test("prefers the official romanization when the transcript is a known entity", () => {
  const known = [{ entity: "가로수길", romanized: "garosu-gil" }];
  assert.equal(romanizeTranscript("가로수 길", known), "garosu-gil");
  assert.equal(romanizeTranscript("가로수로", known), "garosuro");
});

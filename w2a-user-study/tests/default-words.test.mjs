import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseWords } from '../lib/words.ts';

test('loads the default roads JSONL as ordered practice words without audio', async () => {
  const raw = await readFile(
    new URL('../data/roads_P001.jsonl', import.meta.url),
    'utf8',
  );
  const rows = raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const words = parseWords(raw, 'roads_P001.jsonl');
  assert.equal(words.length, 200);
  assert.deepEqual(
    words.map((word) => word.korean),
    rows.map((row) => row.text),
  );
  assert.equal(new Set(words.map((word) => word.id)).size, words.length);
});

test('supports BOM, blank lines and CRLF in JSONL and rejects invalid entries', () => {
  assert.equal(
    parseWords(
      '\uFEFF\r\n{"text":"안녕","audioBase64":""}\r\n',
      'words.jsonl',
    )[0].korean,
    '안녕',
  );
  for (const raw of ['', '{}', '{"text":""}', '{bad json}']) {
    assert.throws(() => parseWords(raw, 'words.jsonl'));
  }
});

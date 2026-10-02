import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audioBlobFromFile,
  audioFilename,
  parseRecordingJson,
} from '../lib/recording.ts';
import { POST } from '../app/api/stt/route.ts';

const sample = {
  mimeType: 'audio/wav',
  audioBase64: btoa('audio bytes'),
  text: '안녕',
};
test('decodes reference and practice JSON and sends them through the upload API', async () => {
  const reference = parseRecordingJson(JSON.stringify(sample), 'greeting');
  const recording = parseRecordingJson(
    JSON.stringify({ ...sample, text: undefined }),
    'practice',
  );
  assert.equal(reference.text, '안녕');
  assert.equal(await reference.audio.text(), 'audio bytes');
  for (const purpose of ['greeting', 'practice']) {
    const data = new FormData();
    data.append('audio', recording.audio, 'recording.wav');
    data.append('purpose', purpose);
    data.append('word', '안녕');
    data.append('wordId', '1');
    if (purpose === 'practice') {
      data.append('referenceAudio', reference.audio, 'reference.wav');
      data.append('referenceText', reference.text);
    }
    const response = await POST(
      new Request('http://localhost/api/stt', { method: 'POST', body: data }),
    );
    assert.equal(response.status, 202);
  }
});
test('rejects malformed JSON, unsupported types, invalid Base64, and missing reference text', () => {
  for (const raw of [
    '{',
    '[]',
    'null',
    JSON.stringify({ ...sample, mimeType: 'text/plain' }),
    ...['', '###', 'data:audio/wav;base64,YQ==', 'Y Q==', 'YQ='].map(
      (audioBase64) => JSON.stringify({ ...sample, audioBase64 }),
    ),
    JSON.stringify({ ...sample, text: '' }),
    JSON.stringify({ ...sample, text: 'a'.repeat(201) }),
  ]) {
    assert.throws(() => parseRecordingJson(raw, 'greeting'));
  }
});

test('accepts large Base64 input up to the limit and rejects oversized audio', () => {
  const audioBase64 = Buffer.alloc(9 * 1024 * 1024).toString('base64');
  assert.equal(
    parseRecordingJson(JSON.stringify({ ...sample, audioBase64 }), 'practice')
      .audio.size,
    9 * 1024 * 1024,
  );
  assert.throws(() =>
    parseRecordingJson(
      JSON.stringify({ ...sample, audioBase64: audioBase64 + 'AAAA' }),
      'practice',
    ),
  );
});

test('accepts audio files by MIME type or extension and enforces the size budget', () => {
  const wav = new File([new Uint8Array(1024)], 'greeting.wav', {
    type: 'audio/wav',
  });
  assert.equal(audioBlobFromFile(wav).type, 'audio/wav');
  // Some browsers hand over .m4a with an empty type; fall back to the extension.
  const m4a = new File([new Uint8Array(512)], '안성로.m4a', { type: '' });
  assert.equal(audioBlobFromFile(m4a).type, 'audio/mp4');
  assert.equal(audioBlobFromFile(m4a).size, 512);
  assert.throws(
    () =>
      audioBlobFromFile(
        new File([new Uint8Array(8)], 'notes.txt', { type: 'text/plain' }),
      ),
    /음성 파일/,
  );
  assert.throws(
    () => audioBlobFromFile(new File([], 'empty.wav', { type: 'audio/wav' })),
    /빈 음성 파일/,
  );
  const big = new File([new Uint8Array(5 * 1024 * 1024)], 'long.wav', {
    type: 'audio/wav',
  });
  assert.doesNotThrow(() => audioBlobFromFile(big));
  assert.throws(() => audioBlobFromFile(big, 5 * 1024 * 1024), /9 MiB/);
});
test('names uploaded blobs with a matching extension', () => {
  assert.equal(
    audioFilename(new Blob([], { type: 'audio/flac' }), 'reference'),
    'reference.flac',
  );
  assert.equal(
    audioFilename(new Blob([], { type: 'audio/wav' }), 'recording'),
    'recording.wav',
  );
});

export const MAX_RECORDING_JSON_BYTES = 14 * 1024 * 1024;
const MAX_AUDIO_BYTES = 9 * 1024 * 1024;
const MIME_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/mpeg',
];

const AUDIO_EXTENSIONS: Record<string, string> = {
  webm: 'audio/webm',
  mp4: 'audio/mp4',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
};

/** Validate a picked audio file and label it with a MIME type the upload API accepts.
 * `otherBytes` is the audio already attached to the same request (the reference). */
export function audioBlobFromFile(file: File, otherBytes = 0) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = file.type.startsWith('audio/')
    ? file.type
    : AUDIO_EXTENSIONS[extension];
  if (!type)
    throw new Error(
      '음성 파일(wav, m4a, mp3, webm, ogg, flac)만 업로드할 수 있습니다.',
    );
  if (!file.size) throw new Error('빈 음성 파일입니다.');
  if (file.size + otherBytes > MAX_AUDIO_BYTES)
    throw new Error(
      'Reference와 현재 녹음의 음성 데이터 합계는 9 MiB 이하여야 합니다.',
    );
  return new Blob([file], { type });
}

export function parseRecordingJson(
  raw: string,
  purpose: 'greeting' | 'practice',
) {
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('올바른 JSON 파일이 아닙니다.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(
      'JSON은 audioBase64, mimeType 필드를 가진 객체여야 합니다.',
    );
  const data = value as Record<string, unknown>;
  if (typeof data.mimeType !== 'string' || !MIME_TYPES.includes(data.mimeType))
    throw new Error(
      'mimeType은 audio/webm, audio/mp4, audio/ogg, audio/wav, audio/mpeg 중 하나여야 합니다.',
    );
  if (
    purpose === 'greeting' &&
    (typeof data.text !== 'string' ||
      !data.text.trim() ||
      data.text.length > 200)
  )
    throw new Error(
      'Reference의 text에 실제 발화 문장을 1~200자로 입력하세요.',
    );
  if (
    typeof data.audioBase64 !== 'string' ||
    !data.audioBase64.length ||
    data.audioBase64.length > 4 * Math.ceil(MAX_AUDIO_BYTES / 3) ||
    data.audioBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data.audioBase64)
  )
    throw new Error(
      'audioBase64에는 최대 9 MiB 음성 파일의 Base64 문자열을 넣으세요. data: 접두사와 공백은 제외하세요.',
    );
  const decoded = atob(data.audioBase64);
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  return {
    audio: new Blob([bytes], { type: data.mimeType }),
    text: purpose === 'greeting' ? (data.text as string).trim() : undefined,
  };
}

export function audioFilename(blob: Blob, name: string) {
  const extension = blob.type.includes('flac')
    ? 'flac'
    : blob.type.includes('mp4')
      ? 'mp4'
      : blob.type.includes('ogg')
        ? 'ogg'
        : blob.type.includes('wav')
          ? 'wav'
          : blob.type.includes('mpeg')
            ? 'mp3'
            : 'webm';
  return `${name}.${extension}`;
}

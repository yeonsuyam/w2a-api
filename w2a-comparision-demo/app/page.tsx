'use client';
/* oxlint-disable react/react-compiler -- MediaRecorder callbacks intentionally coordinate mutable browser resources. */

import { useEffect, useRef, useState } from 'react';
import { AudioLines, Check, CircleAlert, Mic, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { audioFilename } from '@/lib/recording';

const TARGET_WORD = '가로수길';
const MAX_SECONDS = 60;

type PanelId = 'zero' | 'english' | 'korean';
type RowKind = 'reference' | 'target';
type Phase =
  | 'idle'
  | 'permission'
  | 'recording'
  | 'sending'
  | 'success'
  | 'error';

type RetrievedEntity = {
  rank: number;
  entity: string;
  score: number;
  distance: number;
  ipa: string;
};

type RecordingState = {
  phase: Phase;
  message: string;
  seconds: number;
  blob: Blob | null;
  audioUrl: string;
};

type ComparisonResult = {
  transcript: string;
  asrIpa: string;
  adaptationStatus: string;
  retrieved: RetrievedEntity[];
  timing: Record<string, number> | null;
};

type PanelState = {
  reference: RecordingState;
  target: RecordingState;
  result: ComparisonResult | null;
};

type PanelConfig = {
  id: PanelId;
  number: string;
  title: string;
  mode: string;
  description: string;
  referenceText: string | null;
  tone: string;
};

const PANELS: PanelConfig[] = [
  {
    id: 'zero',
    number: '01',
    title: 'No reference',
    mode: 'Zero-shot',
    description: '목표 발화만으로 인식합니다.',
    referenceText: null,
    tone: 'blue',
  },
  {
    id: 'english',
    number: '02',
    title: 'English reference',
    mode: '1-shot adaptation',
    description: '영어 문장을 음성 reference로 사용합니다.',
    referenceText: 'Hello Android',
    tone: 'violet',
  },
  {
    id: 'korean',
    number: '03',
    title: 'Korean reference',
    mode: '1-shot adaptation',
    description: '한국어 문장을 음성 reference로 사용합니다.',
    referenceText: '안녕 안드로이드',
    tone: 'teal',
  },
];

function emptyRecording(message: string): RecordingState {
  return {
    phase: 'idle',
    message,
    seconds: 0,
    blob: null,
    audioUrl: '',
  };
}

function initialPanels(): Record<PanelId, PanelState> {
  return {
    zero: {
      reference: emptyRecording('Reference를 사용하지 않습니다.'),
      target: emptyRecording('버튼을 누른 채로 목표 단어를 말하세요.'),
      result: null,
    },
    english: {
      reference: emptyRecording('먼저 reference 문장을 녹음하세요.'),
      target: emptyRecording('Reference 녹음 후 활성화됩니다.'),
      result: null,
    },
    korean: {
      reference: emptyRecording('먼저 reference 문장을 녹음하세요.'),
      target: emptyRecording('Reference 녹음 후 활성화됩니다.'),
      result: null,
    },
  };
}

function formatSeconds(seconds: number) {
  return seconds.toFixed(1) + 's';
}

function RecordingRow({
  kind,
  text,
  state,
  disabled,
  active,
  onStart,
  onStop,
}: {
  kind: RowKind;
  text: string;
  state: RecordingState;
  disabled: boolean;
  active: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const isRecording = state.phase === 'recording';
  const isReference = kind === 'reference';
  const label = isReference ? 'Reference phrase' : 'Target word';
  const recordLabel = isRecording
    ? 'Release to finish'
    : state.phase === 'permission'
      ? 'Waiting for microphone'
      : state.phase === 'sending'
        ? 'Analyzing'
        : state.blob
          ? 'Hold to record again'
          : 'Hold to record';

  return (
    <section
      className={
        'recording-row ' +
        (isRecording ? 'is-recording ' : '') +
        (isReference ? 'is-reference' : 'is-target')
      }
    >
      <div className="row-heading">
        <span>{label}</span>
        {state.blob && state.phase !== 'error' && (
          <span className="ready-mark">
            <Check size={14} />
            Recorded
          </span>
        )}
      </div>
      <p className="phrase" lang={text === 'Hello Android' ? 'en' : 'ko'}>
        {text}
      </p>
      <Button
        data-record
        className="record-button"
        aria-label={recordLabel + ': ' + text}
        aria-pressed={isRecording}
        disabled={disabled || state.phase === 'sending'}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          onStart();
        }}
        onPointerUp={onStop}
        onPointerCancel={onStop}
        onLostPointerCapture={onStop}
        onContextMenu={(event) => event.preventDefault()}
      >
        <Mic size={18} />
        {recordLabel}
        {isRecording && (
          <span className="record-time">{formatSeconds(state.seconds)}</span>
        )}
      </Button>
      <div
        className={
          'row-status ' +
          (state.phase === 'error' ? 'has-error' : '') +
          (active ? ' is-active' : '')
        }
        aria-live="polite"
      >
        {state.phase === 'error' ? (
          <CircleAlert size={15} />
        ) : state.phase === 'success' ? (
          <Check size={15} />
        ) : (
          <span className="status-line" />
        )}
        <span>{state.message}</span>
      </div>
      {state.audioUrl && (
        /* oxlint-disable-next-line jsx-a11y/media-has-caption -- User-recorded speech has no transcript track at capture time. */
        <audio
          className="playback"
          controls
          src={state.audioUrl}
          aria-label={label + ' recording playback'}
        />
      )}
    </section>
  );
}

function ResultBlock({ result }: { result: ComparisonResult }) {
  const targetHit = result.retrieved.find(
    (item) => item.entity === TARGET_WORD,
  );

  return (
    <section className="result-block" aria-live="polite">
      <div className="result-heading">
        <div>
          <span className="eyebrow">ASR result</span>
          <p className="transcript" lang="ko">
            {result.transcript || 'No speech detected'}
          </p>
          {result.asrIpa && <p className="asr-ipa">{result.asrIpa}</p>}
        </div>
        <div className="target-rank">
          <span>Target rank</span>
          <strong>{targetHit ? '#' + targetHit.rank : '—'}</strong>
        </div>
      </div>

      <div className="top-five-heading">
        <h3>Entity search · Top 5</h3>
        {result.timing?.total_s !== undefined && (
          <span>{result.timing.total_s.toFixed(2)}s</span>
        )}
      </div>

      {result.retrieved.length ? (
        <ol className="entity-list">
          {result.retrieved.slice(0, 5).map((hit) => (
            <li
              key={String(hit.rank) + '-' + hit.entity}
              className={hit.entity === TARGET_WORD ? 'is-match' : ''}
            >
              <span className="rank">{hit.rank}</span>
              <span className="entity">
                <strong lang="ko">{hit.entity}</strong>
                <small>{hit.ipa}</small>
              </span>
              <span className="score">
                <strong>{hit.score.toFixed(2)}</strong>
                <small>dist {hit.distance}</small>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="no-results">검색 결과가 없습니다.</p>
      )}
    </section>
  );
}

export default function Home() {
  const [panels, setPanels] =
    useState<Record<PanelId, PanelState>>(initialPanels);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const panelsRef = useRef(panels);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const activeRef = useRef<{
    key: string;
    panelId: PanelId;
    kind: RowKind;
  } | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const objectUrlsRef = useRef(new Set<string>());
  const visibleStateRef = useRef<object>({});

  panelsRef.current = panels;
  visibleStateRef.current = Object.fromEntries(
    PANELS.map((config) => [
      config.id,
      {
        condition: config.title,
        referenceText: config.referenceText,
        referenceReady: Boolean(panels[config.id].reference.blob),
        targetPhase: panels[config.id].target.phase,
        transcript: panels[config.id].result?.transcript ?? null,
        topFive: panels[config.id].result?.retrieved.slice(0, 5) ?? [],
      },
    ]),
  );

  useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      if (recorderRef.current?.state === 'recording')
        recorderRef.current.stop();
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: object,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'read_asr_comparison',
            description:
              'Read the three ASR experiment conditions, recording status, transcripts and Top 5 entity results.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute(input: unknown) {
              if (
                !input ||
                typeof input !== 'object' ||
                Array.isArray(input) ||
                Object.keys(input).length
              )
                throw new Error('Expected an empty object.');
              return visibleStateRef.current;
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {
      /* Optional browser capability. */
    }
    return () => lifecycle.abort();
  }, []);

  function updatePanel(
    panelId: PanelId,
    update: (panel: PanelState) => PanelState,
  ) {
    setPanels((current) => {
      const next = { ...current, [panelId]: update(current[panelId]) };
      panelsRef.current = next;
      return next;
    });
  }

  function updateRow(
    panelId: PanelId,
    kind: RowKind,
    patch: Partial<RecordingState>,
  ) {
    updatePanel(panelId, (panel) => ({
      ...panel,
      [kind]: { ...panel[kind], ...patch },
    }));
  }

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function releaseGlobalLock() {
    busyRef.current = false;
    setActiveKey(null);
    activeRef.current = null;
    clearTimer();
  }

  function stopRecording(key: string) {
    if (activeRef.current?.key !== key) return;
    activeRef.current = null;
    clearTimer();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }

  async function submitTarget(
    config: PanelConfig,
    targetAudio: Blob,
    audioUrl: string,
  ) {
    const referenceAudio = panelsRef.current[config.id].reference.blob;
    const data = new FormData();
    data.append('audio', targetAudio, audioFilename(targetAudio, 'target'));
    data.append('word', TARGET_WORD);
    data.append('wordId', config.id);
    data.append('purpose', 'practice');
    if (config.referenceText && referenceAudio) {
      data.append(
        'referenceAudio',
        referenceAudio,
        audioFilename(referenceAudio, 'reference'),
      );
      data.append('referenceText', config.referenceText);
    }

    try {
      const response = await fetch('/api/stt', {
        method: 'POST',
        body: data,
        signal: AbortSignal.timeout(150000),
      });
      const payload = (await response.json()) as {
        error?: string;
        transcript?: string | null;
        asrIpa?: string;
        adaptationStatus?: string;
        retrieved?: RetrievedEntity[];
        timing?: Record<string, number> | null;
      };
      if (!response.ok)
        throw new Error(payload.error || '음성 분석에 실패했습니다.');
      if (!mountedRef.current) return;
      const result: ComparisonResult = {
        transcript:
          typeof payload.transcript === 'string' ? payload.transcript : '',
        asrIpa: typeof payload.asrIpa === 'string' ? payload.asrIpa : '',
        adaptationStatus:
          typeof payload.adaptationStatus === 'string'
            ? payload.adaptationStatus
            : config.referenceText
              ? 'reference_audio'
              : 'zero_shot',
        retrieved: Array.isArray(payload.retrieved)
          ? payload.retrieved.slice(0, 5)
          : [],
        timing:
          payload.timing && typeof payload.timing === 'object'
            ? payload.timing
            : null,
      };
      updatePanel(config.id, (panel) => ({
        ...panel,
        target: {
          ...panel.target,
          phase: 'success',
          message: '분석이 완료되었습니다.',
          blob: targetAudio,
          audioUrl,
        },
        result,
      }));
    } catch (error) {
      if (!mountedRef.current) return;
      updatePanel(config.id, (panel) => ({
        ...panel,
        target: {
          ...panel.target,
          phase: 'error',
          message:
            error instanceof Error
              ? error.message
              : '음성 분석에 실패했습니다.',
          blob: targetAudio,
          audioUrl,
        },
        result: null,
      }));
    } finally {
      if (mountedRef.current) releaseGlobalLock();
    }
  }

  async function startRecording(config: PanelConfig, kind: RowKind) {
    if (busyRef.current) return;
    const key = config.id + '-' + kind;
    const panel = panelsRef.current[config.id];
    if (kind === 'target' && config.referenceText && !panel.reference.blob)
      return;

    busyRef.current = true;
    activeRef.current = { key, panelId: config.id, kind };
    setActiveKey(key);

    if (kind === 'reference') {
      updatePanel(config.id, (current) => ({
        ...current,
        reference: {
          ...current.reference,
          phase: 'permission',
          message: '마이크 권한을 확인하고 있습니다.',
          seconds: 0,
          blob: null,
          audioUrl: '',
        },
        target: emptyRecording('Reference 녹음 후 활성화됩니다.'),
        result: null,
      }));
    } else {
      updatePanel(config.id, (current) => ({
        ...current,
        target: {
          ...current.target,
          phase: 'permission',
          message: '마이크 권한을 확인하고 있습니다.',
          seconds: 0,
          blob: null,
          audioUrl: '',
        },
        result: null,
      }));
    }

    let stream: MediaStream | undefined;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === 'undefined'
      )
        throw new Error(
          '녹음은 HTTPS 또는 localhost의 지원 브라우저에서 사용할 수 있습니다.',
        );
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (activeRef.current?.key !== key || !mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        releaseGlobalLock();
        if (mountedRef.current)
          updateRow(config.id, kind, {
            phase: 'idle',
            message: '마이크가 준비되었습니다. 다시 길게 눌러 녹음하세요.',
          });
        return;
      }

      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      let failed = false;
      const startedAt = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        failed = true;
        stream?.getTracks().forEach((track) => track.stop());
        updateRow(config.id, kind, {
          phase: 'error',
          message: '녹음에 실패했습니다. 다시 시도하세요.',
        });
        releaseGlobalLock();
      };
      recorder.onstop = async () => {
        stream?.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        clearTimer();
        if (!mountedRef.current || failed) return;

        const blob = new Blob(chunks, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (!blob.size) {
          updateRow(config.id, kind, {
            phase: 'error',
            message: '녹음된 음성이 없습니다. 조금 더 길게 눌러주세요.',
          });
          releaseGlobalLock();
          return;
        }

        const audioUrl = URL.createObjectURL(blob);
        objectUrlsRef.current.add(audioUrl);
        if (kind === 'reference') {
          updateRow(config.id, kind, {
            phase: 'success',
            message: 'Reference가 준비되었습니다.',
            blob,
            audioUrl,
          });
          releaseGlobalLock();
          return;
        }

        updateRow(config.id, kind, {
          phase: 'sending',
          message: 'ASR과 entity search를 실행하고 있습니다.',
          blob,
          audioUrl,
        });
        await submitTarget(config, blob, audioUrl);
      };

      recorder.start();
      updateRow(config.id, kind, {
        phase: 'recording',
        message: '말한 뒤 버튼에서 손을 떼세요.',
        seconds: 0,
      });
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.min((Date.now() - startedAt) / 1000, MAX_SECONDS);
        updateRow(config.id, kind, { seconds: elapsed });
        if (elapsed >= MAX_SECONDS) stopRecording(key);
      }, 100);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      updateRow(config.id, kind, {
        phase: 'error',
        message:
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? '마이크 권한이 거부되었습니다. 브라우저 설정에서 허용하세요.'
            : error instanceof Error
              ? error.message
              : '마이크에 접근할 수 없습니다.',
      });
      releaseGlobalLock();
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand">
          <span className="brand-icon">
            <AudioLines size={21} />
          </span>
          <span>Wake2Adapt</span>
        </div>
        <span className="header-caption">ASR reference comparison</span>
      </header>

      <main>
        <section className="intro">
          <div>
            <span className="kicker">
              <Sparkles size={15} />
              Interactive comparison
            </span>
            <h1>Reference audio가 인식 결과를 어떻게 바꿀까요?</h1>
          </div>
          <p>
            각 조건에서 <strong>{TARGET_WORD}</strong>을 녹음하고 ASR 결과와
            entity search Top 5를 비교하세요. 한 번에 하나의 녹음만 진행할 수
            있습니다.
          </p>
        </section>

        <div className="comparison-grid">
          {PANELS.map((config) => {
            const panel = panels[config.id];
            const referenceKey = config.id + '-reference';
            const targetKey = config.id + '-target';
            const referenceRequired =
              Boolean(config.referenceText) && !panel.reference.blob;
            return (
              <article
                className="experiment-panel"
                data-tone={config.tone}
                key={config.id}
              >
                <div className="panel-accent" />
                <header className="panel-header">
                  <div className="panel-number">{config.number}</div>
                  <div>
                    <span className="mode">{config.mode}</span>
                    <h2>{config.title}</h2>
                    <p>{config.description}</p>
                  </div>
                </header>

                <div
                  className={
                    config.referenceText
                      ? 'panel-body'
                      : 'panel-body single-condition'
                  }
                >
                  {config.referenceText && (
                    <RecordingRow
                      kind="reference"
                      text={config.referenceText}
                      state={panel.reference}
                      active={activeKey === referenceKey}
                      disabled={
                        activeKey !== null && activeKey !== referenceKey
                      }
                      onStart={() => void startRecording(config, 'reference')}
                      onStop={() => stopRecording(referenceKey)}
                    />
                  )}

                  <RecordingRow
                    kind="target"
                    text={TARGET_WORD}
                    state={panel.target}
                    active={activeKey === targetKey}
                    disabled={
                      referenceRequired ||
                      (activeKey !== null && activeKey !== targetKey)
                    }
                    onStart={() => void startRecording(config, 'target')}
                    onStop={() => stopRecording(targetKey)}
                  />
                </div>

                {panel.result ? (
                  <ResultBlock result={panel.result} />
                ) : (
                  <div className="result-placeholder">
                    <span>Top 5</span>
                    <p>Target 녹음이 끝나면 결과가 여기에 표시됩니다.</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}

"use client";
/* oxlint-disable react/react-compiler -- MediaRecorder callbacks intentionally coordinate mutable browser resources. */

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { csvByDomain } from "virtual:recording-targets";
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleStop,
  Clock,
  ListOrdered,
  Database,
  Equal,
  LoaderCircle,
  Mic,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { isExactMatch, rankDelta } from "@/lib/compare";
import { audioFilename } from "@/lib/recording";
import {
  ENTITY_DOMAINS,
  randomTarget,
  romanizeTranscript,
  targetsByDomain,
  type EntityDomain,
  type TargetWord,
} from "@/lib/targets";

// Random target words per entity set, from L2-KPNS/metadata/recording_targets/{domain}_200.csv.
const TARGETS = targetsByDomain(csvByDomain);
const MAX_SECONDS = 60;
// Results are fetched as a Top 10 once; the Top-K switch only changes what is shown.
const TOP_K_OPTIONS = [1, 3, 5, 10] as const;
const MAX_TOP_K = 10;
type TopK = (typeof TOP_K_OPTIONS)[number];

type PanelId = "zero" | "english" | "korean";
type ReferenceId = Exclude<PanelId, "zero">;
type Slot = ReferenceId | "target";
type Phase = "idle" | "permission" | "recording" | "sending" | "success" | "error";
type TargetHistory = { items: TargetWord[]; index: number };
type ConditionStatus = "idle" | "queued" | "running" | "done" | "error" | "stopped";
/** Which half of an analysis is (or was) in progress. */
type Stage = "asr" | "retrieval";
type PendingTranscript = { transcript: string; romanizedTranscript: string };

type RetrievedEntity = {
  rank: number;
  entityId: string;
  entity: string;
  romanized: string;
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
  targetEntity: string;
  transcript: string;
  romanizedTranscript: string;
  /** Rank of the target entity in the Top 10, or null when it is missing. */
  rank: number | null;
  adaptationStatus: string;
  retrieved: RetrievedEntity[];
  /** Seconds spent in each stage, as reported by the server. */
  asrSeconds: number | null;
  retrievalSeconds: number | null;
};

type ConditionState = {
  status: ConditionStatus;
  message: string;
  result: ComparisonResult | null;
  stage?: Stage;
  /** The ASR transcript while (or after) entity search runs without finishing. */
  pending?: PendingTranscript | null;
};

/** Target rank (Top 10, null = missing) of every scored trial, so any Top-K can be counted. */
type Score = (number | null)[];

/** One analysis waiting for (or using) the GPU, with the recordings it was queued with. */
type AnalysisJob = {
  id: PanelId;
  /** `${domain}:${korean}` of the word the job belongs to. */
  wordKey: string;
  take: number;
  refVersion: number;
  targetAudio: Blob;
  targetWord: TargetWord;
  domain: EntityDomain;
  referenceAudio: Blob | null;
  /** Set when the job starts: aborts the browser requests / names it for server-side cancel. */
  controller?: AbortController;
  requestId?: string;
};

/** A word's target recording and results, kept while another word is shown. */
type WordSnapshot = {
  take: number;
  target: RecordingState;
  conditions: Record<PanelId, ConditionState>;
  /** Reference version each shown 02/03 result was computed with. */
  resultRefVersions: Record<PanelId, number>;
  scored: Set<PanelId>;
};

function zeroVersions(): Record<PanelId, number> {
  return { zero: 0, english: 0, korean: 0 };
}

type PanelConfig = {
  id: PanelId;
  number: string;
  title: string;
  mode: string;
  description: string;
  referenceText: string | null;
  referenceDisplayText: string | null;
  tone: string;
};

const PANELS: PanelConfig[] = [
  {
    id: "zero",
    number: "01",
    title: "No reference",
    mode: "Zero-shot · baseline",
    description: "The target audio alone.",
    referenceText: null,
    referenceDisplayText: null,
    tone: "slate",
  },
  {
    id: "english",
    number: "02",
    title: "+ English reference",
    mode: "1-shot adaptation",
    description: "Target audio plus one English reference word.",
    referenceText: "Android",
    referenceDisplayText: "Android",
    tone: "yellow",
  },
  {
    id: "korean",
    number: "03",
    title: "+ Korean reference",
    mode: "1-shot adaptation",
    description: "Target audio plus one Korean reference word.",
    referenceText: "안드로이드",
    referenceDisplayText: "an-deu-ro-i-deu",
    tone: "teal",
  },
];
const PANEL_BY_ID = Object.fromEntries(PANELS.map((panel) => [panel.id, panel])) as Record<
  PanelId,
  PanelConfig
>;

function emptyRecording(message: string): RecordingState {
  return { phase: "idle", message, seconds: 0, blob: null, audioUrl: "" };
}

function initialRecordings(): Record<Slot, RecordingState> {
  return {
    english: emptyRecording(""),
    korean: emptyRecording(""),
    target: emptyRecording(""),
  };
}

function idleCondition(): ConditionState {
  return { status: "idle", message: "", result: null };
}

function initialConditions(): Record<PanelId, ConditionState> {
  return { zero: idleCondition(), english: idleCondition(), korean: idleCondition() };
}

function emptyScores(): Record<PanelId, Score> {
  return { zero: [], english: [], korean: [] };
}

function withinTopK(rank: number | null, topK: number) {
  return rank !== null && rank <= topK ? rank : null;
}

function hitCount(score: Score, topK: number) {
  return score.filter((rank) => withinTopK(rank, topK) !== null).length;
}

function formatSeconds(seconds: number) {
  return seconds.toFixed(1) + "s";
}

function Recorder({
  variant,
  label,
  text,
  koreanText,
  state,
  disabled,
  active,
  onStart,
  onStop,
  navigation,
  extra,
}: {
  variant: "target" | "reference";
  label: string;
  text: string;
  koreanText?: string | null;
  state: RecordingState;
  disabled: boolean;
  active: boolean;
  onStart: () => void;
  onStop: () => void;
  navigation?: { disabled: boolean; onStep: (direction: -1 | 1) => void };
  /** Rendered after the play button (e.g. the target's Stop button). */
  extra?: ReactNode;
}) {
  const isRecording = state.phase === "recording";
  const recordLabel = isRecording
    ? "Release to finish"
    : state.phase === "permission"
      ? "Waiting for microphone"
      : state.phase === "sending"
        ? "Analyzing"
        : state.blob
          ? "Hold to record again"
          : "Hold to record";

  const navButton = (direction: -1 | 1) => (
    <button
      type="button"
      className="nav-button"
      aria-label={direction === -1 ? "Previous target word" : "Next target word"}
      title={direction === -1 ? "Previous target word (←)" : "Next target word (→)"}
      disabled={navigation?.disabled}
      onClick={() => navigation?.onStep(direction)}
    >
      {direction === -1 ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
    </button>
  );

  return (
    <section className={"recorder is-" + variant + (isRecording ? " is-recording" : "")}>
      <div className="recorder-words">
        <div className="row-heading">
          <span>{label}</span>
          {state.blob && state.phase !== "error" && (
            <span className="ready-mark">
              <Check size={14} />
              Recorded
            </span>
          )}
        </div>
        <div className="phrase-line">
          {navigation && navButton(-1)}
          <div className="phrase-text">
            <p className="phrase" lang={/[가-힣]/.test(text) ? "ko" : "en"}>
              {text}
            </p>
            {(koreanText || variant === "target") && (
              <p className="phrase-ko" lang="ko" aria-hidden={koreanText ? undefined : true}>
                {koreanText || " "}
              </p>
            )}
          </div>
          {navigation && navButton(1)}
        </div>
      </div>
      <div className="recorder-controls">
        <div className="record-line">
        <Button
          data-record
          className="record-button"
          aria-label={recordLabel + ": " + text}
          aria-pressed={isRecording}
          disabled={disabled || state.phase === "sending"}
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
          {isRecording && <span className="record-time">{formatSeconds(state.seconds)}</span>}
        </Button>
        <PlayButton url={state.audioUrl} label={label} />
        {extra}
        </div>
        {state.message && (
        <div
          className={
            "row-status " + (state.phase === "error" ? "has-error" : "") + (active ? " is-active" : "")
          }
          aria-live="polite"
        >
          {state.phase === "error" ? (
            <CircleAlert size={15} />
          ) : state.phase === "success" ? (
            <Check size={15} />
          ) : (
            <span className="status-line" />
          )}
          <span>{state.message}</span>
        </div>
        )}
      </div>
    </section>
  );
}

/** Compact play/stop toggle for a reference recording. */
function PlayButton({ url, label }: { url: string; label: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <button
        type="button"
        className="play-button"
        disabled={!url}
        aria-label={(playing ? "Stop " : "Play ") + label}
        title={playing ? "Stop" : "Play recording"}
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (playing) {
            audio.pause();
            audio.currentTime = 0;
          } else void audio.play().catch(() => setPlaying(false));
        }}
      >
        {playing ? <Square size={14} /> : <Play size={14} />}
      </button>
      {url && (
        /* oxlint-disable-next-line jsx-a11y/media-has-caption -- User-recorded speech has no transcript track at capture time. */
        <audio
          ref={audioRef}
          src={url}
          preload="auto"
          hidden
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
    </>
  );
}

function ConditionNotice({
  condition,
  onRetry,
}: {
  condition: ConditionState;
  onRetry?: () => void;
}) {
  if (condition.status === "queued")
    return (
      <p className="cell-note is-queued">
        <Clock size={15} />
        {condition.message}
      </p>
    );
  if (condition.status === "running")
    return (
      <p className="cell-note is-running">
        <LoaderCircle size={15} className="spin" />
        {condition.message}
      </p>
    );
  if (condition.status === "stopped")
    return (
      <p className="cell-note">
        <CircleStop size={15} />
        {condition.message}
        {onRetry && (
          <button type="button" className="retry-link" onClick={onRetry}>
            Run again
          </button>
        )}
      </p>
    );
  if (condition.status === "error")
    return (
      <p className="cell-note has-error">
        <CircleAlert size={15} />
        {condition.message}
      </p>
    );
  return <p className="cell-note">{condition.message}</p>;
}

function Transcript({
  romanized,
  transcript,
  exact,
}: {
  romanized: string;
  transcript: string;
  exact: boolean;
}) {
  return (
    <>
      <p className="transcript" lang="ko-Latn">
        {romanized || "No speech detected"}
        {exact && (
          <span className="exact-badge">
            <Check size={13} />
            Exact
          </span>
        )}
      </p>
      {transcript && (
        <p className="asr-ipa" lang="ko">
          {transcript}
        </p>
      )}
    </>
  );
}

function seconds(value: number | null | undefined) {
  return typeof value === "number" ? value.toFixed(2) + "s" : null;
}

function DeltaBadge({
  baseline,
  current,
  topK,
}: {
  baseline: number | null;
  current: number | null;
  topK: number;
}) {
  const delta = rankDelta(baseline, current, topK);
  const Icon = delta.kind === "up" ? ArrowUp : delta.kind === "down" ? ArrowDown : Equal;
  return (
    <span className={"delta-badge is-" + delta.kind}>
      <Icon size={13} />
      {delta.label}
      <small>vs zero-shot</small>
    </span>
  );
}

function ScoreCell({ score, topK, best }: { score: Score; topK: number; best: boolean }) {
  const trials = score.length;
  const hits = hitCount(score, topK);
  const percent = trials ? Math.round((hits / trials) * 100) : 0;
  return (
    <div className={"score-cell" + (best ? " is-best" : "")}>
      <div className="score-line">
        <span className="eyebrow">Session · Top-{topK}</span>
        <strong>
          {hits}
          <small> / {trials}</small>
        </strong>
      </div>
      <div
        className="score-bar"
        role="meter"
        aria-label={"Top-" + topK + " rate"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: percent + "%" }} />
      </div>
      <p className="score-sub">
        {trials ? percent + "% Top-" + topK : "No trials yet"}
        {topK !== 1 && " · Top-1 " + hitCount(score, 1) + " / " + trials}
      </p>
    </div>
  );
}

export default function Home() {
  const [recordings, setRecordings] = useState<Record<Slot, RecordingState>>(initialRecordings);
  const [conditions, setConditions] =
    useState<Record<PanelId, ConditionState>>(initialConditions);
  const [scores, setScores] = useState<Record<PanelId, Score>>(emptyScores);
  const [topK, setTopK] = useState<TopK>(5);
  // True while any analysis is queued or running (enables Stop / Backspace).
  const [jobsActive, setJobsActive] = useState(false);
  const [activeKey, setActiveKey] = useState<Slot | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("default");
  const [selectedDomain, setSelectedDomain] = useState<EntityDomain>("roads");
  // Per entity set, the targets visited with ←/→ so going back shows the previous word.
  const [targetHistory, setTargetHistory] = useState<
    Partial<Record<EntityDomain, TargetHistory>>
  >({});
  const domainHistory = targetHistory[selectedDomain];
  const target = domainHistory?.items[domainHistory.index] ?? null;
  const targetCount = TARGETS[selectedDomain].length;
  // Only a recording in progress locks the controls; analyses run in the background queue.
  const busy = activeKey !== null;

  const targetRef = useRef(target);
  targetRef.current = target;
  const recordingsRef = useRef(recordings);
  recordingsRef.current = recordings;
  const stepTargetRef = useRef<(direction: -1 | 1) => void>(() => {});
  const stopAnalysesRef = useRef<() => void>(() => {});
  const recorderRef = useRef<MediaRecorder | null>(null);
  const activeRef = useRef<Slot | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const objectUrlsRef = useRef(new Set<string>());
  const conditionsRef = useRef(conditions);
  // Conditions already scored for the current target recording (re-runs are not re-counted).
  const scoredRef = useRef(new Set<PanelId>());
  // A "take" is one target recording of one word. A job is valid only while its word's take
  // and (for 02/03) its reference version are still current; otherwise its result is dropped.
  const takeCounterRef = useRef(0);
  const currentTakeRef = useRef(-1);
  const currentKeyRef = useRef<string | null>(null);
  const refVersionRef = useRef<Record<ReferenceId, number>>({ english: 0, korean: 0 });
  const resultRefVersionsRef = useRef<Record<PanelId, number>>(zeroVersions());
  // Other words' recordings and results, restored when the word is shown again.
  const wordCacheRef = useRef(new Map<string, WordSnapshot>());
  const queueRef = useRef<AnalysisJob[]>([]);
  const runningRef = useRef<AnalysisJob | null>(null);
  const visibleStateRef = useRef<object>({});

  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "audioinput",
      );
      setAudioInputs(devices);
      setSelectedDeviceId((current) =>
        current === "default" || devices.some((device) => device.deviceId === current)
          ? current
          : "default",
      );
    } catch {
      setAudioInputs([]);
    }
  }, []);

  visibleStateRef.current = {
    entityDomain: selectedDomain,
    targetWord: target,
    targetRecorded: Boolean(recordings.target.blob),
    conditions: Object.fromEntries(
      PANELS.map((config) => [
        config.id,
        {
          condition: config.title,
          referenceText: config.referenceText,
          referenceReady: config.id === "zero" ? null : Boolean(recordings[config.id].blob),
          status: conditions[config.id].status,
          transcript: conditions[config.id].result?.transcript ?? null,
          romanizedTranscript: conditions[config.id].result?.romanizedTranscript ?? null,
          targetRank: conditions[config.id].result?.rank ?? null,
          shownTopK: topK,
          topK: conditions[config.id].result?.retrieved.slice(0, topK) ?? [],
          sessionScore: scores[config.id],
        },
      ]),
    ),
  };

  useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // Random first target for each entity set, chosen after mount to keep SSR output stable.
  useEffect(() => {
    setTargetHistory((current) => {
      if (current[selectedDomain]) return current;
      const first = randomTarget(TARGETS[selectedDomain]);
      return first ? { ...current, [selectedDomain]: { items: [first], index: 0 } } : current;
    });
  }, [selectedDomain]);

  // Show (restore or start) the word whenever the selected word changes.
  const targetKey = target ? selectedDomain + ":" + target.korean : null;
  useEffect(() => {
    if (targetKey) arriveWordRef.current(targetKey);
  }, [targetKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isArrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (!isArrow && event.key !== "Backspace") return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      // Leave arrow keys to form controls and audio players (seeking).
      if (
        event.target instanceof Element &&
        event.target.closest("input, select, textarea, audio, video, [contenteditable]")
      )
        return;
      event.preventDefault();
      if (event.key === "Backspace") stopAnalysesRef.current();
      else stepTargetRef.current(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return;
    const handleDeviceChange = () => void refreshAudioInputs();
    void refreshAudioInputs();
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [refreshAudioInputs]);

  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (tool: object, options: { signal: AbortSignal }) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: "read_asr_comparison",
            description:
              "Read the target word, the three ASR conditions run on one target recording, their transcripts, target ranks, Top-K entity results and session scores.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute(input: unknown) {
              if (
                !input ||
                typeof input !== "object" ||
                Array.isArray(input) ||
                Object.keys(input).length
              )
                throw new Error("Expected an empty object.");
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

  // The ref is updated synchronously: callers (e.g. enqueueAnalyses) read it in the same tick,
  // before React has run any queued state updater.
  function updateRecording(slot: Slot, patch: Partial<RecordingState>) {
    const next = {
      ...recordingsRef.current,
      [slot]: { ...recordingsRef.current[slot], ...patch },
    };
    recordingsRef.current = next;
    setRecordings(next);
  }

  function setAllConditions(next: Record<PanelId, ConditionState>) {
    conditionsRef.current = next;
    setConditions(next);
  }

  function updateCondition(id: PanelId, patch: Partial<ConditionState>) {
    setAllConditions({
      ...conditionsRef.current,
      [id]: { ...conditionsRef.current[id], ...patch },
    });
  }

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function releaseRecorder() {
    setActiveKey(null);
    activeRef.current = null;
    clearTimer();
  }

  function releaseGlobalLock() {
    busyRef.current = false;
    releaseRecorder();
  }

  function stopRecording(slot: Slot) {
    if (activeRef.current !== slot) return;
    activeRef.current = null;
    clearTimer();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  /**
   * Stores the shown word's recording and results. Its queued analyses are dropped (they are
   * re-queued on return); one already running finishes into the stored snapshot.
   */
  function leaveWord() {
    const key = currentKeyRef.current;
    if (!key) return;
    queueRef.current = queueRef.current.filter((job) => job.wordKey !== key);
    if (recordingsRef.current.target.blob)
      wordCacheRef.current.set(key, {
        take: currentTakeRef.current,
        target: recordingsRef.current.target,
        conditions: Object.fromEntries(
          PANELS.map((panel) => {
            const condition = conditionsRef.current[panel.id];
            return [panel.id, condition.status === "queued" ? idleCondition() : condition];
          }),
        ) as Record<PanelId, ConditionState>,
        resultRefVersions: { ...resultRefVersionsRef.current },
        scored: scoredRef.current,
      });
    currentKeyRef.current = null;
    currentTakeRef.current = -1;
    scoredRef.current = new Set();
    resultRefVersionsRef.current = zeroVersions();
    updateRecording("target", emptyRecording(""));
    setAllConditions(initialConditions());
  }

  /** Shows a word: restores its earlier recording and results, or starts it empty. */
  function arriveWord(key: string) {
    if (currentKeyRef.current === key) return;
    leaveWord();
    currentKeyRef.current = key;
    const snapshot = wordCacheRef.current.get(key);
    if (!snapshot) {
      currentTakeRef.current = ++takeCounterRef.current;
      return;
    }
    wordCacheRef.current.delete(key);
    currentTakeRef.current = snapshot.take;
    scoredRef.current = snapshot.scored;
    resultRefVersionsRef.current = snapshot.resultRefVersions;
    updateRecording("target", snapshot.target);
    setAllConditions(snapshot.conditions);
    // Run what is missing, or what was computed with a reference that has since been re-recorded.
    const toRun = PANELS.map((panel) => panel.id).filter((id) => {
      const condition = snapshot.conditions[id];
      if (condition.status === "idle") return true;
      return (
        id !== "zero" &&
        condition.status === "done" &&
        snapshot.resultRefVersions[id] !== refVersionRef.current[id]
      );
    });
    if (toRun.length) enqueueAnalyses(toRun);
  }
  const arriveWordRef = useRef(arriveWord);
  arriveWordRef.current = arriveWord;

  function changeDomain(domain: EntityDomain) {
    if (busyRef.current || domain === selectedDomain) return;
    leaveWord();
    setSelectedDomain(domain);
  }

  // ← shows the previous target word, → the next; past either end a new random word is drawn.
  function stepTarget(direction: -1 | 1) {
    if (busyRef.current) return;
    const words = TARGETS[selectedDomain];
    const history = targetHistory[selectedDomain];
    if (!history || words.length < 2) return;
    let { items, index } = history;
    if (direction === 1 && index < items.length - 1) index += 1;
    else if (direction === -1 && index > 0) index -= 1;
    else {
      const next = randomTarget(words, items[index]);
      if (!next) return;
      items = direction === 1 ? [...items, next] : [next, ...items];
      index = direction === 1 ? items.length - 1 : 0;
    }
    leaveWord();
    setTargetHistory((current) => ({ ...current, [selectedDomain]: { items, index } }));
  }
  stepTargetRef.current = stepTarget;

  /** Stage 1 — ASR only (GPU). Cancellable on the server through job.requestId. */
  async function transcribeJob(job: AnalysisJob, signal: AbortSignal) {
    const config = PANEL_BY_ID[job.id];
    const data = new FormData();
    data.append("audio", job.targetAudio, audioFilename(job.targetAudio, "target"));
    data.append("word", job.targetWord.korean);
    data.append("wordId", config.id);
    data.append("domain", job.domain);
    data.append("purpose", "practice");
    data.append("skipRetrieval", "1");
    if (job.requestId) data.append("requestId", job.requestId);
    if (config.referenceText && job.referenceAudio) {
      data.append(
        "referenceAudio",
        job.referenceAudio,
        audioFilename(job.referenceAudio, "reference"),
      );
      data.append("referenceText", config.referenceText);
    }
    const response = await fetch("/api/stt", {
      method: "POST",
      body: data,
      signal: AbortSignal.any([signal, AbortSignal.timeout(150000)]),
    });
    const payload = (await response.json()) as {
      error?: string;
      transcript?: string | null;
      adaptationStatus?: string;
      timing?: Record<string, number> | null;
    };
    if (!response.ok) throw new Error(payload.error || "Speech recognition failed.");
    // Guard against a mix-up: 01 must come back zero-shot, 02/03 with their reference applied.
    const expected = job.referenceAudio ? "reference_audio" : "zero_shot";
    if (payload.adaptationStatus && payload.adaptationStatus !== expected)
      throw new Error(
        "Server returned " +
          payload.adaptationStatus +
          " for " +
          config.title +
          " (expected " +
          expected +
          ").",
      );
    const transcript = typeof payload.transcript === "string" ? payload.transcript.trim() : "";
    return {
      transcript,
      romanizedTranscript: transcript
        ? romanizeTranscript(transcript, [job.targetWord, ...TARGETS[job.domain]])
        : "",
      asrSeconds: typeof payload.timing?.asr_s === "number" ? payload.timing.asr_s : null,
    };
  }

  /** Stage 2 — phonetic entity search over the transcript (CPU, no ASR). */
  async function retrieveJob(
    job: AnalysisJob,
    asr: PendingTranscript & { asrSeconds: number | null },
    signal: AbortSignal,
  ): Promise<ComparisonResult> {
    let retrieved: RetrievedEntity[] = [];
    let retrievalSeconds: number | null = null;
    if (asr.transcript) {
      const data = new FormData();
      data.append("text", asr.transcript);
      data.append("domain", job.domain);
      data.append("topK", String(MAX_TOP_K));
      const response = await fetch("/api/retrieve", {
        method: "POST",
        body: data,
        signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      });
      const payload = (await response.json()) as {
        error?: string;
        retrieved?: RetrievedEntity[];
        timing?: Record<string, number> | null;
      };
      if (!response.ok) throw new Error(payload.error || "Entity search failed.");
      retrieved = Array.isArray(payload.retrieved) ? payload.retrieved.slice(0, MAX_TOP_K) : [];
      retrievalSeconds =
        typeof payload.timing?.retrieval_s === "number" ? payload.timing.retrieval_s : null;
    }
    return {
      targetEntity: job.targetWord.korean,
      transcript: asr.transcript,
      romanizedTranscript: asr.transcript
        ? romanizeTranscript(asr.transcript, [job.targetWord, ...retrieved, ...TARGETS[job.domain]])
        : "",
      rank: retrieved.find((hit) => hit.entity === job.targetWord.korean)?.rank ?? null,
      adaptationStatus: job.referenceAudio ? "reference_audio" : "zero_shot",
      retrieved,
      asrSeconds: asr.asrSeconds,
      retrievalSeconds,
    };
  }

  function syncJobsActive() {
    setJobsActive(Boolean(runningRef.current || queueRef.current.length));
  }

  /** Asks the server to stop the running ASR and aborts its browser requests. */
  function abortJob(job: AnalysisJob) {
    job.controller?.abort();
    if (!job.requestId) return;
    const data = new FormData();
    data.append("requestId", job.requestId);
    void fetch("/api/stt/cancel", { method: "POST", body: data }).catch(() => {});
  }

  /** Stop button / Backspace: empties the queue and stops the analysis that is running. */
  function stopAnalyses() {
    for (const job of queueRef.current)
      if (isValid(job)) applyJob(job, { status: "stopped", message: "Stopped", result: null });
    queueRef.current = [];
    if (runningRef.current) abortJob(runningRef.current);
    syncJobsActive();
  }
  stopAnalysesRef.current = stopAnalyses;

  /** After a re-recording, stop the running analysis if it was for the old recording. */
  function abortRunningIfStale() {
    const job = runningRef.current;
    if (job && !isValid(job)) abortJob(job);
  }

  function conditionOf(job: AnalysisJob): ConditionState | undefined {
    return job.wordKey === currentKeyRef.current
      ? conditionsRef.current[job.id]
      : wordCacheRef.current.get(job.wordKey)?.conditions[job.id];
  }

  function isValid(job: AnalysisJob) {
    const take =
      job.wordKey === currentKeyRef.current
        ? currentTakeRef.current
        : wordCacheRef.current.get(job.wordKey)?.take;
    return (
      job.take === take && (job.id === "zero" || job.refVersion === refVersionRef.current[job.id])
    );
  }

  /** Writes a finished job's state to its word, shown or stored. */
  function applyJob(job: AnalysisJob, state: ConditionState, rank?: number | null) {
    const id = job.id;
    let scored: Set<PanelId>;
    if (job.wordKey === currentKeyRef.current) {
      updateCondition(id, state);
      resultRefVersionsRef.current = { ...resultRefVersionsRef.current, [id]: job.refVersion };
      scored = scoredRef.current;
    } else {
      const snapshot = wordCacheRef.current.get(job.wordKey);
      if (!snapshot) return;
      snapshot.conditions = { ...snapshot.conditions, [id]: state };
      snapshot.resultRefVersions = { ...snapshot.resultRefVersions, [id]: job.refVersion };
      scored = snapshot.scored;
    }
    if (rank !== undefined && !scored.has(id)) {
      scored.add(id);
      setScores((current) => ({ ...current, [id]: [...current[id], rank] }));
    }
  }

  /** A dropped job may still be marked running on its word; clear it (and retry if shown). */
  function releaseDroppedJob(job: AnalysisJob) {
    const id = job.id;
    if (job.wordKey === currentKeyRef.current) {
      if (conditionsRef.current[id].status !== "running") return;
      updateCondition(id, idleCondition());
      enqueueAnalyses([id]);
      return;
    }
    const snapshot = wordCacheRef.current.get(job.wordKey);
    if (snapshot?.conditions[id].status === "running")
      snapshot.conditions = { ...snapshot.conditions, [id]: idleCondition() };
  }

  /**
   * Queues each analysis in `ids` that the current recordings allow: 01 needs the target,
   * 02/03 also need their reference. A newer job replaces a queued one for the same condition.
   */
  function enqueueAnalyses(ids: PanelId[]) {
    const targetAudio = recordingsRef.current.target.blob;
    const targetWord = targetRef.current;
    const wordKey = currentKeyRef.current;
    if (!targetAudio || !targetWord || !wordKey) return;
    for (const id of ids) {
      const referenceAudio = id === "zero" ? null : recordingsRef.current[id].blob;
      if (id !== "zero" && !referenceAudio) continue;
      queueRef.current = queueRef.current.filter(
        (job) => !(job.id === id && job.wordKey === wordKey),
      );
      queueRef.current.push({
        id,
        wordKey,
        take: currentTakeRef.current,
        refVersion: id === "zero" ? 0 : refVersionRef.current[id],
        targetAudio,
        targetWord,
        domain: selectedDomain,
        referenceAudio,
      });
      updateCondition(id, {
        status: "queued",
        message: "Queued",
        result: null,
        stage: undefined,
        pending: null,
      });
    }
    syncJobsActive();
    void pumpQueue();
  }

  /** Runs queued analyses one at a time (single GPU), skipping ones made stale. */
  async function pumpQueue() {
    if (runningRef.current) return;
    let job = queueRef.current.shift();
    while (job && !isValid(job)) job = queueRef.current.shift();
    if (!job) return;

    const controller = new AbortController();
    job.controller = controller;
    job.requestId = crypto.randomUUID();
    runningRef.current = job;
    syncJobsActive();
    updateCondition(job.id, {
      status: "running",
      stage: "asr",
      message: "Running…",
      result: null,
      pending: null,
    });
    let applied = false;
    try {
      const asr = await transcribeJob(job, controller.signal);
      if (mountedRef.current && isValid(job)) {
        // ASR is done: show its transcript, then run entity search on it.
        applyJob(job, {
          status: "running",
          stage: "retrieval",
          message: "Running…",
          result: null,
          pending: asr,
        });
        const result = await retrieveJob(job, asr, controller.signal);
        if (mountedRef.current && isValid(job)) {
          applyJob(job, { status: "done", message: "", result }, result.rank);
          applied = true;
        }
      }
    } catch (error) {
      if (mountedRef.current && isValid(job)) {
        const previous = conditionOf(job);
        const stopped = controller.signal.aborted;
        applyJob(job, {
          status: stopped ? "stopped" : "error",
          message: stopped
            ? "Stopped"
            : error instanceof Error
              ? error.message
              : "Analysis failed.",
          result: null,
          stage: previous?.stage,
          pending: previous?.pending ?? null,
        });
        applied = true;
      }
    } finally {
      runningRef.current = null;
      syncJobsActive();
    }
    if (mountedRef.current && !applied) releaseDroppedJob(job);
    if (mountedRef.current) void pumpQueue();
  }

  async function startRecording(slot: Slot) {
    if (busyRef.current) return;
    if (slot === "target" && !targetRef.current) return;

    busyRef.current = true;
    activeRef.current = slot;
    setActiveKey(slot);
    if (slot === "target") {
      // Rule: a new target recording drops every queued/in-flight analysis of the old one.
      currentTakeRef.current = ++takeCounterRef.current;
      queueRef.current = queueRef.current.filter((job) => job.wordKey !== currentKeyRef.current);
      scoredRef.current = new Set();
      resultRefVersionsRef.current = zeroVersions();
      setAllConditions(initialConditions());
      abortRunningIfStale();
    } else {
      // Rule: re-recording a reference drops only that condition's queued/in-flight analysis.
      refVersionRef.current[slot] += 1;
      queueRef.current = queueRef.current.filter((job) => job.id !== slot);
      updateCondition(slot, idleCondition());
      abortRunningIfStale();
    }
    updateRecording(slot, {
      phase: "permission",
      message: "",
      seconds: 0,
      blob: null,
      audioUrl: "",
    });

    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
        throw new Error("Recording requires HTTPS or localhost in a supported browser.");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedDeviceId === "default" ? true : { deviceId: { exact: selectedDeviceId } },
      });
      void refreshAudioInputs();
      if (activeRef.current !== slot || !mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        releaseGlobalLock();
        if (mountedRef.current)
          updateRecording(slot, {
            phase: "idle",
            message: "",
          });
        return;
      }

      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
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
        updateRecording(slot, { phase: "error", message: "Recording failed. Try again." });
        releaseGlobalLock();
      };
      recorder.onstop = async () => {
        stream?.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        clearTimer();
        if (!mountedRef.current || failed) return;

        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) {
          updateRecording(slot, {
            phase: "error",
            message: "No audio was captured. Hold the button a little longer.",
          });
          releaseGlobalLock();
          return;
        }

        const audioUrl = URL.createObjectURL(blob);
        objectUrlsRef.current.add(audioUrl);
        releaseGlobalLock();
        if (slot === "target") {
          updateRecording("target", {
            phase: "success",
            message: "",
            blob,
            audioUrl,
          });
          // 01 always; 02/03 only if their reference is already recorded.
          enqueueAnalyses(PANELS.map((panel) => panel.id));
          return;
        }

        updateRecording(slot, {
          phase: "success",
          message: "",
          blob,
          audioUrl,
        });
        // Only this condition can newly run, and only if the current word is recorded.
        enqueueAnalyses([slot]);
      };

      recorder.start();
      updateRecording(slot, {
        phase: "recording",
        message: "",
        seconds: 0,
      });
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.min((Date.now() - startedAt) / 1000, MAX_SECONDS);
        updateRecording(slot, { seconds: elapsed });
        if (elapsed >= MAX_SECONDS) stopRecording(slot);
      }, 100);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      updateRecording(slot, {
        phase: "error",
        message:
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Microphone access was denied. Allow it in browser settings."
            : error instanceof DOMException && error.name === "OverconstrainedError"
              ? "The selected microphone is unavailable. Choose another input."
              : error instanceof Error
                ? error.message
                : "Unable to access the microphone.",
      });
      releaseGlobalLock();
    }
  }

  const targetRecorded = Boolean(recordings.target.blob);
  const baseline = conditions.zero.status === "done" ? conditions.zero.result : null;
  const totalTrials = Math.max(...PANELS.map((panel) => scores[panel.id].length));
  const bestHits = Math.max(...PANELS.map((panel) => hitCount(scores[panel.id], topK)));

  function placeholderFor(config: PanelConfig): string {
    if (config.referenceText && !recordings[config.id as Slot].blob)
      return "Reference not recorded.";
    if (!targetRecorded) return "Target not recorded.";
    return "";
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
        <div className="header-actions">
          <label className="settings-control">
            <span className="settings-label">
              <Mic size={14} />
              Microphone
            </span>
            <select
              className="settings-select microphone-select"
              value={selectedDeviceId}
              disabled={busy}
              onFocus={() => void refreshAudioInputs()}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
              aria-label="Microphone input"
            >
              <option value="default">Default microphone</option>
              {audioInputs
                .filter((device) => device.deviceId && device.deviceId !== "default")
                .map((device, index) => (
                  <option value={device.deviceId} key={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
            </select>
          </label>
          <label className="settings-control">
            <span className="settings-label">
              <Database size={14} />
              Entity set
            </span>
            <select
              className="settings-select entity-select"
              value={selectedDomain}
              disabled={busy}
              onChange={(event) => changeDomain(event.target.value as EntityDomain)}
              aria-label="Entity set"
            >
              {ENTITY_DOMAINS.map((domain) => (
                <option value={domain} key={domain}>
                  {domain}
                </option>
              ))}
            </select>
          </label>
          <div className="settings-control" role="group" aria-label="Entity results shown">
            <span className="settings-label">
              <ListOrdered size={14} />
              Show
            </span>
            <div className="segmented">
              {TOP_K_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option}
                  className={option === topK ? "is-active" : ""}
                  aria-pressed={option === topK}
                  onClick={() => setTopK(option)}
                >
                  Top {option}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main>
        <section className="intro">
          <h1>How does one reference word change recognition?</h1>
          {!target && !targetCount && (
            <p>
              No target words for <strong>{selectedDomain}</strong>. Add{" "}
              <code>L2-KPNS/metadata/recording_targets/{selectedDomain}_200.csv</code> or set{" "}
              <code>L2_KPNS_DIR</code>.
            </p>
          )}
        </section>

        <div className={"comparison-grid" + (targetRecorded ? " is-live" : "")}>
          {/* Continuous lane per condition; the target card crosses all three. */}
          {PANELS.map((config, index) => (
            <div
              className={"lane" + (config.id === "zero" ? " is-baseline" : "")}
              data-tone={config.tone}
              data-col={index + 1}
              key={"lane-" + config.id}
              aria-hidden="true"
            />
          ))}

          {PANELS.map((config, index) => {
            const referenceSlot = config.referenceText ? (config.id as Slot) : null;
            return (
              <header
                className="condition-header"
                data-tone={config.tone}
                data-col={index + 1}
                key={"head-" + config.id}
              >
                <div className="panel-accent" />
                <div className="condition-title">
                  <div className="panel-number">{config.number}</div>
                  <div>
                    <span className="mode">{config.mode}</span>
                    <h3>{config.title}</h3>
                  </div>
                </div>
                  {referenceSlot ? (
                    <Recorder
                      variant="reference"
                      label="Reference word"
                      text={config.referenceDisplayText ?? config.referenceText!}
                      koreanText={
                        /[가-힣]/.test(config.referenceText!) ? config.referenceText : null
                      }
                      state={recordings[referenceSlot]}
                      active={activeKey === referenceSlot}
                      disabled={busy && activeKey !== referenceSlot}
                      onStart={() => void startRecording(referenceSlot)}
                      onStop={() => stopRecording(referenceSlot)}
                    />
                  ) : (
                    <div className="baseline-note">
                      <p>No reference audio</p>
                    </div>
                  )}
              </header>
            );
          })}

          <section className="target-card" data-tone="ink" aria-label="Target word recording">
          <Recorder
            variant="target"
            label="Target word"
            text={target?.romanized ?? "—"}
            koreanText={target?.korean}
            state={recordings.target}
            active={activeKey === "target"}
            disabled={!target || (busy && activeKey !== "target")}
            navigation={{
              disabled: busy || targetCount < 2,
              onStep: (direction) => stepTargetRef.current(direction),
            }}
            onStart={() => void startRecording("target")}
            onStop={() => stopRecording("target")}
            extra={
              <button
                type="button"
                className="stop-button"
                disabled={!jobsActive}
                title="Stop ASR (Backspace)"
                aria-keyshortcuts="Backspace"
                onClick={stopAnalyses}
              >
                <CircleStop size={15} />
                Stop
              </button>
            }
          />
            <div className="lane-arrows" aria-hidden="true">
              {PANELS.map((config) => (
                <span data-tone={config.tone} key={config.id}>
                  <ArrowDown size={14} />
                </span>
              ))}
            </div>
          </section>

          {PANELS.map((config, index) => {
            const condition = conditions[config.id];
            const result = condition.status === "done" ? condition.result : null;
            const placeholder = placeholderFor(config);
            const exact = result ? isExactMatch(result.transcript, result.targetEntity) : false;
            // After ASR finished: its transcript, while entity search runs / was stopped / failed.
            const pending = !result && condition.stage === "retrieval" ? condition.pending : null;
            const retry = () => enqueueAnalyses([config.id]);
            return (
              <Fragment key={"cells-" + config.id}>
                <section className="cell cell-asr" data-tone={config.tone} data-col={index + 1} aria-live="polite">
                  <div className="top-five-heading">
                    <span className="eyebrow">
                      <span className="cell-tag">{config.number} · </span>
                      ASR output
                    </span>
                    {result && <span>{seconds(result.asrSeconds)}</span>}
                  </div>
                  {result ? (
                    <Transcript
                      romanized={result.romanizedTranscript}
                      transcript={result.transcript}
                      exact={exact}
                    />
                  ) : pending ? (
                    <Transcript
                      romanized={pending.romanizedTranscript}
                      transcript={pending.transcript}
                      exact={isExactMatch(pending.transcript, target?.korean ?? "")}
                    />
                  ) : placeholder ? (
                    <p className="cell-note">{placeholder}</p>
                  ) : (
                    <ConditionNotice condition={condition} onRetry={retry} />
                  )}
                </section>

                <section className="cell cell-rank" data-tone={config.tone} data-col={index + 1}>
                  <span className="eyebrow">Target rank</span>
                  <div className="rank-line">
                    <strong className={"rank-value" + (result?.rank === 1 ? " is-first" : "")}>
                      {result
                        ? withinTopK(result.rank, topK)
                          ? "#" + result.rank
                          : "Not in Top " + topK
                        : "—"}
                    </strong>
                    {result && config.id !== "zero" && baseline && (
                      <DeltaBadge
                        baseline={withinTopK(baseline.rank, topK)}
                        current={withinTopK(result.rank, topK)}
                        topK={topK}
                      />
                    )}
                  </div>
                </section>

                <section className="cell cell-top5" data-tone={config.tone} data-col={index + 1}>
                  <div className="top-five-heading">
                    <span className="eyebrow">Entity search · Top {topK}</span>
                    {result && <span>{seconds(result.retrievalSeconds)}</span>}
                  </div>
                  {result ? (
                    result.retrieved.length ? (
                      <ol className="entity-list">
                        {result.retrieved.slice(0, topK).map((hit) => (
                          <li
                            key={String(hit.rank) + "-" + hit.entity}
                            className={hit.entity === result.targetEntity ? "is-match" : ""}
                          >
                            <span className="rank">{hit.rank}</span>
                            <span className="entity">
                              <strong lang="en">{hit.romanized}</strong>
                              <small lang="ko">{hit.entity}</small>
                            </span>
                            <span className="score">
                              <strong>{hit.score.toFixed(2)}</strong>
                              <small>dist {hit.distance}</small>
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="no-results">No entities found.</p>
                    )
                  ) : pending ? (
                    <ConditionNotice condition={condition} onRetry={retry} />
                  ) : (
                    <div className="top5-skeleton" aria-hidden="true">
                      {Array.from({ length: topK }, (_, index) => (
                        <span key={index} />
                      ))}
                    </div>
                  )}
                </section>

                <section className="cell cell-score" data-tone={config.tone} data-col={index + 1}>
                  <ScoreCell
                    score={scores[config.id]}
                    topK={topK}
                    best={bestHits > 0 && hitCount(scores[config.id], topK) === bestHits}
                  />
                </section>
              </Fragment>
            );
          })}
        </div>

        <div className="session-footer">
          <div className="session-meta">
            <span>
              Session: {totalTrials} trial{totalTrials === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              className="reset-score"
              disabled={busy || totalTrials === 0}
              onClick={() => setScores(emptyScores())}
            >
              <RotateCcw size={13} />
              Reset
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

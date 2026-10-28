import {
  attemptAsync,
  Bug,
  err,
  ok,
  parse,
  rethrow,
  type Result,
  type SchemaProof,
  type SchemaSound,
} from "@xeon/contracts";
import type { ScopeApi } from "@xeon/contracts/extensions";
import { Type, type TUnsafe } from "typebox";
import { failureOf, type HelmFailure } from "./failures.ts";

export const HELM_STATE_VERSION = 1 as const;

export type HelmPhase = "idle" | "diverge" | "explore" | "converge" | "apply";
const phaseShape = Type.Union([
  Type.Literal("idle"),
  Type.Literal("diverge"),
  Type.Literal("explore"),
  Type.Literal("converge"),
  Type.Literal("apply"),
]);
export const HelmPhaseSchema: TUnsafe<HelmPhase> = Type.Unsafe<HelmPhase>(
  phaseShape satisfies SchemaSound<HelmPhase, typeof phaseShape>,
);

/** 탐구 단계(idle 제외) */
export type InquiryPhase = Exclude<HelmPhase, "idle">;

export type HelmSignalKind = "stuck" | "repeat" | "newDomain";
const signalShape = Type.Union([
  Type.Literal("stuck"),
  Type.Literal("repeat"),
  Type.Literal("newDomain"),
]);
export const HelmSignalKindSchema: TUnsafe<HelmSignalKind> = Type.Unsafe<HelmSignalKind>(
  signalShape satisfies SchemaSound<HelmSignalKind, typeof signalShape>,
);

export type LensStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** 1~16자. requestId에 들어가므로 짧게 둔다 */
export const LENS_ID_PATTERN = "^[a-z][a-z0-9-]{0,15}$";
/** "h" + 소문자 base32 13자. requestId 64자 상한 안에 들어간다 */
export const INQUIRY_ID_PATTERN = "^h[a-z2-7]{13}$";
export type InquiryId = string;

export interface HelmLens {
  id: string;
  title: string;
  status: LensStatus;
}
const lensShape = Type.Object({
  id: Type.String({ pattern: LENS_ID_PATTERN }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("running"),
    Type.Literal("done"),
    Type.Literal("failed"),
    Type.Literal("skipped"),
  ]),
});
export const HelmLensSchema: TUnsafe<HelmLens> = Type.Unsafe<HelmLens>(
  lensShape satisfies SchemaProof<HelmLens, typeof lensShape>,
);

export type Confidence = "low" | "medium" | "high";
const confidenceShape = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
]);
export const ConfidenceSchema: TUnsafe<Confidence> = Type.Unsafe<Confidence>(
  confidenceShape satisfies SchemaSound<Confidence, typeof confidenceShape>,
);

export interface HelmSource {
  origin: "web" | "knowledge" | "session";
  /** URL 또는 L2 지식 항목 참조 */
  ref: string;
  title?: string;
}
const sourceShape = Type.Object({
  origin: Type.Union([Type.Literal("web"), Type.Literal("knowledge"), Type.Literal("session")]),
  ref: Type.String({ minLength: 1, maxLength: 512 }),
  title: Type.Optional(Type.String({ maxLength: 80 })),
});
export const HelmSourceSchema: TUnsafe<HelmSource> = Type.Unsafe<HelmSource>(
  sourceShape satisfies SchemaProof<HelmSource, typeof sourceShape>,
);

export interface HelmFinding {
  /** `${lensId}-${n}`. 탐구 안에서 유일 */
  id: string;
  lensId: string;
  claim: string;
  sources: HelmSource[];
  confidence: Confidence;
  /** 후속 작업 후보 제목. 없으면 작업을 만들지 않는다 */
  followUp?: string;
}
const findingShape = Type.Object({
  id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,15}-[0-9]{1,3}$" }),
  lensId: Type.String({ pattern: LENS_ID_PATTERN }),
  claim: Type.String({ minLength: 1, maxLength: 1000 }),
  sources: Type.Array(HelmSourceSchema, { maxItems: 4 }),
  confidence: ConfidenceSchema,
  followUp: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});
export const HelmFindingSchema: TUnsafe<HelmFinding> = Type.Unsafe<HelmFinding>(
  findingShape satisfies SchemaProof<HelmFinding, typeof findingShape>,
);

export interface HelmPending {
  inquiryId: string;
  topic: string;
  source: "signal" | "command";
  signal?: HelmSignalKind;
}
const pendingShape = Type.Object({
  inquiryId: Type.String({ pattern: INQUIRY_ID_PATTERN }),
  topic: Type.String({ minLength: 1, maxLength: 500 }),
  source: Type.Union([Type.Literal("signal"), Type.Literal("command")]),
  signal: Type.Optional(HelmSignalKindSchema),
});
export const HelmPendingSchema: TUnsafe<HelmPending> = Type.Unsafe<HelmPending>(
  pendingShape satisfies SchemaProof<HelmPending, typeof pendingShape>,
);

export interface HelmWatch {
  errorKey: string | null;
  errorRun: number;
  callKey: string | null;
  callRun: number;
}
const watchShape = Type.Object({
  errorKey: Type.Union([Type.String({ maxLength: 96 }), Type.Null()]),
  errorRun: Type.Integer({ minimum: 0 }),
  callKey: Type.Union([Type.String({ maxLength: 96 }), Type.Null()]),
  callRun: Type.Integer({ minimum: 0 }),
});
export const HelmWatchSchema: TUnsafe<HelmWatch> = Type.Unsafe<HelmWatch>(
  watchShape satisfies SchemaProof<HelmWatch, typeof watchShape>,
);

export interface HelmState {
  phase: HelmPhase;
  inquiryId: string | null;
  topic: string | null;
  lenses: HelmLens[];
  findings: HelmFinding[];
  /** 1부터. idle이면 0 */
  round: number;
  appliedTurnId: string | null;
  pending: HelmPending | null;
  watch: HelmWatch;
  /** /helm stop이 켠다. drive가 다음 경계에서 읽는다 */
  stopRequested: boolean;
  /** 수렴 직전에 모은 지식 요약 참조. 적용 프롬프트가 쓴다 */
  context: HelmSource[];
}
const stateShape = Type.Object({
  phase: HelmPhaseSchema,
  inquiryId: Type.Union([Type.String({ pattern: INQUIRY_ID_PATTERN }), Type.Null()]),
  topic: Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
  lenses: Type.Array(HelmLensSchema, { maxItems: 8 }),
  findings: Type.Array(HelmFindingSchema, { maxItems: 24 }),
  round: Type.Integer({ minimum: 0 }),
  appliedTurnId: Type.Union([Type.String(), Type.Null()]),
  pending: Type.Union([HelmPendingSchema, Type.Null()]),
  watch: HelmWatchSchema,
  stopRequested: Type.Boolean(),
  context: Type.Array(HelmSourceSchema, { maxItems: 8 }),
});
export const HelmStateSchema: TUnsafe<HelmState> = Type.Unsafe<HelmState>(
  stateShape satisfies SchemaProof<HelmState, typeof stateShape>,
);

export const INITIAL_HELM_STATE: HelmState = {
  phase: "idle",
  inquiryId: null,
  topic: null,
  lenses: [],
  findings: [],
  round: 0,
  appliedTurnId: null,
  pending: null,
  watch: { errorKey: null, errorRun: 0, callKey: null, callRun: 0 },
  stopRequested: false,
  context: [],
};

/** F.extensions.spec §3.2 StateDecl에 넘기는 값 */
export const helmStateDecl: {
  readonly schema: typeof HelmStateSchema;
  readonly initial: HelmState;
  readonly version: 1;
} = {
  schema: HelmStateSchema,
  initial: INITIAL_HELM_STATE,
  version: HELM_STATE_VERSION,
};

/** 상태 문서 직렬화 예산. group-kit STATE_DOC_MAX_BYTES(64 KiB)에서 4 KiB를 남긴다 */
export const HELM_STATE_BUDGET_BYTES = 61_440;

const encoder = new TextEncoder();

function bytesOf(state: HelmState): number {
  return encoder.encode(JSON.stringify(state)).length;
}

const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 };

/** 줄일 차례: confidence가 낮은 발견부터, 같으면 뒤의 발견부터 */
function trimOrder(findings: readonly HelmFinding[]): readonly number[] {
  return findings
    .map((finding, index) => ({ index, rank: CONFIDENCE_RANK[finding.confidence] }))
    .toSorted((a, b) => a.rank - b.rank || b.index - a.index)
    .map((entry) => entry.index);
}

export interface FitDropped {
  readonly context: number;
  readonly sources: number;
  readonly findings: number;
}

/** 뺄 항목을 반영한 상태. 입력 상태는 바꾸지 않는다 */
function trimmed(
  state: HelmState,
  contextKept: number,
  strippedSources: ReadonlySet<number>,
  removedFindings: ReadonlySet<number>,
): HelmState {
  return {
    ...state,
    context: state.context.slice(0, contextKept),
    findings: state.findings.flatMap((finding, index) => {
      if (removedFindings.has(index)) return [];
      return [strippedSources.has(index) ? { ...finding, sources: [] } : finding];
    }),
  };
}

/**
 * 순수 함수. 직렬화 UTF-8 크기가 HELM_STATE_BUDGET_BYTES 이하가 되도록 줄인다. 줄일 필요가 없으면 같은 값.
 * 순서: (1) context를 뒤에서부터 뺀다 (2) confidence가 낮은 발견부터, 같으면 뒤의 발견부터 sources를 뺀다
 * (3) 같은 순서로 발견을 뺀다. 각 단계는 예산 안에 들면 멈춘다
 */
export function fitState(state: HelmState): {
  readonly state: HelmState;
  readonly dropped: FitDropped;
} {
  const fits = (candidate: HelmState): boolean => bytesOf(candidate) <= HELM_STATE_BUDGET_BYTES;
  if (fits(state)) return { state, dropped: { context: 0, sources: 0, findings: 0 } };
  const none: ReadonlySet<number> = new Set();
  const order = trimOrder(state.findings);
  let contextKept = state.context.length;
  while (contextKept > 0 && !fits(trimmed(state, contextKept, none, none))) contextKept -= 1;
  const droppedContext = state.context.length - contextKept;
  const stripped = new Set<number>();
  let droppedSources = 0;
  for (const index of order) {
    if (fits(trimmed(state, contextKept, stripped, none))) break;
    const count = state.findings[index]?.sources.length ?? 0;
    if (count === 0) continue;
    stripped.add(index);
    droppedSources += count;
  }
  const removed = new Set<number>();
  for (const index of order) {
    if (fits(trimmed(state, contextKept, stripped, removed))) break;
    removed.add(index);
  }
  return {
    state: trimmed(state, contextKept, stripped, removed),
    dropped: { context: droppedContext, sources: droppedSources, findings: removed.size },
  };
}

export type StateWriteFailure = Extract<
  HelmFailure,
  { kind: "state_conflict" | "state_too_large" | "storage" | "disabled" }
>;

/** scope마다 하나인 직렬 큐. 같은 scope의 updateState가 앞선 커밋을 덮지 않게 한다 */
const queues = new WeakMap<object, Promise<void>>();

type StateApi = Pick<ScopeApi<HelmState>, "state" | "commit">;

async function commitOnce(
  g: StateApi,
  f: (current: Readonly<HelmState>) => HelmState,
): Promise<Result<Readonly<HelmState>, StateWriteFailure>> {
  const next = f(g.state());
  const checked = parse(HelmStateSchema, next);
  if (!checked.ok)
    throw new Bug("helm.update_state: the update produced a state outside HelmStateSchema");
  const fitted = fitState(next).state;
  const committed = await attemptAsync(() => g.commit(fitted));
  if (committed.ok) return ok(committed.value);
  const failure = failureOf(committed.error.cause, {});
  if (
    failure === undefined ||
    (failure.kind !== "state_conflict" &&
      failure.kind !== "state_too_large" &&
      failure.kind !== "storage" &&
      failure.kind !== "disabled")
  ) {
    return rethrow(committed.error.cause);
  }
  return err(failure);
}

/**
 * 모든 상태 쓰기의 단일 경로. g.state() 읽기, fitState, g.commit을 직렬 큐로 묶는다(L3.helm.spec §4.1).
 * `state_conflict`는 상태를 다시 읽어 한 번 더 시도하고, 두 번째도 충돌이면 실패 값으로 돌려준다
 */
export async function updateState(
  g: StateApi,
  f: (current: Readonly<HelmState>) => HelmState,
): Promise<Result<Readonly<HelmState>, StateWriteFailure>> {
  const previous = queues.get(g) ?? Promise.resolve();
  const run = previous.then(() =>
    attemptAsync(async () => {
      const first = await commitOnce(g, f);
      if (first.ok || first.error.kind !== "state_conflict") return first;
      return commitOnce(g, f);
    }),
  );
  queues.set(
    g,
    run.then(() => undefined),
  );
  const settled = await run;
  if (!settled.ok) return rethrow(settled.error.cause);
  return settled.value;
}

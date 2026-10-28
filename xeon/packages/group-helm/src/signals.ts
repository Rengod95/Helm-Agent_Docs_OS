import { assertNever, canonicalJson } from "@xeon/contracts";
import type { JsonValue } from "@xeon/contracts/conversation";
import type { GroupApi } from "@xeon/group-kit";
import { jsonOf, type SignalDetectedPayload } from "./records.ts";
import type { AutoStart, HelmSettings } from "./settings.ts";
import type { HelmPending, HelmSignalKind, HelmState, HelmWatch } from "./state.ts";
import { updateState } from "./state.ts";
import { postRequestId, suggestionNotice } from "./prompts.ts";

/** 고정 임계(L3.helm.spec §3.5). 설정으로 노출하지 않는다(§10 미결 8) */
export const SIGNAL_DEFAULTS: {
  readonly stuckErrorRun: 3;
  readonly repeatCallRun: 3;
  readonly newDomainMisses: 2;
} = { stuckErrorRun: 3, repeatCallRun: 3, newDomainMisses: 2 };

export type SignalThresholds = typeof SIGNAL_DEFAULTS;

/** 지식 검색 모델 도구의 이름. `tool.execution.after` 페이로드에는 능력 참조가 없어 이름으로 알아본다 */
const KNOWLEDGE_SEARCH_TOOL = "knowledge_search";

const TERMS_MAX = 16;
const TERM_LENGTH_MAX = 64;

/** `tool.execution.after` 페이로드에서 Helm이 읽는 필드 */
export interface ToolExecutionEndView {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly isError: boolean;
  readonly result: unknown;
  readonly input?: Readonly<Record<string, JsonValue>>;
}

interface SignalEvidence {
  readonly toolName?: string;
  readonly count: number;
}

/**
 * turn 하나 동안 on 핸들러가 프로세스 메모리에 모으는 값. 상태 문서에 넣지 않는다(L3.helm.spec §4.3).
 * 지점 페이로드에 turnId가 없는 지점(`tool.execution.after`)이 있어 thread별로 두고, turnId는 `boundary.settle.after`에서 받는다
 */
export interface HelmTurnTally {
  /** 커밋된 watch에서 시작해 이 turn의 도구 결과로 갱신한 값 */
  readonly watch: HelmWatch;
  /** 이미 반영한 toolCallId. 같은 페이로드의 재실행을 한 번으로 센다 */
  readonly seenToolCallIds: readonly string[];
  readonly knowledgeMisses: number;
  /** 이 turn 사용자 입력에서 뽑은 분야 용어 후보 */
  readonly promptTerms: readonly string[];
  /** 이 turn에서 넘은 신호. 중복 없이 최대 3개 */
  readonly crossed: readonly HelmSignalKind[];
  readonly evidence: Readonly<Partial<Record<HelmSignalKind, SignalEvidence>>>;
}

export function openTally(watch: Readonly<HelmWatch>): HelmTurnTally {
  return {
    watch,
    seenToolCallIds: [],
    knowledgeMisses: 0,
    promptTerms: [],
    crossed: [],
    evidence: {},
  };
}

// ── 해시 ──────────────────────────────────────────────────────────────────

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** 순수 함수. FNV-1a 64비트(UTF-8 바이트) */
function fnv1a64(text: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
  }
  return hash;
}

function base32Of(value: bigint): string {
  let rest = value;
  let out = "";
  for (let index = 0; index < 13; index += 1) {
    out = `${BASE32[Number(rest & 31n)] ?? "a"}${out}`;
    rest >>= 5n;
  }
  return out;
}

// ── 순수 판정 함수 ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstTextOf(result: unknown): string {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return "";
  const content: unknown = result["content"];
  if (!Array.isArray(content)) return "";
  const parts: readonly unknown[] = content;
  for (const part of parts) {
    if (!isRecord(part)) continue;
    const text = part["text"];
    if (typeof text === "string") return text;
  }
  return "";
}

/** 오류 요약 다이제스트. 줄 번호, 해시, 임시 경로만 다른 오류 문장을 같은 오류로 센다 */
export function errorDigestOf(result: unknown): string {
  const normalized = firstTextOf(result)
    .replace(/(["'])[^"'\n]*\/[^"'\n]*\1/gu, "#")
    .replace(/\b[0-9a-f]{8,}\b/giu, "#")
    .replace(/\d+/gu, "#")
    .slice(0, 200);
  return fnv1a64(normalized).toString(16);
}

function inputDigestOf(input: Readonly<Record<string, JsonValue>>): string {
  return fnv1a64(canonicalJson(input)).toString(16);
}

function hitCountOf(result: unknown): number | undefined {
  if (!isRecord(result)) return undefined;
  const structured = result["structuredContent"];
  if (!isRecord(structured)) return undefined;
  const hits: unknown = structured["hits"];
  return Array.isArray(hits) ? hits.length : undefined;
}

const KEY_TOOL_MAX = 64;

function keyOf(toolName: string, digest: string): string {
  return `${toolName.slice(0, KEY_TOOL_MAX)}:${digest}`;
}

function crossedWith(
  tally: HelmTurnTally,
  signal: HelmSignalKind,
  evidence: SignalEvidence,
): HelmTurnTally {
  if (tally.crossed.includes(signal)) return tally;
  return {
    ...tally,
    crossed: [...tally.crossed, signal],
    evidence: { ...tally.evidence, [signal]: evidence },
  };
}

/** 순수 함수. 집계표를 갱신하고 넘은 신호를 crossed에 더한다. seenToolCallIds에 있는 호출은 그대로 돌려준다 */
export function observeToolEnd(
  tally: Readonly<HelmTurnTally>,
  end: ToolExecutionEndView,
  thresholds: SignalThresholds,
): HelmTurnTally {
  if (tally.seenToolCallIds.includes(end.toolCallId)) return tally;
  let next: HelmTurnTally = {
    ...tally,
    seenToolCallIds: [...tally.seenToolCallIds, end.toolCallId],
  };
  let { errorKey, errorRun, callKey, callRun } = tally.watch;
  if (end.isError) {
    const key = keyOf(end.toolName, errorDigestOf(end.result));
    errorRun = errorKey === key ? errorRun + 1 : 1;
    errorKey = key;
    if (errorRun === thresholds.stuckErrorRun) {
      next = crossedWith(next, "stuck", { toolName: end.toolName, count: errorRun });
    }
  } else {
    errorKey = null;
    errorRun = 0;
  }
  if (end.input !== undefined) {
    const key = keyOf(end.toolName, inputDigestOf(end.input));
    callRun = callKey === key ? callRun + 1 : 1;
    callKey = key;
    if (callRun === thresholds.repeatCallRun) {
      next = crossedWith(next, "repeat", { toolName: end.toolName, count: callRun });
    }
  }
  const misses =
    end.toolName === KNOWLEDGE_SEARCH_TOOL && !end.isError && hitCountOf(end.result) === 0
      ? next.knowledgeMisses + 1
      : next.knowledgeMisses;
  return { ...next, knowledgeMisses: misses, watch: { errorKey, errorRun, callKey, callRun } };
}

/** 순수 함수. turn 정착 때 newDomain을 판정하고, 커밋할 watch와 이 turn에 넘은 신호 전체를 돌려준다 */
export function settleTurn(
  tally: Readonly<HelmTurnTally>,
  thresholds: SignalThresholds,
): {
  readonly watch: HelmWatch;
  readonly crossed: readonly HelmSignalKind[];
  readonly evidence: HelmTurnTally["evidence"];
} {
  const domain =
    tally.knowledgeMisses >= thresholds.newDomainMisses ||
    (tally.knowledgeMisses >= 1 && tally.promptTerms.length >= 1);
  const settled = domain
    ? crossedWith({ ...tally }, "newDomain", {
        count: tally.knowledgeMisses,
      })
    : tally;
  return { watch: settled.watch, crossed: settled.crossed, evidence: settled.evidence };
}

/** 순수 함수. 결정적 inquiryId. "h" + base32(fnv1a64(seed)) 13자 */
export function inquiryIdFrom(seed: string): string {
  return `h${base32Of(fnv1a64(seed))}`;
}

const STOPWORDS: ReadonlySet<string> = new Set([
  "그리고",
  "하지만",
  "그러나",
  "때문에",
  "그래서",
  "합니다",
  "입니다",
  "있습니다",
  "해주세요",
  "해줘",
  "알려줘",
  "어떻게",
  "무엇",
  "이것",
  "저것",
  "그것",
  "우리",
  "여기",
  "거기",
  "지금",
  "다시",
  "그냥",
  "정말",
  "매우",
  "아주",
  "조금",
  "이런",
  "저런",
  "그런",
  "대한",
  "위해",
  "통해",
  "하는",
  "하고",
  "했다",
  "한다",
  "있는",
  "없는",
  "같은",
  "이다",
  "있다",
  "없다",
  "된다",
  "되는",
  "경우",
  "사용",
  "방법",
  "문제",
  "관련",
  "정도",
  "내용",
  "부분",
  "가능",
  "필요",
  "확인",
  "생각",
]);

/** 순수 함수. 사용자 입력에서 분야 용어 후보를 뽑는다(L3.helm.spec §3.5 규칙) */
export function extractTerms(prompt: string): readonly string[] {
  const found: string[] = [];
  for (const match of prompt.matchAll(/`([^`\n]+)`/gu)) found.push((match[1] ?? "").trim());
  for (const match of prompt.matchAll(/\b[A-Z][A-Z0-9]+\b/gu)) found.push(match[0]);
  for (const match of prompt.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/gu)) found.push(match[0]);
  for (const match of prompt.matchAll(/\b[A-Za-z]+(?:-[A-Za-z]+)+\b/gu)) found.push(match[0]);
  for (const match of prompt.matchAll(/[가-힣]{3,}/gu)) {
    if (!STOPWORDS.has(match[0])) found.push(match[0]);
  }
  const unique: string[] = [];
  for (const term of found) {
    const normalized = term.toLowerCase().slice(0, TERM_LENGTH_MAX);
    if (normalized !== "" && !unique.includes(normalized)) unique.push(normalized);
  }
  return unique.slice(0, TERMS_MAX);
}

function topicOf(
  crossed: readonly HelmSignalKind[],
  evidence: HelmTurnTally["evidence"],
  terms: readonly string[],
): string {
  const head = terms.slice(0, 3).join(", ");
  const first = crossed[0];
  const tool = first === undefined ? undefined : evidence[first]?.toolName;
  if (first === "newDomain" || tool === undefined) return head === "" ? "새 분야 탐구" : head;
  return `${tool}: ${head}`.replace(/: $/u, "").slice(0, 500);
}

export interface SignalSeed {
  readonly turnId: string;
  readonly evidence: HelmTurnTally["evidence"];
  readonly terms: readonly string[];
}

/** 순수 함수. 신호와 autoStart로 할 일을 정한다(L3.helm.spec §4.3 표) */
export function decideAction(
  state: Readonly<HelmState>,
  crossed: readonly HelmSignalKind[],
  autoStart: AutoStart,
  seed: SignalSeed,
): { readonly action: SignalDetectedPayload["action"]; readonly pending?: HelmPending } {
  const first = crossed[0];
  if (first === undefined || state.phase !== "idle" || state.pending !== null) {
    return { action: "recorded" };
  }
  switch (autoStart) {
    case "off":
      return { action: "recorded" };
    case "suggest":
      return { action: "suggested" };
    case "auto":
      return {
        action: "requested",
        pending: {
          inquiryId: inquiryIdFrom(seed.turnId),
          topic: topicOf(crossed, seed.evidence, seed.terms),
          source: "signal",
          signal: first,
        },
      };
    default:
      return assertNever(autoStart, "decideAction");
  }
}

// ── tap 핸들러 ────────────────────────────────────────────────────────────

/** thread별 집계표. 프로세스 메모리에만 둔다. 크래시로 잃으면 그 turn의 신호가 한 turn 늦어진다 */
export type TallyStore = Map<string, HelmTurnTally>;

function tallyOf(store: TallyStore, threadId: string, state: Readonly<HelmState>): HelmTurnTally {
  return store.get(threadId) ?? openTally(state.watch);
}

type SignalApi = Pick<GroupApi<HelmState>, "state" | "commit" | "record" | "post">;

/** `tool.execution.after` tap. 메모리 집계만 하고 커밋·기록은 하지 않는다 */
export function observeTool(
  tallies: TallyStore,
): (
  end: ToolExecutionEndView,
  ctx: { readonly threadId: string; readonly state: Readonly<HelmState> },
) => void {
  return (end, ctx) => {
    tallies.set(
      ctx.threadId,
      observeToolEnd(tallyOf(tallies, ctx.threadId, ctx.state), end, SIGNAL_DEFAULTS),
    );
  };
}

/**
 * `boundary.settle.after` tap. newDomain을 판정하고 신호를 기록하며 turn당 한 번 커밋한다.
 * 같은 페이로드로 다시 실행돼도 기록은 X 멱등 키로, 알림은 requestId로 한 번만 난다
 */
export function settle(
  g: SignalApi,
  tallies: TallyStore,
  settings: () => HelmSettings,
): (
  payload: { readonly turnId: string },
  ctx: { readonly threadId: string; readonly state: Readonly<HelmState> },
) => Promise<void> {
  return async (payload, ctx) => {
    const tally = tallyOf(tallies, ctx.threadId, ctx.state);
    const { watch, crossed, evidence } = settleTurn(tally, SIGNAL_DEFAULTS);
    tallies.delete(ctx.threadId);
    const decided = decideAction(ctx.state, crossed, settings().autoStart, {
      turnId: payload.turnId,
      evidence,
      terms: tally.promptTerms,
    });
    await Promise.all(
      crossed.map((signal) => {
        const found = evidence[signal];
        const detected: SignalDetectedPayload = {
          signal,
          turnId: payload.turnId,
          evidence: {
            ...(found?.toolName === undefined ? {} : { toolName: found.toolName }),
            count: found?.count ?? 1,
            ...(tally.promptTerms.length === 0 ? {} : { terms: tally.promptTerms.slice(0, 8) }),
          },
          action: decided.action,
          inquiryId:
            decided.pending?.inquiryId ?? ctx.state.pending?.inquiryId ?? ctx.state.inquiryId,
        };
        return g.record(
          "grp.helm.signal.detected",
          { type: "turn", id: payload.turnId },
          jsonOf(detected),
        );
      }),
    );
    if (decided.action === "suggested") {
      await g.post(suggestionNotice(crossed), {
        when: "next",
        requestId: postRequestId(inquiryIdFrom(payload.turnId), "idle", 0),
      });
    }
    const pending = decided.pending;
    const written = await updateState(g, (current) => ({
      ...current,
      watch,
      ...(pending !== undefined && current.phase === "idle" && current.pending === null
        ? { pending }
        : {}),
    }));
    // 쓰기에 실패하면 이 turn의 연속 횟수는 커밋되지 않는다. 다음 turn이 커밋된 watch에서 다시 센다(L3.helm.spec §5 10번)
    if (!written.ok) return;
  };
}

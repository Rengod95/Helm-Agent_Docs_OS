import { parse } from "@fresnel/contracts";
import type { StatusItem } from "@fresnel/contracts/capabilities";
import { TurnCompletedPayloadSchema } from "@fresnel/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
} from "@fresnel/contracts/records";
import type { DurableEventEnvelope } from "@fresnel/contracts/records";

// L2.dialog.spec §4.4 내장 세그먼트. 내구 이벤트와 도구 실행 지점에서 계산하는 순수 함수다.

export const TURN_SEGMENT = "core.turn";
export const TOOLS_SEGMENT = "core.tools";
export const USAGE_SEGMENT = "core.usage";

const MAX_TOOL_NAMES = 3;

/** 스레드 하나의 내장 세그먼트 상태 */
export interface CoreState {
  readonly turn: "idle" | "running" | "approval" | "question";
  /** 아직 해결되지 않은 승인 요청의 종류. 해결 이벤트의 approvalId로 찾는다 */
  readonly pending: ReadonlyMap<string, "approval" | "question">;
  /** 실행 중인 도구 호출 id → 도구 이름 */
  readonly tools: ReadonlyMap<string, string>;
  readonly usage: { readonly tokens: number; readonly cost: number };
  /** 마지막으로 처리한 내구 이벤트 seq. 같은 이벤트가 두 번 와도 한 번만 센다 */
  readonly seq: number;
}

export function initialCoreState(): CoreState {
  return {
    turn: "idle",
    pending: new Map(),
    tools: new Map(),
    usage: { tokens: 0, cost: 0 },
    seq: 0,
  };
}

function turnFrom(
  state: CoreState,
  pending: ReadonlyMap<string, "approval" | "question">,
): CoreState["turn"] {
  const kinds = new Set(pending.values());
  if (kinds.has("question")) return "question";
  if (kinds.has("approval")) return "approval";
  return state.turn === "approval" || state.turn === "question" ? "running" : state.turn;
}

/** 내구 이벤트 하나를 반영한다. 모르는 종류와 이미 본 seq는 상태를 그대로 돌려준다 */
export function reduceCore(state: CoreState, event: DurableEventEnvelope): CoreState {
  if (event.seq <= state.seq) return state;
  const base = { ...state, seq: event.seq };
  if (event.kind === "turn.started") return { ...base, turn: "running" };
  if (event.kind === "turn.completed") {
    const payload = parse(TurnCompletedPayloadSchema, event.payload);
    const usage = payload.ok ? payload.value.usage : null;
    return {
      ...base,
      turn: "idle",
      pending: new Map(),
      tools: new Map(),
      usage:
        usage === null
          ? state.usage
          : {
              tokens: state.usage.tokens + usage.totalTokens,
              cost: state.usage.cost + usage.cost.total,
            },
    };
  }
  if (event.kind === "approval.requested") {
    const payload = parse(ApprovalRequestedPayloadSchema, event.payload);
    const kind = payload.ok && payload.value.body.kind === "question" ? "question" : "approval";
    const pending = new Map(state.pending).set(event.id, kind);
    return { ...base, pending, turn: turnFrom(base, pending) };
  }
  if (event.kind === "approval.resolved") {
    const payload = parse(ApprovalResolvedPayloadSchema, event.payload);
    if (!payload.ok) return base;
    const pending = new Map(state.pending);
    pending.delete(payload.value.approvalId);
    return { ...base, pending, turn: turnFrom(base, pending) };
  }
  // 내장 세그먼트가 보지 않는 이벤트는 상태를 바꾸지 않는다
  return state;
}

/** 도구 실행이 시작되었다(`tool.execution.before` 지점) */
export function toolStarted(state: CoreState, toolCallId: string, toolName: string): CoreState {
  return { ...state, tools: new Map(state.tools).set(toolCallId, toolName) };
}

/** 도구 실행이 끝났다(`tool.execution.after` 지점) */
export function toolEnded(state: CoreState, toolCallId: string): CoreState {
  const tools = new Map(state.tools);
  tools.delete(toolCallId);
  return { ...state, tools };
}

type Tone = "normal" | "busy" | "warn" | "error";

/**
 * `text`는 키를 모르는 소비자(CLI, 옛 클라이언트)를 위한 글이고, 클라이언트는 `textKey`를 현재 로케일로 푼다
 * (키의 정본은 클라이언트 메시지 카탈로그 `desktop.status.core.*`).
 */
const TURN_TEXT: Readonly<
  Record<CoreState["turn"], { text: string; textKey: string; tone: Tone }>
> = {
  idle: { text: "대기", textKey: "desktop.status.core.turn.idle", tone: "normal" },
  running: { text: "실행 중", textKey: "desktop.status.core.turn.running", tone: "busy" },
  approval: { text: "승인 대기", textKey: "desktop.status.core.turn.approval", tone: "warn" },
  question: { text: "질문 대기", textKey: "desktop.status.core.turn.question", tone: "warn" },
};

/** 사용량 칸의 키. 인자는 숫자(`tokens`, `usd`)이고 모양은 클라이언트가 로케일에 맞게 만든다 */
export const USAGE_TEXT_KEY = "desktop.status.core.usage";

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/** 비용. 0이거나 1센트 이상이면 소수 둘, 그 밑이면 소수 넷이다. 0.0001 밑은 "< $0.0001"이다 */
export function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.0001) return "< $0.0001";
  return `$${usd.toFixed(usd === 0 || usd >= 0.01 ? 2 : 4)}`;
}

/** 상태에서 내장 세그먼트 셋을 만든다. 보여 줄 내용이 없는 세그먼트는 null이다 */
export function coreItems(state: CoreState): {
  readonly turn: StatusItem | null;
  readonly tools: StatusItem | null;
  readonly usage: StatusItem | null;
} {
  const seen = state.seq > 0;
  const turnText = TURN_TEXT[state.turn];
  const names = [...new Set(state.tools.values())];
  const shown = names.slice(0, MAX_TOOL_NAMES).join(", ");
  const more = names.length > MAX_TOOL_NAMES ? ` +${names.length - MAX_TOOL_NAMES}` : "";
  const hasUsage = state.usage.tokens > 0 || state.usage.cost > 0;
  return {
    turn: seen
      ? {
          id: TURN_SEGMENT,
          text: turnText.text,
          textKey: turnText.textKey,
          tone: turnText.tone,
          order: 100,
        }
      : null,
    tools:
      names.length === 0
        ? null
        : { id: TOOLS_SEGMENT, text: `${shown}${more}`, tone: "busy", order: 110 },
    usage: hasUsage
      ? {
          id: USAGE_SEGMENT,
          text: `턴 합계 ${formatTokens(state.usage.tokens)} 토큰 · ${formatCost(state.usage.cost)}`,
          textKey: USAGE_TEXT_KEY,
          textArgs: { tokens: state.usage.tokens, usd: state.usage.cost },
          tone: "normal",
          order: 120,
        }
      : null,
  };
}

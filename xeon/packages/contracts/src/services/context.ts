import type { Result } from "../base/index.ts";
import type { OrderedTool, ToolsetFingerprint } from "../capabilities/index.ts";
import type {
  AgentMessage,
  AssistantMessage,
  EventId,
  JsonValue,
  Message,
  StepId,
  SystemMessage,
  ThreadId,
  TurnId,
  Usage,
} from "../conversation/index.ts";
import type { PortKey } from "../extensions/index.ts";
import type { CacheMarks, CachePolicy, ContextUsageEstimate, ModelBinding } from "./models.ts";

// L1.context.spec §3.1. 구현은 core-context다. 컴팩션 내부 타입(§3.2)은 core-context 안에 둔다.

export const ContextServiceName = "xeon.context" as const;

/** `xeon.context` 전체 모양(ContextService)의 포트 키. 제공 core-context */
export const ContextPortKey: PortKey<ContextService> = { name: ContextServiceName };

export interface AssembleOptions {
  /** 이번 단계 바인딩(체크포인트 고정값). 모델 전환 경고와 창 크기에 쓴다 */
  readonly binding: ModelBinding;
  readonly contextWindow: number;
  /** xeon.models가 해석 때 낸 정책 */
  readonly cachePolicy: CachePolicy;
  /** 이번 단계 도구 집합. core-tools가 orderTools로 정렬해 넘긴다 */
  readonly tools: readonly OrderedTool[];
  /** 기본 시스템 프롬프트 */
  readonly basePrompt: string;
  /** context 계층 절. before_agent_start 결과(L1.loop). 키는 절 이름 */
  readonly sections: Readonly<Record<string, string>>;
  /** volatile 계층. 단계마다 바뀐다 */
  readonly volatile: Readonly<Record<string, string>>;
  readonly turnId: TurnId;
  readonly stepId: StepId;
  readonly signal?: AbortSignal;
}

export interface PrefixInfo {
  /** 접두 SystemMessage를 정규화 JSON으로 만든 sha256 hex */
  readonly prefixHash: string;
  readonly toolset: ToolsetFingerprint;
  /** 접두를 담은 system item의 이벤트. 아직 커밋 전이면 null */
  readonly recordedAt: EventId | null;
}

export type ToolChangeDecision =
  | { readonly action: "append"; readonly added: number; readonly removed: number }
  | { readonly action: "defer"; readonly firstChangedIndex: number }
  | {
      readonly action: "readvertise";
      readonly reason: "first_request" | "compaction" | "explicit";
      readonly firstChangedIndex: number | null;
    };

export interface PendingSystemItem {
  readonly purpose: "prefix" | "tool_change" | "sections";
  readonly message: SystemMessage;
}

export type ContextWarning =
  | {
      readonly code: "cache_reset_model_switch";
      readonly from: ModelBinding;
      readonly to: ModelBinding;
    }
  | { readonly code: "cache_prefix_reset"; readonly at: number | null }
  | {
      readonly code: "tools_deferred";
      readonly added: readonly string[];
      readonly removed: readonly string[];
    }
  | { readonly code: "near_window"; readonly tokens: number; readonly contextWindow: number };

export interface AssembledContext {
  /** pi-ai Context.messages로 그대로 넘긴다. [0]은 고정 접두 SystemMessage */
  readonly messages: readonly Message[];
  readonly prefix: PrefixInfo;
  /** 이번 조립에서 접두 뒤에 새로 둔 도구 변경. 없으면 null */
  readonly toolChange: ToolChangeDecision | null;
  readonly cacheMarks: CacheMarks;
  readonly estimate: ContextUsageEstimate;
  readonly compactionHead: {
    readonly eventId: EventId;
    readonly firstKeptEventId: EventId;
  } | null;
  /** 이번 조립에서 새로 커밋해야 할 system item 초안(접두 고정, 도구 변경, 절 갱신). loop가 단계 커밋에 넣는다 */
  readonly pendingItems: readonly PendingSystemItem[];
  readonly warnings: readonly ContextWarning[];
}

export type CompactReason = "manual" | "threshold" | "overflow";

export interface CompactRequest {
  readonly reason: CompactReason;
  readonly binding: ModelBinding;
  readonly contextWindow: number;
  /** 사용자가 /compact 뒤에 적은 지침 */
  readonly instructions?: string;
  /** overflow 복구일 때 실패한 단계 */
  readonly stepId?: StepId;
  readonly willRetry: boolean;
  readonly signal?: AbortSignal;
}

export type CompactOutcome =
  | {
      readonly status: "compacted";
      readonly eventId: EventId;
      readonly tokensBefore: number;
      readonly fromExtension: string | null;
    }
  | {
      readonly status: "skipped";
      readonly why: "nothing_to_summarize" | "last_entry_is_compaction" | "disabled";
    }
  | { readonly status: "cancelled"; readonly by: string; readonly reason: string };

export interface CompactCheck {
  readonly should: boolean;
  readonly tokens: number;
  /** contextWindow - reserveTokens */
  readonly threshold: number;
}

export type OverflowRecovery =
  | { readonly action: "retry"; readonly compactedEventId: EventId }
  | {
      readonly action: "fail";
      readonly reason:
        | "second_overflow"
        | "compaction_failed"
        | "compaction_cancelled"
        | "disabled";
    };

/** fromEventId를 뺀 세 필드가 L1.persistence.spec §3.8 BranchSummaryInput과 같다 */
export interface BranchSummaryDraft {
  readonly fromEventId: EventId;
  readonly summary: string;
  readonly details: JsonValue | null;
  readonly usage: Usage | null;
}

export type ContextErrorKind =
  | "branch_not_found"
  /** 세션 읽기 실패(읽기 연결의 busy, io, 손상 행) */
  | "read_failed"
  | "projection_failed"
  | "summary_failed"
  | "summary_has_tool_call"
  | "summary_truncated"
  | "commit_failed"
  | "aborted";

export interface ContextError {
  readonly kind: ContextErrorKind;
  readonly message: string;
}

export interface ContextService {
  /** leaf까지의 가지로 모델 요청 컨텍스트를 만든다. 같은 이벤트·도구·절이면 같은 바이트를 낸다. 커밋하지 않는다 */
  assemble(
    threadId: ThreadId,
    leaf: EventId,
    opts: AssembleOptions,
  ): Promise<Result<AssembledContext, ContextError>>;
  /** 컴팩션 한 번. thread.compacted를 커밋하거나, 거부·실패를 돌려준다 */
  compact(
    threadId: ThreadId,
    request: CompactRequest,
  ): Promise<Result<CompactOutcome, ContextError>>;
  /** 임계 검사. 모델 호출 없이 계산한다 */
  shouldCompact(threadId: ThreadId, leaf: EventId, binding: ModelBinding): Promise<CompactCheck>;
  /** 메시지 배열의 토큰 추정. xeon.models TokenEstimator에 위임한다 */
  estimate(messages: readonly Message[]): ContextUsageEstimate;
  /** agent-core AgentLoopConfig.convertToLlm에 넣는 변환. 던지지 않는다 */
  convertToLlm(messages: readonly AgentMessage[]): Message[];
  /** 오버플로우 종결 메시지를 받아 단계당 한 번 컴팩션한다 */
  recoverOverflow(
    threadId: ThreadId,
    stepId: StepId,
    failed: AssistantMessage,
    binding: ModelBinding,
  ): Promise<OverflowRecovery>;
  /** 떠난 가지 요약 초안을 만든다. 커밋은 하지 않는다 */
  summarizeBranch(
    threadId: ThreadId,
    from: EventId,
    to: EventId,
    opts?: { readonly instructions?: string; readonly signal?: AbortSignal },
  ): Promise<Result<BranchSummaryDraft, ContextError>>;
}

import { Type, type TUnsafe } from "typebox";
import type { EventId, ItemId, ThreadId, TurnId, Usage } from "../conversation/index.ts";
import type {
  LeaseId,
  PostWhen,
  RecordKind,
  ScopeId,
  SpawnOutcome,
  SpawnSpec,
} from "../extensions/index.ts";
import { PolicyRuleSchema, type CallerId, type PermissionMode, type PolicyRule } from "./tools.ts";

// L1.agents.spec §3. 구현은 core-agents다. 값 타입은 AgentService와 같은 파일에 둔다(F.capabilities.spec §3.12 규칙 3).

export const AgentServiceName = "xeon.agents" as const;

// ── 정의 ─────────────────────────────────────────────────────────────────

/** 정의 이름. CallerId "subagent:<이름>"에 들어간다 */
export const AGENT_NAME_PATTERN: string = "^[a-z][a-z0-9-]{1,47}$";

export interface AgentPermissions {
  /** 자식 모드 요청. 부모 모드보다 느슨할 수 없다 */
  readonly mode?: PermissionMode;
  /** 정의가 더하는 규칙. extension 티어로 평가한다. allow는 부모 결정을 넓히지 못한다 */
  readonly rules?: readonly PolicyRule[];
}

export type AgentDefinitionSource =
  | { readonly kind: "builtin" }
  | { readonly kind: "extension"; readonly extension: string; readonly path: string }
  | { readonly kind: "user"; readonly path: string }
  | { readonly kind: "project"; readonly path: string };

export interface AgentDefinition {
  readonly name: string;
  readonly description: string;
  /** 시스템 프롬프트 본문 */
  readonly prompt: string;
  /** 허용 도구 이름 glob. 생략하면 부모 광고 목록 전체 */
  readonly tools?: readonly string[];
  /** ModelRole 이름이면 그 역할, 그 밖의 값은 subagent 역할의 RoleOverrides.ref. 생략하면 "subagent" */
  readonly model?: string;
  readonly permissions?: AgentPermissions;
  /** 정의 출처 */
  readonly source: AgentDefinitionSource;
}

/** 정의 파일 프런트매터 검증(출처는 파일 위치가 정하므로 스키마에 없다) */
export const AgentDefinitionSchema: TUnsafe<Omit<AgentDefinition, "source">> = Type.Unsafe<
  Omit<AgentDefinition, "source">
>(
  Type.Object(
    {
      name: Type.String({ pattern: AGENT_NAME_PATTERN, maxLength: 48 }),
      description: Type.String({ minLength: 1, maxLength: 1000 }),
      prompt: Type.String({ minLength: 1, maxLength: 200_000 }),
      tools: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 }),
      ),
      model: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      permissions: Type.Optional(
        Type.Object(
          {
            mode: Type.Optional(
              Type.Union([
                Type.Literal("default"),
                Type.Literal("acceptEdits"),
                Type.Literal("plan"),
                Type.Literal("bypass"),
              ]),
            ),
            rules: Type.Optional(Type.Array(PolicyRuleSchema, { maxItems: 128 })),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
);

// ── 생성 입력과 결과 ─────────────────────────────────────────────────────

/** 자식을 만든 쪽. 소유 간선과 requestId 파생의 근거 */
export type SpawnOwner =
  | { readonly kind: "tool"; readonly turnId: TurnId; readonly toolCallId: string }
  | {
      readonly kind: "drive";
      readonly turnId: TurnId | null;
      readonly scopeId: ScopeId;
      readonly leaseId: LeaseId;
    }
  /** 그룹 위임(GroupApi.delegate) */
  | { readonly kind: "scope"; readonly scopeId: ScopeId };

export interface SpawnOrigin {
  readonly parentThreadId: ThreadId;
  readonly owner: SpawnOwner;
  /** 부모 대화의 호출 주체 */
  readonly caller: CallerId;
  /** 부모 대화의 깊이 */
  readonly depth: number;
  /** 이 소유 작업의 requestId. 자식 requestId 파생에 쓴다 */
  readonly ownerRequestId: string;
  readonly signal: AbortSignal;
}

/** 부모 이력의 어디까지를 자식에 복제할지(F.records.spec §4.6 fork). 생략하면 빈 대화에서 시작 */
export type ForkPoint =
  | { readonly at: "event"; readonly eventId: EventId }
  | { readonly at: "item"; readonly itemId: ItemId };

export interface ChildToolPolicy {
  /** 정의 tools와 교집합을 낸다. 넓히지 못한다 */
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
  /** 참이면 부모 광고 목록을 그대로 쓰고 실행 시점에만 거른다(캐시 접두 공유) */
  readonly keepParentList?: boolean;
  /** 허용 밖 호출의 거부 문장에 붙일 안내 */
  readonly denyHint?: string;
}

export interface ChildLimits {
  readonly maxSteps?: number;
  readonly maxInputTokens?: number;
}

/** F SpawnSpec에 L1이 받는 선택 필드를 더한 것 */
export interface SpawnRequest extends SpawnSpec {
  readonly fork?: ForkPoint;
  readonly tools?: ChildToolPolicy;
  readonly limits?: ChildLimits;
  /** 모델 역할 덮어쓰기 */
  readonly model?: string;
}

export const AGENT_REPORT_TYPE = "agent.report" as const;

export interface ReportDelivery {
  /** 완료 보고 PostItem.customType. 그룹은 자기 grp.<이름>. 접두, 코어 경로는 AGENT_REPORT_TYPE */
  readonly customType: RecordKind | typeof AGENT_REPORT_TYPE;
  readonly display: boolean;
  readonly when: Extract<PostWhen, "followUp" | "next">;
}

export interface DelegateRequest extends Omit<SpawnRequest, "background"> {
  /** 필수. 대화 범위 멱등 키, 1~48자. 보고 post의 키는 "<requestId>:report" */
  readonly requestId: string;
  readonly report: ReportDelivery;
}

export type MimicryFlag =
  | "role_marker"
  | "system_tag"
  | "tool_call_markup"
  | "override_phrase"
  | "wrapper_escape";

export interface GuardedReport {
  /** 격리 블록으로 감싼 텍스트. 부모 모델에 들어가는 그대로 */
  readonly text: string;
  readonly truncated: boolean;
  /** 지시문 모방 검사가 찾은 표지 이름. 비면 없음 */
  readonly flags: readonly MimicryFlag[];
  readonly originalChars: number;
}

/** F SpawnOutcome에 L1 정보를 더한 것 */
export interface SpawnResult extends SpawnOutcome {
  readonly requestId: string;
  /** completed가 아니면 null일 수 있다 */
  readonly report: GuardedReport | null;
  readonly usage: Usage | null;
  /** 같은 requestId의 기존 자식을 돌려줬으면 참 */
  readonly reused: boolean;
}

export interface DelegateReceipt {
  readonly requestId: string;
  readonly childThreadId: ThreadId;
  readonly status: "accepted" | "duplicate";
}

export type ChildStatus =
  | { readonly state: "queued" | "running"; readonly childThreadId: ThreadId }
  | { readonly state: "settled"; readonly childThreadId: ThreadId; readonly result: SpawnResult };

export type CancelTarget =
  | { readonly childThreadId: ThreadId }
  | { readonly parentThreadId: ThreadId; readonly requestId: string };

export type AgentsErrorCode =
  | "agents.unknown_definition"
  | "agents.depth_exceeded"
  | "agents.denied"
  | "agents.parent_aborting"
  | "agents.invalid_request"
  | "agents.unavailable";

export type DelegateResult =
  | { readonly ok: true; readonly receipt: DelegateReceipt }
  | {
      readonly ok: false;
      readonly error: { readonly kind: AgentsErrorCode; readonly message: string };
    };

// ── 목표 판정 ────────────────────────────────────────────────────────────

export interface JudgeEvidence {
  readonly kind: "assistant_text" | "tool_result" | "work_item" | "note";
  readonly text: string;
  /** 증거 원본 위치. item, effect, L2.work 레코드 */
  readonly ref?: {
    readonly itemId?: ItemId;
    readonly effectId?: string;
    readonly workRef?: string;
  };
}

export interface JudgeInput {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  /** L2.work의 목표 참조. 상한 집계 단위 */
  readonly goalRef: string;
  readonly goal: { readonly text: string; readonly criteria: readonly string[] };
  readonly evidence: readonly JudgeEvidence[];
}

export type JudgeVerdict = "met" | "not_met" | "undecidable";

export interface JudgeRecord {
  readonly goalRef: string;
  /** 1부터 */
  readonly run: number;
  readonly verdict: JudgeVerdict;
  readonly rationale: string;
  /** 충족되지 않은 기준 */
  readonly missing: readonly string[];
  readonly usage: Usage | null;
  readonly model: { readonly provider: string; readonly modelId: string };
}

export type JudgeOutcome =
  /** 이번 호출이 판정하고 agent.judged를 커밋했다 */
  | { readonly kind: "judged"; readonly record: JudgeRecord }
  /** 이미 기록된 판정(재개) */
  | { readonly kind: "recorded"; readonly record: JudgeRecord }
  | { readonly kind: "capped"; readonly runs: number; readonly maxRuns: number }
  | { readonly kind: "failed"; readonly message: string };

// ── AgentService ─────────────────────────────────────────────────────────

export interface AgentService {
  /** 포그라운드 생성. 자식이 정착할 때까지 기다린다. 같은 (부모, requestId)면 기존 자식을 쓴다 */
  spawn(request: SpawnRequest, origin: SpawnOrigin): Promise<SpawnResult>;
  /** 백그라운드 위임. 자식을 접수하고 바로 돌려준다. 완료 보고는 부모 inbox에 post된다 */
  delegate(request: DelegateRequest, origin: SpawnOrigin): Promise<DelegateResult>;
  /** 직접 취소. 백그라운드 자식도 취소한다. 취소 의도를 먼저 커밋한다 */
  cancel(target: CancelTarget, reason: string): Promise<{ readonly cancelled: boolean }>;
  status(parentThreadId: ThreadId, requestId: string): ChildStatus | undefined;
  /** 정의 등록. 같은 이름은 우선순위 높은 출처가 이긴다 */
  define(definition: AgentDefinition): () => void;
  definition(name: string): AgentDefinition | undefined;
  definitions(): readonly AgentDefinition[];
  /** 목표 판정. 상한에 이르면 모델을 부르지 않는다 */
  judge(input: JudgeInput): Promise<JudgeOutcome>;
}

import { Type, type TUnsafe } from "typebox";
import type { Result } from "../base/index.ts";
import type {
  AnyCapabilityDef,
  CapabilityId,
  OrderedTool,
  ServiceKey,
  ToolName,
  ToolRef,
  ToolSpec,
  ToolsetFingerprint,
} from "../capabilities/index.ts";
import type {
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  AgentToolUpdateCallback,
  AssistantMessage,
  EffectId,
  ImageContent,
  ItemId,
  JsonObject,
  JsonValue,
  ReplayPolicy,
  StepId,
  TextContent,
  ThreadId,
  ToolExecutionMode,
  ToolResultMessage,
  ToolResultRecord,
  TurnId,
} from "../conversation/index.ts";
import type {
  PortKey,
  ScopeId,
  ToolRegisterError,
  ToolResourceDef,
  ToolsPort,
} from "../extensions/index.ts";
import type {
  BlobRef,
  DurableEventDraft,
  EffectIntent,
  PendingToolCall,
  ReadFailure,
  StampedDraft,
  StoreError,
} from "../records/index.ts";

// L1.tools.spec §3. 구현은 core-tools다. 도구·정책의 공용 타입은 ToolService와 같은 파일에 둔다(F.capabilities.spec §3.12 규칙 3).
// 정책 평가 함수(evaluatePolicy, ruleMatches, stricter, validateRules)는 core-tools가 구현한다. F에는 타입과 데이터 상수만 둔다.

export const ToolServiceName = "xeon.tools" as const;

/** `xeon.tools` 전체 모양(ToolService)의 포트 키. 제공 core-tools. 등록 부분형(ToolsPort)의 키는 extensions의 `ToolsPortKey`다 */
export const ToolServicePortKey: PortKey<ToolService> = { name: ToolServiceName };

// ── 도구 메타 ────────────────────────────────────────────────────────────

/** 효과 범위. 미선언은 "exec"로 본다 */
export type ToolRisk = "read" | "write" | "exec";
export const TOOL_RISK_ORDER: readonly ToolRisk[] = ["read", "write", "exec"];

/** 정책이 도구 이름 대신 쓰는 의미 표지. L1.agents의 자식 차단 목록이 쓴다 */
export type ToolClass = "spawn" | "user_interaction" | "shared_state_write" | "external_send";

/** 광고 방식. auto는 도구 수가 지연 임계를 넘을 때 지연 도구가 된다 */
export type ExposureMode = "always" | "deferred" | "auto";

/** 결과 경계화 한도. 생략한 값은 설정 l1.tools.output.*을 쓴다 */
export interface OutputLimits {
  readonly maxLines?: number;
  readonly maxBytes?: number;
}

/** 도구 하나의 정책 메타. ToolSpec에 없는 필드를 core-tools가 받는 자리 */
export interface ToolPolicyMeta {
  readonly risk?: ToolRisk;
  readonly classes?: readonly ToolClass[];
  /** MCP 서버 도구면 서버 이름. 정책 resource.mcpServer와 대조한다 */
  readonly mcpServer?: string;
}

export interface ToolMeta extends Required<Pick<ToolPolicyMeta, "risk" | "classes">> {
  readonly name: ToolName;
  readonly label: string;
  /** 순서 키(능력 ID 또는 ext.<이름>, mcp.<서버>) */
  readonly ref: ToolRef;
  readonly capability?: { readonly id: CapabilityId; readonly method: string };
  readonly mcpServer?: string;
  readonly hints: NonNullable<ToolSpec["hints"]>;
  /** 미선언은 "unsafe" */
  readonly replay: ReplayPolicy;
  /** 배치 스케줄에 쓴다. "sequential"인 도구가 하나라도 있으면 그 배치는 순차로 돈다(adr.0009 §3.3). 미선언은 생략 */
  readonly executionMode?: ToolExecutionMode;
  readonly exposure: ExposureMode;
  /** "self": 도구 구현이 경계를 직접 지킴 */
  readonly outputLimits: Required<OutputLimits> | "self";
}

/** 능력 도구: 정의 + 서비스 키. 실행 함수는 어댑터가 만든다 */
export interface CapabilityToolsRegistration {
  readonly kind: "capability";
  readonly def: AnyCapabilityDef;
  readonly key: ServiceKey<unknown>;
  /** 도구 이름별 정책 메타. 생략한 도구는 hints에서 유도한다 */
  readonly policy?: Readonly<Record<string, ToolPolicyMeta>>;
  readonly exposure?: Readonly<Record<string, ExposureMode>>;
  readonly outputLimits?: Readonly<Record<string, OutputLimits | "self">>;
}

/** 능력 밖 도구: 확장 도구, MCP 서버 도구, core-tools·core-agents 내장 도구 */
export interface DirectToolRegistration {
  readonly kind: "direct";
  /** 순서 키 접두. "ext.<확장 이름>" | "mcp.<서버 이름>" | "core.<L1 도메인>" */
  readonly orderKey: string;
  readonly tool: AgentTool;
  readonly hints?: ToolSpec["hints"];
  readonly policy?: ToolPolicyMeta;
  readonly exposure?: ExposureMode;
  readonly outputLimits?: OutputLimits | "self";
}

export type ToolRegistration = CapabilityToolsRegistration | DirectToolRegistration;

export type Unregister = () => void;

// ── 실행 맥락 ────────────────────────────────────────────────────────────

/** 호출 주체. 정의 이름은 L1.agents의 AgentDefinition.name */
export type CallerId = "main" | `subagent:${string}`;

export interface ToolRunDrafts {
  /**
   * toolResult item.recorded 초안. 도구가 effect.result와 같은 커밋에 넣으므로 루프의 생산자(core.loop)가 낙인한 초안이다.
   * 낙인은 객체 정체성으로 확인되므로 펼치거나 복사하지 않는다(L1.tools.spec §3.2)
   */
  toolResultItem(input: {
    readonly itemId: ItemId;
    readonly message: ToolResultMessage;
    /** 효과 기록과 함께 커밋하면 그 효과, 효과 없이 닫는 호출(미발견, 거부, 실행 전 중단)이면 null */
    readonly effectId: EffectId | null;
  }): StampedDraft;
  /** 승인 대기를 기록하는 checkpoint.step 초안(next: "await_input") */
  waitingCheckpoint(pending: readonly PendingToolCall[]): DurableEventDraft;
}

/** 루프(core-loop)가 단계마다 만들어 넘기는 실행 맥락. 대화마다 하나 */
export interface ToolRunContext {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly stepId: StepId;
  readonly caller: CallerId;
  /** 주 대화 0, 서브에이전트는 부모 깊이 + 1 */
  readonly depth: number;
  /** 사람이 승인 요청에 답할 수 있는가 */
  readonly interactive: boolean;
  /** 승인 요청을 사람에게 보일 대화. 주 대화는 자기 threadId, 자식은 소유 트리의 루트 */
  readonly surfaceThreadId: ThreadId;
  /** 자식 대화면 부모의 정책 관점. 있으면 정책 결정에 ceiling 단계를 적용한다 */
  readonly ceiling?: PolicyCeiling;
  readonly signal: AbortSignal;
  /** 소유 컨텍스트의 초안 생성기. core-loop가 자기 생산자로 만든다 */
  readonly drafts: ToolRunDrafts;
}

// ── 노출 ─────────────────────────────────────────────────────────────────

export interface AdvertiseInput {
  readonly run: Pick<ToolRunContext, "threadId" | "caller" | "depth" | "ceiling">;
  /** 이 대화에서 tool_search로 활성화된 도구. 이벤트에서 다시 계산한다 */
  readonly activated: ReadonlySet<ToolName>;
  /** 서브에이전트 정의의 도구 제한. 도구 이름 glob. 없으면 제한 없음 */
  readonly allow?: readonly string[];
  /** 광고 목록을 부모와 같게 유지하고 실행 시점에만 거를지(캐시 접두 공유) */
  readonly keepParentList?: { readonly parent: AdvertisedToolset };
}

export interface RemovedTool {
  readonly ref: ToolRef;
  readonly ruleId: string;
  readonly tier: PolicyTier;
}

export interface AdvertisedToolset {
  /** orderTools 순서. 전역 deny 제거, 지연 도구 제외 */
  readonly tools: readonly OrderedTool[];
  /** 검색으로만 찾는 도구. toolOrderKey 순 */
  readonly deferred: readonly ToolRef[];
  /** 전역 deny로 뺀 도구(진단·설정 화면용) */
  readonly removed: readonly RemovedTool[];
  readonly fingerprint: ToolsetFingerprint;
}

/** 내장 지연 노출 도구 이름 */
export const TOOL_SEARCH_NAME = "tool_search" as const;

// ── 정책 ─────────────────────────────────────────────────────────────────

export type PolicyEffect = "allow" | "ask" | "deny";
export type PolicyTier = "default" | "extension" | "user" | "managed";
export const POLICY_TIER_ORDER: readonly PolicyTier[] = ["default", "extension", "user", "managed"];

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypass";
/** 엄격한 쪽이 앞이다. 자식 모드 계산(L1.agents)에 쓴다 */
export const PERMISSION_MODE_STRICTNESS: readonly PermissionMode[] = [
  "plan",
  "default",
  "acceptEdits",
  "bypass",
];

/** 1차 동작은 도구 호출 하나. 2차에 "shell.command"를 더한다 */
export type PolicyAction = "tool.call";

export interface ArgCondition {
  /** 검증된 인자 객체 기준 RFC 6901 JSON Pointer. 예: "/command" */
  readonly pointer: string;
  /** JS RegExp 원문. 플래그 없음. 대상 값이 문자열이 아니면 키 정렬 JSON으로 바꿔 대조한다 */
  readonly pattern: string;
}

export interface PolicyResource {
  /** 도구 기계 이름 glob. "*"와 "?"만 쓴다. 생략하면 모든 도구 */
  readonly tool?: string;
  /** 능력 ID glob */
  readonly capability?: string;
  /** MCP 서버 이름 glob */
  readonly mcpServer?: string;
  /** 하나라도 가지면 일치 */
  readonly classes?: readonly ToolClass[];
  readonly risk?: readonly ToolRisk[];
  /** 모두 일치해야 한다 */
  readonly args?: readonly ArgCondition[];
  /** "main", "subagent"(모든 서브에이전트), "subagent:<이름>" */
  readonly caller?: "main" | "subagent" | `subagent:${string}`;
  /** 이 깊이 이상에서만 일치(L1.agents 재귀 spawn 차단) */
  readonly minDepth?: number;
  readonly mode?: readonly PermissionMode[];
}

export interface PolicyRule {
  /** 규칙 이름. 소스 안에서 유일. 예: "subagent.no-spawn", "user.allow-git-status" */
  readonly id: string;
  readonly action: PolicyAction;
  readonly resource: PolicyResource;
  readonly effect: PolicyEffect;
  /** 같은 티어 안 우선순위. 0~999, 큰 값이 앞. 기본 500 */
  readonly priority?: number;
  readonly description?: string;
}

/** 평가기에 넣는 규칙. 티어와 출처는 core-tools가 붙인다 */
export interface TieredRule extends PolicyRule {
  readonly tier: PolicyTier;
  /** 예: "settings:managed", "settings:project:/repo/.xeon/settings.json", "ext:helm", "core:agents" */
  readonly source: string;
}

export interface PolicyInput {
  readonly action: PolicyAction;
  readonly tool: ToolName;
  readonly capability?: CapabilityId;
  readonly mcpServer?: string;
  readonly classes: readonly ToolClass[];
  readonly risk: ToolRisk;
  /** 검증된 인자. 노출 판정에서는 null(인자 조건이 있는 규칙은 일치하지 않는 것으로 본다) */
  readonly args: Readonly<Record<string, JsonValue>> | null;
  readonly caller: CallerId;
  readonly depth: number;
  readonly mode: PermissionMode;
  readonly interactive: boolean;
  /** managed가 bypass를 금지했는가(설정 l1.tools.bypassAllowed) */
  readonly bypassAllowed: boolean;
}

export type DecisionReason = "rule" | "mode" | "noninteractive" | "bypass_forbidden";

export interface PolicyDecision {
  readonly effect: PolicyEffect;
  readonly reason: DecisionReason;
  readonly ruleId: string | null;
  readonly tier: PolicyTier | null;
  /** 모델에 보일 거부 사유 문장(영어). deny일 때만 */
  readonly message?: string;
}

/** 자식 대화의 부모 관점(L1.agents) */
export interface PolicyCeiling {
  readonly caller: CallerId;
  readonly depth: number;
  readonly mode: PermissionMode;
  /** 정의 파일 tools 제한(glob). 없으면 제한 없음 */
  readonly allow?: readonly string[];
}

/** 규칙 정적 검사가 찾는 문제 */
export type PolicyIssueCode =
  | "rule_id_duplicate"
  | "pattern_invalid"
  | "glob_invalid"
  | "priority_range"
  | "pointer_invalid";

export interface PolicyIssue {
  readonly ruleId: string;
  readonly code: PolicyIssueCode;
  readonly message: string;
}

/** 설정 l1.tools.rules 원소 스키마 */
export const PolicyRuleSchema: TUnsafe<PolicyRule> = Type.Unsafe<PolicyRule>(
  Type.Object(
    {
      id: Type.String({ minLength: 1, maxLength: 128 }),
      action: Type.Literal("tool.call"),
      resource: Type.Object(
        {
          tool: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
          capability: Type.Optional(Type.String({ minLength: 1, maxLength: 96 })),
          mcpServer: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
          classes: Type.Optional(
            Type.Array(
              Type.Union([
                Type.Literal("spawn"),
                Type.Literal("user_interaction"),
                Type.Literal("shared_state_write"),
                Type.Literal("external_send"),
              ]),
              { maxItems: 4 },
            ),
          ),
          risk: Type.Optional(
            Type.Array(
              Type.Union([Type.Literal("read"), Type.Literal("write"), Type.Literal("exec")]),
              { maxItems: 3 },
            ),
          ),
          args: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  pointer: Type.String({ pattern: "^(?:|/.*)$", maxLength: 256 }),
                  pattern: Type.String({ maxLength: 1024 }),
                },
                { additionalProperties: false },
              ),
              { maxItems: 16 },
            ),
          ),
          caller: Type.Optional(
            Type.String({
              pattern: "^(main|subagent|subagent:[a-z][a-z0-9-]{1,47})$",
              maxLength: 64,
            }),
          ),
          minDepth: Type.Optional(Type.Integer({ minimum: 0 })),
          mode: Type.Optional(
            Type.Array(
              Type.Union([
                Type.Literal("default"),
                Type.Literal("acceptEdits"),
                Type.Literal("plan"),
                Type.Literal("bypass"),
              ]),
              { maxItems: 4 },
            ),
          ),
        },
        { additionalProperties: false },
      ),
      effect: Type.Union([Type.Literal("allow"), Type.Literal("ask"), Type.Literal("deny")]),
      priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 999 })),
      description: Type.Optional(Type.String({ maxLength: 500 })),
    },
    { additionalProperties: false },
  ),
);

// ── 결과 경계화 ──────────────────────────────────────────────────────────

/** 경계화한 도구 결과. 출력 절단 함수는 platform-exec가 제공한다(services/exec.ts) */
export interface BoundedResult {
  /** 모델에 보낼 결과. 텍스트는 미리보기와 안내 문장 */
  readonly content: readonly (TextContent | ImageContent)[];
  /** 원문을 옮겼으면 그 blob. effect.result.blobRef에 들어간다 */
  readonly blobRef: BlobRef | null;
  readonly truncated: boolean;
  readonly totalLines: number;
  readonly totalBytes: number;
}

// ── 오류 ─────────────────────────────────────────────────────────────────

export type ToolsErrorCode =
  /** 등록: 같은 순서 키·이름 */
  | "tools.name_conflict"
  /** 광고: always 도구만으로 MAX_TOOLS_PER_REQUEST 초과 */
  | "tools.too_many"
  /** 어댑터 execute에 커밋된 effect.intent가 없음(버그) */
  | "tools.intent_missing"
  /** 효과 커밋이 StoreError로 실패 */
  | "tools.commit_failed"
  /** managed가 금지한 모드로 바꾸려 함 */
  | "tools.mode_forbidden"
  /** 없는 approvalId */
  | "approvals.unknown"
  /** kind와 맞지 않는 decision·answer */
  | "approvals.invalid_response"
  /** 비대화형 실행에서 question·plan 요청 */
  | "approvals.noninteractive";

export interface ToolsError {
  readonly kind: ToolsErrorCode;
  readonly message: string;
  readonly detail?: JsonValue;
}

// ── 도구 단계 계약(adr.0009 §3.4) ───────────────────────────────────────

/** `prepare`를 통과해 실행할 수 있는 호출. 인자는 도구 스키마 검증을 마친 값이다 */
export interface PreparedCall {
  readonly toolCall: AgentToolCall;
  readonly args: JsonObject;
}

/** 도구 호출 하나가 끝난 방식 */
export type ToolCallState =
  /** 도구를 실행했다(성공이든 오류 결과든) */
  | "executed"
  /** 미발견, 인자 오류, 확장·정책·사용자 거부, 준비 중 중단, 내부 오류. 실행하지 않았다 */
  | "rejected"
  /** 중단으로 실행하지 않고 닫았다 */
  | "not_executed"
  /** 응답이 출력 한도에서 잘려 실행하지 않고 닫았다 */
  | "truncated";

/** 실행하지 않고 닫는 이유 */
export type RejectReason = "not_executed" | "truncated";

/** 도구 호출 하나의 최종 결과. 마스킹·경계화를 마치고 기록한 값이다 */
export interface ToolCallOutcome {
  readonly toolCall: AgentToolCall;
  readonly state: ToolCallState;
  /** 모델에 돌려줄 최종 결과. `terminate`가 있으면 배치 종료 판정에 쓴다 */
  readonly result: AgentToolResult;
  readonly isError: boolean;
  /** 도구 실행에 걸린 시간. 실행하지 않았으면 없다 */
  readonly durationMs?: number;
  /** 기록한 toolResult 메시지. 이벤트와 다음 컨텍스트가 쓰는 값과 같다 */
  readonly message: ToolResultMessage;
  /** 기록한 toolResult item. 결과 기록 커밋이 실패했으면 null이고, 루프는 run을 `loop_rejected`로 끝낸다 */
  readonly itemId: ItemId | null;
}

export type CallPreparation =
  /** 정책 허용, 의도 커밋됨. 실행할 수 있다 */
  | { readonly kind: "ready"; readonly call: PreparedCall }
  /** 실행하지 않고 결과까지 기록했다 */
  | { readonly kind: "settled"; readonly outcome: ToolCallOutcome };

// ── ToolService ──────────────────────────────────────────────────────────

export interface UserShellRequest {
  readonly command: string;
  /** 결과를 모델 컨텍스트에 넣을지(pi user_bash 의미). 기록 방식은 L1.loop */
  readonly includeInContext: boolean;
}

export type ModeChangeResult =
  | { readonly ok: true; readonly mode: PermissionMode }
  | {
      readonly ok: false;
      readonly error:
        | { readonly kind: "tools.mode_forbidden"; readonly mode: PermissionMode }
        /** 모드 변경을 세션 설정에 커밋하지 못했다. 저장소 실패는 예상 가능한 거부다 */
        | { readonly kind: "tools.commit_failed"; readonly store: StoreError };
    };

export interface RuleRegistration {
  /** validateRules가 찾은 문제. 문제가 있는 규칙은 적재하지 않는다 */
  readonly issues: readonly PolicyIssue[];
  /** 이 source의 규칙을 뺀다 */
  dispose(): void;
}

/** ToolsPort(F.extensions.spec §3.2.1)를 확장한다. 확장의 hostOf(g).registerTool은 register(owner, def) 오버로드로 들어온다 */
export interface ToolService extends ToolsPort {
  /** L1·L2 코드 등록. 같은 이름이 이미 있으면 name_conflict를 돌려주고 표는 바뀌지 않는다 */
  register(registration: ToolRegistration): Result<Unregister, ToolRegisterError>;
  /**
   * X ToolsPort 등록. orderKey는 `ext.<owner의 확장 이름>`, tool은 def의 name·description·parameters와 def.execute를 감싼 AgentTool,
   * 재생 정책은 def.replay다. hints·policy·exposure·outputLimits는 생략하고 유도 규칙을 따른다
   */
  register(owner: ScopeId, def: ToolResourceDef): Result<Unregister, ToolRegisterError>;

  /** 메타 조회. 동기, 순수 조회. 확장 핸들러가 쓰기 판정에 쓴다 */
  meta(name: ToolName): ToolMeta | undefined;

  /** 광고 목록 산출. 같은 입력과 같은 등록·규칙 상태면 같은 결과 */
  advertise(input: AdvertiseInput): Promise<AdvertisedToolset>;

  /**
   * 도구 호출 하나의 준비(adr.0009 §3.4). 도구 조회, 인자 검증, `tool_call` 지점, 정책·승인, E1(`effect.intent`) 커밋을 차례로 한다.
   * 실패는 던지지 않고 `settled`로 돌려준다. 미발견·인자 오류·거부·중단 호출은 결과 item까지 기록된 상태다.
   * 루프는 준비를 항상 원래 순서대로 하나씩 부른다.
   */
  prepare(
    call: AgentToolCall,
    assistant: AssistantMessage,
    run: ToolRunContext,
  ): Promise<CallPreparation>;

  /**
   * 준비를 마친 호출의 실행과 마감: E2(`effect.exec`), 실행, 마스킹, `tool_result` chain, 경계화, E3(`effect.result` + toolResult item).
   * 병렬로 불러도 된다. 도구가 던진 오류는 `isError` 결과가 되어 돌아온다.
   */
  execute(
    call: PreparedCall,
    onUpdate: AgentToolUpdateCallback,
    run: ToolRunContext,
  ): Promise<ToolCallOutcome>;

  /**
   * 실행하지 않은 호출을 이유와 함께 닫는다(중단 `not_executed`, 출력 한도 절단 `truncated`). 입력 순서대로 결과를 돌려준다.
   * 의도가 이미 커밋된 호출은 `effect.result`로, 없는 호출은 효과 없는 toolResult item으로 기록한다.
   */
  settleRejected(
    calls: readonly AgentToolCall[],
    reason: RejectReason,
    run: ToolRunContext,
  ): Promise<readonly ToolCallOutcome[]>;

  /**
   * 재개 때 재실행. decideEffectRecovery가 rerun을 낸 효과만 받는다. tool_call 지점과 정책을 다시 거치지 않는다.
   * 결과는 `effect.result`와 같은 커밋에 기록되어 돌아온다.
   */
  rerun(intent: EffectIntent, run: ToolRunContext): Promise<Result<ToolCallOutcome, ReadFailure>>;

  /** 코어 규칙 등록(default 티어). source는 "core:<L1 도메인>". 같은 source로 다시 부르면 그 source의 규칙을 통째로 바꾼다 */
  registerRules(source: `core:${string}`, rules: readonly PolicyRule[]): RuleRegistration;

  /** 사용자 셸(`!명령`) 경로(M2). L1.loop의 runUserBash가 user_bash 지점 뒤에 부른다. 정책은 caller "main", 대화형으로 평가한다 */
  runUserShell(request: UserShellRequest, run: ToolRunContext): Promise<ToolResultRecord>;

  /** 대화의 권한 모드. 세션 범위 설정 l1.tools.permissionMode를 바꾸고 settings.changed로 남는다 */
  mode(threadId: ThreadId): PermissionMode;
  setMode(
    threadId: ThreadId,
    mode: PermissionMode,
    source: "user" | "plan_approval",
  ): Promise<ModeChangeResult>;
}

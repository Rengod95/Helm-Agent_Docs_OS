---
id: L1.tools.spec
layer: L1
domain: tools
kind: spec
status: draft
depends_on: [F.capabilities.spec, F.conversation.spec, F.records.spec, F.extensions.spec, F.wire-settings.spec, L0.exec.spec, L0.secrets.spec, L1.tasks.spec, L1.persistence.spec, eng.transactions.design, eng.context-map.design, eng.dependency-rules.guide, architecture.runtime-flow.design, adr.0003, adr.0007]
binds: [xeon/packages/core-tools/**]
---

# L1 도구 실행과 권한 (tools)

패키지: `xeon/packages/core-tools` (컨텍스트 `tool-runtime`, 계획 id L1-d)

## 1. 목적과 범위

모델이 부른 도구를 광고하고, 검증하고, 허용 여부를 정하고, 실행하고, 결과를 기록하는 L1 코어를 정한다. 승인·질문·계획 승인을 하나로 묶은 승인 프로토콜도 이 문서가 정한다.

근거:

- 층 구성 계획 v2 L1-d 구성요소 8개(`_research/layer-plan-v2.json` L1-d): 도구 노출 분리, 실행 파이프라인, 검증 오류 반환, 선언형 정책 엔진, 권한 모드, 승인과 질문 프로토콜, 결과 경계화, 항상 허용 캐시와 셸 규칙(2차).
- 패키지 판정(`_research/packages.md` §4.3 L1-d 행): 노출 분리·파이프라인·검증 오류 반환은 agent-core 1.3.0 그대로, 정책 엔진·모드·승인 프로토콜은 설계, 결과 경계화는 포크. adr.0009 이후 파이프라인은 core-tools `prepare`·`execute`가, 인자 검증은 core-tools `validate.ts`가 옮겨 맡는다.
- [결정] 질문 도구와 계획 승인은 L1-d 승인 프로토콜 하나로 합친다(`_research/foundation-plan.md` §1 결정 5, `_research/decisions-log.md` 2026-10-21 3차).
- [결정] pi durable에서 truncate를 Chord 제거 포크로 가져온다(adr.0003, `_research/foundation-plan.md` §1 결정 1).

정하는 것:

- Cordis 서비스 `xeon.tools`(`ToolService`)와 `xeon.approvals`(`ApprovalService`). 두 서비스 모두 `core-tools`가 제공한다(eng.context-map.design §5.3).
- 도구 등록 형식(`ToolRegistration`), 광고 목록 산출(`advertise`), `ToolSpec`·`DirectToolRegistration` → 도구 항목(core-tools `ToolEntry`) 어댑터, 실행 파이프라인.
- 선언형 정책 엔진의 규칙 어휘(`PolicyRule`, 티어, 호출 주체 조건)와 순수 평가기 `evaluatePolicy`. L1.agents.spec이 같은 어휘를 그대로 쓴다.
- 권한 모드 4종과 비대화형 실행 규칙.
- 승인 프로토콜: 단일 대기 형식 `ApprovalRequest`, wire 응답 `approval.respond`와의 대응, 대기 상태 내구화와 재개 복원.
- 결과 경계화: 줄·바이트 한도, 원문의 blob 분리, 모델용 미리보기.
- 이 도메인이 발화하는 확장 지점 7개와 설정 키 `l1.tools.*`.
- 태스크 엔진과의 연결: tool 범위 노드, 잠금 키 산출, 키 큐와 `tools` 풀 획득 순서(§4.2).
- 실행 환경·샌드박스·비밀과의 책임 경계(§4.12).

다루지 않는 것:

- 능력 정의 형식, 도구 이름 규칙, 결정적 순서 함수: F.capabilities.spec.
- 효과 3단 이벤트의 payload와 재개 판정 함수(`decideEffectRecovery`): F.records.spec §3.5. 재개 절차 자체: L1.persistence.spec.
- 루프 단계, 체크포인트를 쓰는 시점, 병렬·순차 실행 모드 선택: L1.loop.spec, L1.tasks.spec.
- 개별 도구 구현(read, ls, bash, 편집 등): L2.workspace.spec. 질문 도구와 계획 도구의 모델 노출: L2.dialog.spec, L2.work.spec.
- 샌드박스와 실행 환경: L0.sandbox.spec, L0.exec.spec. L1.tools와의 경계는 §4.12다.
- 서브에이전트의 권한 상한 계산: L1.agents.spec(이 문서의 평가기를 호출한다).
- 대화 중간 도구 추가·제거를 대화 기록에 넣는 일: L1.context.spec(F.capabilities.spec §4.5).

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 광고 목록 (advertised toolset) | 한 모델 요청에 실리는 도구 목록. `orderTools` 순서로 정렬하고 고정한다 |
| 지연 도구 (deferred tool) | 등록은 되었지만 광고 목록에 처음부터 싣지 않는 도구. 모델이 `tool_search`로 찾은 뒤 활성화되면 다음 단계부터 광고된다 |
| 전역 deny | 인자·모드 조건 없이 도구 이름(또는 능력·MCP 서버)만으로 거부가 정해지는 규칙 결과. 광고 목록에서 뺀다 |
| 호출 주체 (caller) | 도구를 부른 대화의 주체. 주 대화는 `main`, 서브에이전트는 `subagent:<정의 이름>` |
| 티어 (tier) | 규칙의 출처 등급. 낮은 쪽부터 `default` < `extension` < `user` < `managed` |
| 위험 등급 (risk) | 도구가 선언한 효과 범위. `read` < `write` < `exec`. 미선언은 `exec` |
| 도구 부류 (tool class) | 정책이 도구 이름 대신 쓰는 의미 표지. `spawn`, `user_interaction`, `shared_state_write`, `external_send` |
| 권한 모드 | 규칙이 정하지 않은 호출에 적용할 기본 허용 범위. `default`, `acceptEdits`, `plan`, `bypass` |
| 승인 요청 | 사람의 응답을 기다리는 단일 대기 레코드. 종류는 `tool`(도구 승인), `plan`(계획 승인), `question`(사용자 질문) |
| 결과 경계화 | 모델에 보낼 도구 결과를 한도 안으로 줄이고 원문을 blob으로 옮기는 일 |
| 대화형 실행 | 사람이 승인 요청에 답할 수 있는 실행. 예약 실행과 헤드리스 실행은 비대화형이다 |

이 문서는 F의 다음 이름을 그대로 쓴다: `ToolSpec`, `ToolHints`, `ToolName`, `CapabilityError`, `orderTools`, `toolsetFingerprint`, `diffToolsets`, `MAX_TOOLS_PER_REQUEST`(F.capabilities.spec), `ToolResultRecord`, `ReplayPolicy`, `toReplayPolicy`(F.conversation.spec §3.6), `EffectIntent`, `EffectExec`, `EffectResult`, `BlobRef`, `StepCheckpoint`, `PendingToolCall`, `DurableEventDraft`(F.records.spec), `ToolCallPayload`, `ToolCallDecision`, `ToolResultPayload`, `ToolResultValue`, `ToolResultPatch`, `FIRST_DENY`(F.extensions.spec §3.5).

용어 대응: eng.transactions.design의 `tool.intended`·`tool.settled`는 F의 `effect.intent`·`effect.result`이고, `effect.exec`가 그 사이의 실행 시작 표시다(F.records.spec §3.1.2 정본 표). 이 문서는 F 이름만 쓴다.

## 3. 인터페이스

서비스 인터페이스 `ToolService`와 서비스 이름 상수는 F `@xeon/contracts/services` 서브패스에 둔다 [결정: review.decisions-2 D-04]. `ApprovalService`도 같은 서브패스에 두도록 요청한다. 도구·정책·승인의 공용 타입은 F `@xeon/contracts/capabilities`의 `tools.ts`, `policy.ts`, `approvals.ts`에 둔다 [제안](eng.context-map.design §5.3 표의 "F 인터페이스(위치)" 열). L1 패키지끼리 import하지 않으므로 L1.loop, L1.agents, L2가 이 타입을 쓰려면 F에 있어야 한다. F.capabilities.spec에 이전을 요청한다(§8.3). 아래 블록의 파일 경로는 이전 뒤 위치다. 구현은 `core-tools`가 한다.

[결정: adr.0009] 에이전트 타입의 출처: `@earendil-works/pi-agent-core`는 어느 패키지도 import하지 않는다. F `services/tools.ts`와 core-tools는 F conversation이 정의한 이름(`F.conversation.spec` §3.1.1 `agent.ts`의 `AgentTool`, `AgentToolCall`, `AgentToolResult` 등)만 쓴다. 도구 한 호출의 준비·실행·마감은 core-tools의 단계 계약(`prepare`·`execute`·`settleRejected`, adr.0009 §3.4)이고, 배치 스케줄은 core-loop가 한다(L1.loop.spec §3.3).

### 3.1 도구 등록 (`tools.ts`)

```ts
import type { TSchema } from "typebox";
import type { AgentTool } from "../conversation/agent.ts";   // F 정의(F.conversation.spec §3.1.1). pi-agent-core는 import하지 않는다(adr.0009)
import type {
  AnyCapabilityDef, CapabilityId, ServiceKey, ToolName, ToolSpec, OrderedTool, ToolRef, ToolsetFingerprint,
} from "./index.ts";

/** 효과 범위. 미선언은 "exec"로 본다(§4.6) */
export type ToolRisk = "read" | "write" | "exec";
export const TOOL_RISK_ORDER: readonly ToolRisk[] = ["read", "write", "exec"];

/** 정책이 도구 이름 대신 쓰는 의미 표지(§4.5). L1.agents.spec의 자식 차단 목록이 쓴다 */
export type ToolClass = "spawn" | "user_interaction" | "shared_state_write" | "external_send";

/** 광고 방식. auto는 도구 수가 지연 임계를 넘을 때 지연 도구가 된다(§4.1) */
export type ExposureMode = "always" | "deferred" | "auto";

/** 결과 경계화 한도. 생략한 값은 설정 l1.tools.output.*을 쓴다 */
export interface OutputLimits {
  readonly maxLines?: number;
  readonly maxBytes?: number;
}

/** 도구 하나의 정책 메타. ToolSpec에 없는 필드를 core-tools가 받는 자리(§8.3 F 요청 1) */
export interface ToolPolicyMeta {
  readonly risk?: ToolRisk;
  readonly classes?: readonly ToolClass[];
  /** MCP 서버 도구면 서버 이름. 정책 resource.mcpServer와 대조한다 */
  readonly mcpServer?: string;
}

export interface ToolMeta extends Required<Pick<ToolPolicyMeta, "risk" | "classes">> {
  readonly name: ToolName;
  readonly label: string;
  readonly ref: ToolRef;                         // 순서 키(능력 ID 또는 ext.<이름>, mcp.<서버>)
  readonly capability?: { readonly id: CapabilityId; readonly method: string };
  readonly mcpServer?: string;
  readonly hints: NonNullable<ToolSpec["hints"]>;
  readonly replay: ReplayPolicy;                 // 미선언은 "unsafe"
  readonly exposure: ExposureMode;
  readonly outputLimits: Required<OutputLimits> | "self";   // "self": 도구가 스스로 경계화함(§4.8)
}

/** 능력 도구: 정의 + 서비스 키. 실행 함수는 어댑터가 만든다(§4.3) */
export interface CapabilityToolsRegistration {
  readonly kind: "capability";
  readonly def: AnyCapabilityDef;
  readonly key: ServiceKey<unknown>;
  /** 도구 이름별 정책 메타. 생략한 도구는 hints에서 유도한다(§4.6) */
  readonly policy?: Readonly<Record<string, ToolPolicyMeta>>;
  readonly exposure?: Readonly<Record<string, ExposureMode>>;
  readonly outputLimits?: Readonly<Record<string, OutputLimits | "self">>;
}

/** 능력 밖 도구: 확장 도구, MCP 서버 도구, core-tools·core-agents 내장 도구 */
export interface DirectToolRegistration {
  readonly kind: "direct";
  /** 순서 키 접두. "ext.<확장 이름>" | "mcp.<서버 이름>" | "core.<L1 도메인>" */
  readonly orderKey: string;
  readonly tool: AgentTool<TSchema>;
  readonly hints?: ToolSpec["hints"];
  readonly policy?: ToolPolicyMeta;
  readonly exposure?: ExposureMode;
  readonly outputLimits?: OutputLimits | "self";
}

export type ToolRegistration = CapabilityToolsRegistration | DirectToolRegistration;

export type Unregister = () => void;
/** 도구 이름이 이미 등록되어 있다. F.extensions.spec §3.2.1의 ToolRegisterError와 같다 */
export interface ToolRegisterError { readonly kind: "name_conflict"; readonly toolName: string }
```

- `ToolSpec`에는 `execute`가 없다(F.capabilities.spec §3.3). 능력 도구의 실행 함수는 §4.3의 어댑터가 서비스 키로 얻은 provider API에서 합성한다.
- `DirectToolRegistration.tool`은 F `AgentTool`(F.conversation.spec §3.1.1)이다. 실행 함수를 가진 도구(확장 `registerTool`, MCP 동적 도구, 내장 `tool_search`)가 이 경로를 쓴다. 이런 도구도 같은 파이프라인을 지난다. 파이프라인 밖 실행 경로는 없다.
- `core.<L1 도메인>` 순서 키 [제안]: L1이 내장하는 도구(`tool_search`, L1.agents.spec의 `agent`)의 순서 키다. F.capabilities.spec §4.5는 `ext.`, `mcp.` 접두만 정했으므로 추가를 요청한다(§8.3 F 요청 2).

### 3.2 실행 맥락 (`tools.ts`)

```ts
import type { ThreadId, TurnId, StepId, ItemId, EffectId } from "../conversation/ids.ts";
import type { ToolResultMessage } from "../conversation/pi.ts";
import type { DurableEventDraft, PendingToolCall } from "../records/index.ts";

/** 호출 주체. 정의 이름은 L1.agents.spec의 AgentDefinition.name */
export type CallerId = "main" | `subagent:${string}`;

/** 루프(core-loop)가 단계마다 만들어 넘기는 실행 맥락. 대화마다 하나 */
export interface ToolRunContext {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly stepId: StepId;
  readonly caller: CallerId;
  /** 주 대화 0, 서브에이전트는 부모 깊이 + 1 (L1.agents.spec) */
  readonly depth: number;
  /** 사람이 승인 요청에 답할 수 있는가(§4.6) */
  readonly interactive: boolean;
  /** 승인 요청을 사람에게 보일 대화. 주 대화는 자기 threadId, 자식은 소유 트리의 루트 */
  readonly surfaceThreadId: ThreadId;
  /** 자식 대화면 부모의 정책 관점. 있으면 정책 결정에 ceiling 단계를 적용한다(§4.5, L1.agents.spec §4.3) */
  readonly ceiling?: PolicyCeiling;
  readonly signal: AbortSignal;
  /** 소유 컨텍스트의 초안 생성기. core-loop가 자기 생산자로 만든다(eng.context-map.design CM-01) */
  readonly drafts: ToolRunDrafts;
}

export interface ToolRunDrafts {
  /** toolResult item.recorded 초안 */
  toolResultItem(input: { readonly itemId: ItemId; readonly message: ToolResultMessage; readonly effectId: EffectId }): DurableEventDraft;
  /** 승인 대기를 기록하는 checkpoint.step 초안(next: "await_input", L1.loop.spec §4.5) */
  waitingCheckpoint(pending: readonly PendingToolCall[]): DurableEventDraft;
}
```

- [제안] `ToolRunContext.drafts`를 두는 이유: `effect.result`와 toolResult `item.recorded`는 한 커밋이어야 한다(F.records.spec §3.5 기록 순서 3). `item.*` 이벤트는 루프가, `effect.*` 이벤트는 core-tools가 만든다(§3.9). 그래서 core-tools가 커밋을 내고 item 초안은 루프의 생산자가 만든다. eng.transactions.design §4.4 예시의 `appendResponse(loopProducer, toolsProducer, …)`와 같은 방식이다.

### 3.3 `ToolService` (`tools.ts`)

```ts
import type { AgentTool, AgentToolCall, AgentToolUpdateCallback, AssistantMessage, JsonObject } from "../conversation/index.ts";   // F 정의(§3.1.1)와 pi-ai 재노출. pi-agent-core는 import하지 않는다(adr.0009)
import type { EffectIntent } from "../records/index.ts";
import type { ToolResultRecord } from "../conversation/index.ts";
import type { ScopeId, ToolsPort, ToolResourceDef } from "../extensions/index.ts";   // ToolsPort·ToolResourceDef: F.extensions.spec §3.2.1 ports.ts

export const ToolServiceName = "xeon.tools" as const;

export interface ToolService extends ToolsPort {
  /** L1·L2 코드 등록. 같은 순서 키·이름이 이미 있으면 ToolsError(tools.name_conflict)를 던진다 */
  register(registration: ToolRegistration): Result<Unregister, ToolRegisterError>;
  /** X ToolsPort 등록(확장 hostOf(g).registerTool). 아래 규칙으로 DirectToolRegistration을 만들어 위 메서드와 같은 경로로 등록한다 */
  register(owner: ScopeId, def: ToolResourceDef): Result<Unregister, ToolRegisterError>;

  /** 메타 조회. 동기, 순수 조회. 확장 핸들러가 쓰기 판정에 쓴다 */
  meta(name: ToolName): ToolMeta | undefined;

  /** 광고 목록 산출(§4.1). 같은 입력과 같은 등록·규칙 상태면 같은 결과 */
  advertise(input: AdvertiseInput): Promise<AdvertisedToolset>;

  /**
   * 도구 호출 하나의 준비(adr.0009 §3.4). 도구 조회, 인자 검증, `tool_call` 지점, 정책·승인, E1(`effect.intent`) 커밋을 차례로 한다(§4.2).
   * 실패는 던지지 않고 `settled`로 돌려준다. 미발견·인자 오류·거부·중단 호출은 결과 item까지 기록된 상태다. 루프는 준비를 항상 원래 순서대로 하나씩 부른다
   */
  prepare(call: AgentToolCall, assistant: AssistantMessage, run: ToolRunContext): Promise<CallPreparation>;

  /** 준비를 마친 호출의 실행과 마감: E2(`effect.exec`), 실행, 마스킹, `tool_result` chain, 경계화, E3(`effect.result` + toolResult item). 병렬로 불러도 된다 */
  execute(call: PreparedCall, onUpdate: AgentToolUpdateCallback, run: ToolRunContext): Promise<ToolCallOutcome>;

  /** 실행하지 않은 호출을 이유와 함께 닫는다(중단 `not_executed`, 출력 한도 절단 `truncated`). 의도가 있으면 `effect.result`, 없으면 효과 없는 toolResult item으로 기록한다 */
  settleRejected(calls: readonly AgentToolCall[], reason: RejectReason, run: ToolRunContext): Promise<readonly ToolCallOutcome[]>;

  /** 재개 때 재실행. decideEffectRecovery가 rerun을 낸 효과만 받는다. tool_call 지점과 정책을 다시 거치지 않는다(§4.9). 결과는 effect.result와 같은 커밋에 기록되어 돌아온다 */
  rerun(intent: EffectIntent, run: ToolRunContext): Promise<Result<ToolCallOutcome, ReadFailure>>;

  /** 코어 규칙 등록(default 티어). source는 "core:<L1 도메인>". 같은 source로 다시 부르면 그 source의 규칙을 통째로 바꾼다(§4.5) */
  registerRules(source: `core:${string}`, rules: readonly PolicyRule[]): RuleRegistration;

  /** 사용자 셸(`!명령`) 경로(M2). L1.loop의 runUserBash가 user_bash 지점 뒤에 부른다. 정책은 caller "main", 대화형으로 평가한다 */
  runUserShell(request: UserShellRequest, run: ToolRunContext): Promise<ToolResultRecord>;

  /** 대화의 권한 모드. 세션 범위 설정 l1.tools.permissionMode를 바꾸고 settings.changed로 남는다 */
  mode(threadId: ThreadId): PermissionMode;
  setMode(threadId: ThreadId, mode: PermissionMode, source: "user" | "plan_approval"): Promise<ModeChangeResult>;
}
```

- [결정: review.decisions-2 D-04] `ToolService`는 `ToolsPort`(`F.extensions.spec` §3.2.1 `ports.ts`, X.primitives.spec §3.9)를 확장한다(`F.capabilities.spec` §3.12 규칙 2, `services/tools.ts`). X는 같은 서비스 이름 `xeon.tools`에 별도 인터페이스를 등록하지 않고, 확장의 `hostOf(g).registerTool(def)`는 `register(owner, def)` 오버로드로 들어온다. 이 오버로드가 `ToolsPort`를 충족한다.
- `register(owner, def)` 변환 규칙 [제안]: `orderKey`는 `ext.<owner의 확장 이름>`, `tool`은 `def.name`·`def.description`·`def.parameters`와 `def.execute`를 감싼 `AgentTool`, 재생 정책은 `def.replay`다. `hints`·`policy`·`exposure`·`outputLimits`는 생략하고 §4.6 유도 규칙을 따른다. 반환 `Unregister`는 F `Unsubscribe`와 같은 모양(`() => void`)이다. owner scope가 dispose되면 X가 이 함수를 부른다.

```ts
/** `prepare`를 통과해 실행할 수 있는 호출. 인자는 도구 스키마 검증과 변환을 마친 값이다 */
export interface PreparedCall { readonly toolCall: AgentToolCall; readonly args: JsonObject }

export type CallPreparation =
  | { readonly kind: "ready"; readonly call: PreparedCall }            // 정책 허용, E1 커밋됨
  | { readonly kind: "settled"; readonly outcome: ToolCallOutcome };   // 미발견·인자 오류·거부·중단: 결과까지 기록됨

export type ToolCallState = "executed" | "rejected" | "not_executed" | "truncated";
export type RejectReason = "not_executed" | "truncated";

export interface ToolCallOutcome {
  readonly toolCall: AgentToolCall;
  readonly state: ToolCallState;
  /** 마스킹·경계화를 마친 모델용 결과. `terminate`는 배치 종료 판정에 쓴다 */
  readonly result: AgentToolResult;
  readonly isError: boolean;
  readonly durationMs?: number;
  /** 기록한 toolResult 메시지(이벤트와 다음 컨텍스트가 쓰는 값과 같다) */
  readonly message: ToolResultMessage;
  /** 기록한 toolResult item. 결과 기록 커밋이 실패했으면 null이고 루프는 run을 `loop_rejected`로 끝낸다 */
  readonly itemId: ItemId | null;
}

export interface UserShellRequest {
  readonly command: string;
  /** 결과를 모델 컨텍스트에 넣을지(pi user_bash 의미). 기록 방식은 L1.loop.spec */
  readonly includeInContext: boolean;
}

export type ModeChangeResult =
  | { readonly ok: true; readonly mode: PermissionMode }
  | {
      readonly ok: false;
      readonly error:
        | { readonly kind: "tools.mode_forbidden"; readonly mode: PermissionMode }
        | { readonly kind: "tools.commit_failed"; readonly store: StoreError };   // 모드 변경을 세션 설정에 커밋하지 못했다. Bug가 아니다
    };

export interface RuleRegistration {
  /** validateRules가 찾은 문제. 문제가 있는 규칙은 적재하지 않는다 */
  readonly issues: readonly { readonly ruleId: string; readonly code: PolicyIssueCode; readonly message: string }[];
  /** 이 source의 규칙을 뺀다 */
  dispose(): void;
}
```

- [결정: adr.0009] `prepare`·`execute`·`settleRejected`가 훅 쌍(`hooks`)과 `toAgentTools`, `observe`, `closeUnexecuted`, `settledItem`을 대신한다. 루프는 호출마다 `tool_execution_start` 이벤트 → `prepare` → (`ready`면) `execute` → `tool_execution_end` 이벤트 순서로 부르고, 결과 메시지는 `ToolCallOutcome.message`를 쓴다. 결과 기록은 core-tools만 한다. 루프가 toolResult item을 따로 커밋하지 않는다.
- `tool_execution_start`·`tool_execution_update`·`tool_execution_end` tap 지점(§7)은 core-tools가 `prepare`(시작), `execute`의 진행 콜백(갱신), 호출 마감(끝)에서 발화한다. 준비 없이 닫는 호출(`settleRejected`)도 시작·끝 tap을 짝으로 낸다. 페이로드는 비밀을 가린 값이다.
- `ToolMeta.executionMode`는 배치 스케줄에 쓴다. 호출 중 하나라도 `"sequential"`이면 루프는 그 배치를 순차로 돈다(L1.loop.spec §3.3 규칙 1).
- 재개 때 승인 대기 중이던 호출과 의도 없는 호출은 core-loop가 `runTurn({ kind: "tools" })`에서 주 경로와 같은 `prepare`·`execute`로 실행한다(L1.loop.spec §4.5 `tools`·`await_input` 행). 결과 불명 효과의 재실행만 `rerun`이다. 그래서 재실행도 같은 기록 경로를 지난다.
- `registerRules`의 첫 사용처는 core-agents의 자식 차단 규칙(`source: "core:agents"`, L1.agents.spec §4.3)이다. 확장 티어 규칙 등록은 2차다(§4.11).

### 3.4 노출 (`tools.ts`)

```ts
export interface AdvertiseInput {
  readonly run: Pick<ToolRunContext, "threadId" | "caller" | "depth" | "ceiling">;
  /** 이 대화에서 tool_search로 활성화된 도구. 이벤트에서 다시 계산한다(§4.1 규칙 5) */
  readonly activated: ReadonlySet<ToolName>;
  /** 서브에이전트 정의의 도구 제한(L1.agents.spec). 없으면 제한 없음 */
  readonly allow?: readonly string[];        // 도구 이름 glob
  /** 광고 목록을 부모와 같게 유지하고 실행 시점에만 거를지(L1.agents.spec 캐시 접두 공유) */
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
export const TOOL_SEARCH_NAME = "tool_search";
```

### 3.5 정책 (`policy.ts`)

```ts
export type PolicyEffect = "allow" | "ask" | "deny";
export type PolicyTier = "default" | "extension" | "user" | "managed";
export const POLICY_TIER_ORDER: readonly PolicyTier[] = ["default", "extension", "user", "managed"];

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypass";
/** 엄격한 쪽이 앞이다. 자식 모드 계산(L1.agents.spec)에 쓴다 */
export const PERMISSION_MODE_STRICTNESS: readonly PermissionMode[] = ["plan", "default", "acceptEdits", "bypass"];

/** 1차 동작은 도구 호출 하나. 2차에 "shell.command"를 더한다(§4.11) */
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
  readonly capability?: string;                  // 능력 ID glob
  readonly mcpServer?: string;                   // MCP 서버 이름 glob
  readonly classes?: readonly ToolClass[];       // 하나라도 가지면 일치
  readonly risk?: readonly ToolRisk[];
  /** 모두 일치해야 한다 */
  readonly args?: readonly ArgCondition[];
  /** "main", "subagent"(모든 서브에이전트), "subagent:<이름>" */
  readonly caller?: "main" | "subagent" | `subagent:${string}`;
  /** 이 깊이 이상에서만 일치(L1.agents.spec 재귀 spawn 차단) */
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

export const PolicyRuleSchema: TSchema;          // TypeBox. 설정 l1.tools.rules 원소 스키마

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

/** 순수 함수. 입력을 바꾸지 않는다. 시각·난수·I/O를 쓰지 않는다(§4.5) */
export function evaluatePolicy(input: PolicyInput, rules: readonly TieredRule[]): PolicyDecision;

/** 순수 함수. 규칙 하나가 입력에 일치하는가. glob·정규식 해석 포함 */
export function ruleMatches(rule: PolicyRule, input: PolicyInput): boolean;

/** 순수 함수. 두 결정 중 엄격한 쪽(deny > ask > allow). 권한 상한 계산에 쓴다 */
export function stricter(a: PolicyDecision, b: PolicyDecision): PolicyDecision;

/** 자식 대화의 부모 관점(L1.agents.spec) */
export interface PolicyCeiling {
  readonly caller: CallerId;
  readonly depth: number;
  readonly mode: PermissionMode;
  /** 정의 파일 tools 제한(glob). 없으면 제한 없음 */
  readonly allow?: readonly string[];
}

/** 규칙 정적 검사. 잘못된 정규식, 범위 밖 priority, 중복 id를 돌려준다 */
export type PolicyIssueCode = "rule_id_duplicate" | "pattern_invalid" | "glob_invalid" | "priority_range" | "pointer_invalid";
export function validateRules(rules: readonly PolicyRule[]): readonly { readonly ruleId: string; readonly code: PolicyIssueCode; readonly message: string }[];
```

### 3.6 승인 (`approvals.ts`)

```ts
export const ApprovalServiceName = "xeon.approvals" as const;

export type ApprovalKind = "tool" | "plan" | "question";
export type ApprovalDecision = "allow" | "deny" | "answer";
export type ApprovalRemember = "once" | "thread" | "always";

export interface ApprovalOrigin {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly stepId: StepId | null;
  /** 이 요청을 일으킨 도구 호출. 질문·계획 도구도 도구 호출이므로 보통 채워진다 */
  readonly toolCallId: string | null;
  readonly caller: CallerId;
}

export interface ToolApprovalBody {
  readonly toolName: ToolName;
  readonly capability?: { readonly id: CapabilityId; readonly method: string };
  readonly risk: ToolRisk;
  /** 실행될 인자. 큰 값은 BlobRef */
  readonly args: Readonly<Record<string, JsonValue>> | BlobRef;
  readonly argsHash: string;
  /** ask를 낸 규칙. 모드가 낸 ask면 null */
  readonly ruleId: string | null;
}

export interface PlanApprovalBody {
  /** 계획 본문(마크다운). 큰 값은 BlobRef */
  readonly plan: string | BlobRef;
  /** L2.work의 계획 레코드 참조. 형식은 L2.work.spec */
  readonly planRef: string | null;
  /** 승인 때 고를 수 있는 다음 권한 모드 */
  readonly nextModes: readonly PermissionMode[];
}

export interface QuestionOption {
  readonly id: string;                 // 1~32자
  readonly label: string;
  readonly description?: string;
}
export interface QuestionItem {
  readonly id: string;
  readonly text: string;
  readonly options: readonly QuestionOption[];   // 빈 배열이면 자유 답
  readonly multiSelect: boolean;
  readonly allowFreeText: boolean;
}
export interface QuestionBody {
  readonly questions: readonly QuestionItem[];   // 1~4개
}

export type ApprovalBody =
  | { readonly kind: "tool"; readonly tool: ToolApprovalBody }
  | { readonly kind: "plan"; readonly plan: PlanApprovalBody }
  | { readonly kind: "question"; readonly question: QuestionBody };

export interface ApprovalRequestInput {
  readonly origin: ApprovalOrigin;
  /** 요청 멱등 키(1~48자). 같은 대화에서 같은 키의 두 번째 요청은 처음 요청을 돌려준다. 도구 승인은 toolCallId */
  readonly requestKey: string;
  readonly title: string;              // 화면 제목. 1~120자
  readonly body: ApprovalBody;
  /** 이 요청에서 고를 수 있는 기억 범위. 질문은 ["once"]만 */
  readonly remember: readonly ApprovalRemember[];
}

/** 단일 대기 형식. approval.requested payload와 같다 */
export interface ApprovalRequest extends ApprovalRequestInput {
  /** approval.requested 이벤트의 EventId(F.wire-settings.spec §4.6, review.decisions-2 U-02) */
  readonly approvalId: string;
  readonly surfaceThreadId: ThreadId;
  readonly requestedAt: number;
}

export type QuestionAnswer = Readonly<Record<string, { readonly selected: readonly string[]; readonly text?: string }>>;

export interface ApprovalResponse {
  readonly decision: ApprovalDecision;
  /** decision "answer"면 QuestionAnswer(question) 또는 { mode }(plan). decision "deny"면 { feedback } 허용 */
  readonly answer?: JsonValue;
  readonly remember?: ApprovalRemember;
}

export type ApprovalResolvedBy = "user" | "noninteractive" | "cancelled" | "superseded";

export interface ApprovalResolution {
  readonly approvalId: string;
  readonly decision: ApprovalDecision;
  readonly answer: JsonValue | null;
  /** 실제 적용한 기억 범위. 2차 전에는 "always"를 "thread"로 낮춰 적용한다(§4.7) */
  readonly remember: ApprovalRemember;
  readonly requestedRemember: ApprovalRemember | null;
  readonly resolvedBy: ApprovalResolvedBy;
}

/** 요청 이벤트 커밋이 실패한 이유 */
export type ApprovalRequestError =
  | { readonly kind: "store"; readonly error: StoreError }
  | { readonly kind: "rejected"; readonly code: string; readonly detail: string | null }
  | { readonly kind: "key_reused"; readonly requestId: string };

export interface ApprovalService {
  /** 요청을 커밋하고 응답이 올 때까지 기다린다. signal이 끊기면 대기만 그만둔다(요청은 남는다) */
  request(input: ApprovalRequestInput, signal: AbortSignal): Promise<Result<ApprovalResolution, ApprovalRequestError>>;
  /** wire approval.respond 처리. 이미 해결된 요청이면 applied: false */
  respond(approvalId: string, response: ApprovalResponse): Promise<{ readonly applied: boolean }>;
  /** 대화의 미해결 요청. 재개와 클라이언트 재접속 때 쓴다 */
  pending(threadId: ThreadId): readonly ApprovalRequest[];
  /** 재개 때 이벤트에서 미해결 요청을 다시 읽어 메모리 대기 목록을 채운다(§4.7) */
  restore(threadId: ThreadId): Promise<Result<readonly ApprovalRequest[], ReadFailure>>;
  /** 턴 취소 등으로 요청을 닫는다. resolvedBy "cancelled" */
  cancel(approvalId: string, reason: string): Promise<{ readonly applied: boolean }>;
}

export const ApprovalRequestSchema: TSchema;
export const ApprovalResolutionSchema: TSchema;
```

- wire 대응: `approval.respond { approvalId, decision, answer?, remember? }`(F.wire-settings.spec §3.3.1)가 `ApprovalService.respond(approvalId, { decision, answer, remember })`로 그대로 들어간다. 호스트(L4 host)가 이 호출을 한다.
- `approvalId`: 승인 요청은 내구 이벤트 `approval.requested`와 호스트 메서드 `approval.respond`로 한다 [결정: review.decisions-2 U-02]. `approvalId`는 `approval.requested` 이벤트의 `EventId`(`evt_` 접두)다. 같은 `requestKey` 재요청은 저장된 커밋 결과를 돌려받으므로(`replayed: true`) 같은 `approvalId`가 나온다.
- 종류별 응답 규칙:

| kind | 허용 decision | answer | remember |
|---|---|---|---|
| `tool` | `allow`, `deny` | deny일 때 `{ feedback: string }` 선택 | `once`, `thread`, `always` |
| `plan` | `allow`, `deny` | allow일 때 `{ mode: PermissionMode }` 선택(`nextModes` 안), deny일 때 `{ feedback }` 선택 | `once` |
| `question` | `answer`, `deny` | answer일 때 `QuestionAnswer` 필수(질문 id마다) | `once` |

- 응답 검사 규칙 [제안]: 모두 `respond`가 커밋 전에 한다. 어긋나면 `applied: false`이고 이벤트를 쓰지 않는다. 요청은 대기 상태로 남는다.
  - `tool`: `allow` 또는 `deny`. `remember`는 요청이 낸 범위 안이어야 한다.
  - `plan`: `allow`의 `answer`는 생략하거나 `{ mode?, note? }`다. `mode`는 요청 `nextModes` 안이어야 한다. `deny`의 `answer`는 `{ feedback }`만 받는다.
  - `question`: `answer`의 `QuestionAnswer`는 질문마다 항목이 하나씩 있고(`{ selected: string[], text?: string }`, 그 밖의 필드 없음), `selected`의 id는 그 질문의 선택지 안에 있고 중복이 없고, `multiSelect`가 거짓이면 하나 이하다. `allowFreeText`가 거짓이면 `text`가 없다. 선택도 `text`도 비면 거부한다. `deny`의 `answer`는 `{ feedback }`만 받는다.
  - `remember`: `plan`과 `question`은 `once`만 낸다.
- 요청 검사 [제안]: `request`와 `open`은 커밋 전에 입력을 본다. `requestKey` 1~48자, `remember`는 위 표대로, 질문은 1~4개이고 질문 id와 선택지 id(1~32자)가 각각 유일하고 선택지가 없는 질문은 `allowFreeText: true`여야 한다. `nextModes`는 모드 이름이고 중복이 없다. 어긋나면 `ApprovalRequestError { kind: "rejected", code: "approvals.request_invalid" }` 값이다. 이벤트 payload 스키마(`ApprovalRequestedPayloadSchema`)도 같은 시점에 확인해, 저장소가 Bug로 거부하기 전에 값으로 돌려준다(TY-24).
- 비차단 요청 [제안]: `ApprovalService.request`는 `open`과 `wait`을 합친 것이다. L2 어댑터는 `open`(커밋만 하고 현재 상태를 돌려준다. 같은 `requestKey`면 기존 요청의 현재 상태)과 `wait(approvalId, signal)`(해결이 기록되면 이행. signal이 끊기면 기다림만 그만두고 요청은 남는다), `get(approvalId)`로 `L2ApprovalsPort`(`request`/`wait`/`get`)를 만든다. 세 메서드는 core-tools 구현(`ApprovalsInternal`)에 있고 F `ApprovalService`에는 아직 없다(§8.3 F 요청 11).

### 3.7 결과 경계화 (`core-tools/src/bound.ts`)

출력 절단 함수(pi durable `truncate.ts` 포크)는 L0 `platform-exec`에 둔다. core-tools와 L2는 그 함수를 F 서비스 `xeon.exec`로 부른다 [결정: review.decisions-2 D-08]. 아래는 core-tools가 쓰는 모양이다. 메서드 이름과 F 위치(`@xeon/contracts/services`)는 `L0.exec.spec`이 정한다.

```ts
// platform-exec가 제공하는 절단(원본 truncate.ts의 export 이름과 시그니처 그대로). core-tools는 xeon.exec로 받는다
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
export interface TruncationResult { /* 원본 truncate.ts:14-37과 같다 */ }
export interface TruncationOptions { readonly maxLines?: number; readonly maxBytes?: number }
export function utf8ByteLength(content: string): number;
export function formatSize(bytes: number): string;
export function truncateHead(content: string, options?: TruncationOptions): TruncationResult;
export function truncateHeadOf(prefix: string, totals: { readonly lines: number; readonly bytes: number }, options?: TruncationOptions): TruncationResult;
```

```ts
// F tools.ts에 두는 공개 타입
export interface BoundedResult {
  /** 모델에 보낼 결과. 텍스트는 미리보기와 안내 문장 */
  readonly content: readonly (TextContent | ImageContent)[];
  /** 원문을 옮겼으면 그 blob. effect.result.blobRef에 들어간다 */
  readonly blobRef: BlobRef | null;
  readonly truncated: boolean;
  readonly totalLines: number;
  readonly totalBytes: number;
}
```

- 경계화 함수 `boundToolResult(value, limits, putBlob)`는 core-tools 내부 함수다. 공개 계약은 `BoundedResult`와 §4.8 규칙뿐이다.

### 3.8 오류

```ts
export type ToolsErrorCode =
  | "tools.name_conflict"        // 등록: 같은 순서 키·이름
  | "tools.too_many"             // 광고: always 도구만으로 MAX_TOOLS_PER_REQUEST 초과
  | "tools.intent_missing"       // 어댑터 execute에 커밋된 effect.intent가 없음(버그)
  | "tools.commit_failed"        // 효과 커밋이 StoreError로 실패
  | "tools.mode_forbidden"       // managed가 금지한 모드로 바꾸려 함
  | "approvals.unknown"          // 없는 approvalId
  | "approvals.invalid_response" // kind와 맞지 않는 decision·answer
  | "approvals.noninteractive";  // 비대화형 실행에서 question·plan 요청

export interface ToolsError { readonly kind: ToolsErrorCode; readonly message: string; readonly detail?: JsonValue }
```

- `tools.intent_missing`은 버그로 보고 예외를 던진다(eng.typescript.guide TY-11). 등록 충돌은 `register`가 `ToolRegisterError { kind: "name_conflict", toolName }` 값으로 돌려준다. 나머지도 값으로 돌려준다.
- 승인 요청 이벤트의 커밋 실패는 `ApprovalService.request`가 `ApprovalRequestError`(`store` | `rejected` | `key_reused`) 값으로 돌려준다. 파이프라인 안에서는 호출을 `tools.commit_failed`로 거부한다. 이벤트 읽기 실패(`restore`, `rerun`의 효과 상태 읽기)는 `ReadFailure` 값이다.
- 모델에 보이는 거부·오류 문장은 영어로 둔다. 형식은 `"[xeon:<code>] <message>"`이고 F.capabilities.spec §4.2 규칙 5의 `"[<code>] <message>"`와 같은 꼴이다.

### 3.9 이벤트

core-tools가 쓰는 코어 kind(F.records.spec §3.3 카탈로그):

| kind | 시점 | requestId [제안] |
|---|---|---|
| `effect.intent` | 정책·승인 통과 뒤, 실행 전(§4.2 6단계) | `tool:<toolCallId>:intent`. 이 표의 `<toolCallId>`는 F `commitKeyPart`의 값이다(review.decisions-2 U-13) |
| `effect.exec` | 키 잠금·슬롯을 얻은 뒤 실행 직전(§4.2 7d단계) | `tool:<toolCallId>:exec` |
| `effect.result` + toolResult `item.recorded` | 결과 경계화 뒤 한 커밋(§4.2 10단계) | `tool:<toolCallId>:result` |
| `settings.changed` | 권한 모드 변경(세션 범위) | `mode:<threadId>:<clientUlid>` |

`approval` 코어 영역과 두 kind는 F.records.spec §3.2·§3.3 카탈로그에 있다(§8.3 F 요청 3 반영, 승인 요청 A안: review.decisions-2 U-02). payload 정본은 이 절이다.

```ts
// F records/catalog/approval.ts (요청안)
export type ApprovalRequestedPayload = Omit<ApprovalRequest, "approvalId">;   // approvalId = envelope id
export type ApprovalResolvedPayload = ApprovalResolution;
```

| kind | durable | payload | requestId |
|---|---|---|---|
| `approval.requested` | 예 | `ApprovalRequestedPayload` | `approval:<threadId>:<requestKey>:request` |
| `approval.resolved` | 예 | `ApprovalResolvedPayload` | `approval:<approvalId>:resolve` |

- 이벤트는 `surfaceThreadId` 대화에 기록한다. 그래야 서브에이전트의 승인 요청이 부모 대화 구독자에게 보인다. 요청을 낸 대화는 payload `origin.threadId`에 남는다 [제안].
- [제안] 이벤트 소유: `effect.*`, `approval.*`는 `tool-runtime`(core-tools) 소유다. eng.context-map.design §5.1 표의 `tool.` 행을 F 이름 `effect.`로 바꾸도록 요청한다(§8.4).
- requestId 길이: `approval:<threadId>:<requestKey>:request`는 `thr_` ULID(30자) + 키 48자로 64자를 넘을 수 있다. 64자를 넘으면 `approval:` + `sha256(threadId + ":" + 키 부분)` 앞 32자 + `:request`로 바꾼다 [제안].
- 키 부분: 도구 승인의 `requestKey`는 `toolCallId`에서 `commitKeyPart`(F.records.spec §3.9, eng.transactions.design §4.7, U-13)로 만든다. `toolCallId`는 provider가 정하는 밖의 값이라 커밋 키 알파벳 밖 문자를 가질 수 있기 때문이다. 결과가 48자를 넘으면 `h_` + 원문 sha256 앞 40자로 줄인다. 호출자가 직접 넘긴 `requestKey`도 커밋 키에 넣기 전에 `commitKeyPart`를 거친다(`h_` + 해시 40자 형식은 그대로 쓴다) [제안].

## 4. 동작 규칙

### 4.1 노출

[제안] 광고 목록은 고정하고, deny된 도구는 빼고, 나머지는 tool search로 늦게 노출한다. 계획 v2 구성요소 표기를 따른다(`_research/layer-plan-v2.json` L1-d "도구 노출 분리").

1. 순서: 등록된 도구 전체에 `orderTools`(F.capabilities.spec §3.8)를 적용한다. 능력 밖 도구도 같은 비교 함수에 넣는다(§3.1 순서 키). 광고 목록의 순서는 이 결과의 부분 수열이다. 그래서 같은 등록 상태면 입력 순서와 무관하게 같은 목록과 같은 `fingerprint`가 나온다.
2. 전역 deny 제거 [제안]: 도구마다 `PolicyInput{ args: null }`로 `evaluatePolicy`를 부른다. 결과가 `deny`이고 그 규칙의 resource에 `args`와 `mode` 조건이 없으면 광고 목록에서 뺀다. 거부 응답을 내는 대신 목록에서 빼는 방식은 Gemini CLI 정책 엔진에서 가져왔다(`_research/item-catalog.md` 진보된 설계 5번, opencode `registry.snapshot(permissions)` `_research/refs/opencode.md` 161행). 인자나 모드에 따라 달라지는 deny는 목록에 남기고 실행 시점에 거부한다.
3. 모드에 따른 제거는 하지 않는다 [제안]. 계획 모드의 쓰기 차단(§4.6)은 실행 시점에 거부한다. 모드를 바꿀 때마다 광고 목록이 바뀌면 프롬프트 캐시 접두가 깨지기 때문이다(`_research/ref-synthesis.md` L1 코어 (c) 캐시 원칙).
4. 지연 노출 [제안]:
   - `exposure: "always"`는 항상 광고한다. 내장 도구와 L2 작업 도구의 기본값이다.
   - `exposure: "deferred"`는 처음부터 지연 도구다.
   - `exposure: "auto"`는 광고 후보 수(always + auto)가 `l1.tools.exposure.deferThreshold`를 넘으면 지연 도구가 된다. MCP 서버 도구의 기본값이다.
   - 지연 도구가 하나라도 있으면 내장 도구 `tool_search`(순서 키 `core.tools`)를 광고한다. `tool_search`는 질의(`query: string`, `limit?: number`)로 지연 도구의 이름·설명을 찾고, 결과로 고른 도구를 활성화한다. 활성화된 도구는 다음 단계부터 광고된다.
   - 대화 중간의 추가는 L1.context.spec이 `diffToolsets`의 `added`를 pi-ai `SystemMessage.toolsAdded`로 대화 기록에 넣는다(F.capabilities.spec §4.5). Anthropic 경로에서는 pi-ai가 `tool_addition` 블록으로 바꾸고, 첫 요청의 지연 자리표시 도구(`anthropic-messages.ts:200-209`, `defer_loading: true`)가 캐시 접두를 지킨다(`anthropic-messages.ts:1141-1149`).
5. 활성화 상태는 이벤트에서 다시 계산한다. `tool_search`의 `effect.result.output.structuredContent`에 `{ activated: ToolName[] }`를 남기고, `advertise`의 `activated`는 그 대화의 이 값들의 합집합이다. 재개 뒤에도 같은 광고 목록이 나온다.
6. 도구 수 상한: 광고 목록(내장 `tool_search` 포함)은 `MAX_TOOLS_PER_REQUEST = 128`(F.capabilities.spec §4.3) 이하다. core-tools가 집행한다.
   - always + auto 후보가 128을 넘으면 auto 도구를 순서 뒤쪽부터 지연 도구로 돌린다.
   - always 도구만으로 128을 넘으면 `advertise`가 `tools.too_many` 오류를 돌려주고 루프는 그 단계의 모델 요청을 보내지 않는다.
   - `tool_search`의 활성화가 상한을 넘기면 넘는 도구는 활성화하지 않고 결과 문장에 그 사실을 적는다.
7. 서브에이전트 대화의 광고 목록은 L1.agents.spec의 권한 상한을 따른다. `allow` 밖 도구와 자식 기준 전역 deny 도구를 뺀다. `keepParentList`를 주면 부모 광고 목록을 그대로 쓰고 실행 시점에만 거른다(캐시 접두 공유).
8. [미결] Anthropic 서버 도구 `tool_search`(서버 쪽 지연 로딩)를 쓸지. pi-ai 1.3.0은 Anthropic에서 `defer_loading`을 자리표시 도구에만 쓴다(`ai/src/api/anthropic-messages.ts:208`). provider 독립인 내장 `tool_search`를 1차로 두고 서버 도구는 2차 검토로 둔다 [제안].

### 4.2 실행 파이프라인

[결정: adr.0009] 순서는 pi-agent-core 1.3.0 파이프라인(`agent-loop.ts:684-949`)의 준비·실행·마감을 그대로 가져와 `prepare`·`execute`·`settleRejected` 세 메서드로 나눈 것이다. 원본의 `beforeToolCall`·`afterToolCall` 훅 자리는 없다. 정책·승인·효과 기록은 이 메서드 안의 단계다(`_research/packages.md` §4.3 L1-d "실행 파이프라인: 그대로"). 원본 줄 번호는 대조용이다(1.3.0 소스는 1.1.0과 바이트 동일, `_research/notes/L1-1.md` §2).

| # | 단계 | 위치 | 실패 처리 |
|---|---|---|---|
| 1 | `tool_execution_start` 발화(tap) | `prepare` 첫 단계 | 기록 후 계속 |
| 2 | 도구 이름 해석 | `prepare`. 원본 agent-loop.ts:716-722 | 없으면 `[xeon:tool_unavailable]` 오류 결과(`settled`) |
| 3 | 인자 준비 | 없다. 도구별 `prepareArguments`는 F `AgentTool`에서 뺐다(F.conversation.spec §3.1.1) | — |
| 4 | 스키마 검증 `validateToolArguments` | `prepare`. core-tools `validate.ts`가 pi-ai 1.3.0 `validateToolArguments`의 TypeBox 경로(argumentsError 확인, 사본, 선택 null 제거, `Value.Convert`, 스키마 검사)를 옮겼다. TypeBox 표지가 없는 순수 JSON Schema(MCP)의 `coerceWithJsonSchema` 경로는 옮기지 않았다(M2 cap-mcp에서 더한다) | 예외 대신 `settled` 오류 결과로 모델에 돌아간다 |
| 5a | `tool_call` 지점(first) | `prepare` | 핸들러 예외는 `FIRST_DENY.tool_call`로 거부(fail-closed). 디스패처 자체 예외도 거부 |
| 5b | 정책 평가 `evaluatePolicy`. 자식 대화(`ceiling` 있음)는 §4.5 ceiling 단계 적용 | `prepare` | deny는 `settled` |
| 5c | 승인 대기(ask일 때) | `prepare`. `ApprovalService.request` | deny·cancelled는 `settled` |
| 5d | 중단 확인 | `prepare`. 의도를 쓰기 전에 turn 신호를 본다 | 중단이면 `settled`(`[xeon:aborted]`) |
| 6 | `effect.intent` 커밋 | `prepare`의 끝 | 커밋 실패는 `settled`(`[xeon:tools.commit_failed] …`) |
| 7a | tool 범위 노드 열기: `xeon.tasks.find("turn", run.turnId)`로 turn 노드를 찾고 `openScope(turn, { kind: "tool", id: toolCallId })`(L1.tasks.spec §4.1) | `execute` 진입 | 의도가 없으면 `tools.intent_missing`(호출 순서 위반, Bug). turn 노드가 `aborting`이면 신호가 켜진 노드를 받고 중단 결과로 끝난다 |
| 7b | 잠금 키 산출: 도구의 잠금 선언(`ToolSpec.locks`, L1.tasks.spec FR-T6)이 낸 경로마다 `xeon.exec`의 `canonicalPath`로 정규 경로를 얻어 키 `${env.id}\0${realpath}`를 만든다. 없는 파일은 부모 정규 경로 + 이름이다. 읽기 도구(`hints.readOnly`)는 `shared`, 그 밖은 `exclusive`다 | 같은 자리 | 잠금 선언이 없으면 키 큐를 쓰지 않는다. 경로 해석 실패는 `invalid_input` 오류 결과다 [제안] |
| 7c | 키 잠금 뒤 `tools` 풀 슬롯 획득: `xeon.tasks.locks.run(keys, toolNode, () => limiter("tools").acquire(toolNode) …)`. 순서는 L1.tasks.spec §4.5 C3(키 먼저, 슬롯 나중)이다. M1은 키 잠금만, 슬롯은 M2 | 같은 자리 | 대기 중 취소는 중단 결과다. `effect.exec` 전이므로 재개 판정은 `not_started`다 |
| 7d | `effect.exec` 커밋 | 같은 자리 | 커밋 실패는 실행하지 않고 `tools.commit_failed` 결과 |
| 8 | 도구 실행 | 어댑터가 provider 메서드 또는 `DirectToolRegistration.tool.execute`를 부른다. `signal`은 tool 노드 신호다. 진행은 `onUpdate` 콜백과 `tool_execution_update`(tap)이고 발화 전에 비밀 마스킹을 거친다(§4.12) | 예외는 오류 결과, `CapabilityError`는 §4.3. 실행이 끝나면 슬롯을 반납한다(C1) |
| 9 | `tool_result` 지점(chain) | `execute`의 마감. 페이로드는 마스킹한 결과다(§4.12) | 실패한 핸들러의 패치만 버린다(skip) |
| 10 | 결과 경계화 + `effect.result`·toolResult `item.recorded` 한 커밋. 커밋 뒤 tool 노드가 정착한다 | `execute`의 마감 | 커밋 실패는 §5 사례 7(`itemId: null`) |
| 11 | `tool_execution_end` 발화(tap) | 마감 뒤 | 기록 후 계속 |

부속 규칙:

- 단계 1~6은 한 `prepare` 호출 안에서 순서대로 실행한다. `prepare`는 예상 가능한 실패를 모두 `settled`로 돌려주고 던지지 않는다(Bug 제외). core-tools는 거부 사유를 직접 정해 모델에 보이는 문장을 고정한다.
- `execute`는 예상 가능한 실패를 던지지 않는다. 도구가 던진 오류는 `isError` 결과가 된다. chain의 핸들러별 skip은 ext-host 디스패처가 한다(F.extensions.spec §4.1).
- 의도 커밋에 넣는 인자는 단계 5a 이후의 최종 인자다. 1.3.0의 `BeforeToolCallResult`에는 인자 재작성 필드가 없으므로(agent `types.ts:66-74`) 최종 인자는 검증된 인자와 같다. 인자 재작성은 §4.10(2차)이다.
- 병렬 모드에서 루프는 배치의 준비(단계 1~6)를 앞 호출부터 하나씩 마친 뒤 실행을 함께 시작한다(L1.loop.spec §3.3 규칙 2·3, 원본 agent-loop.ts:596-648). 그래서 한 배치 안의 승인 요청은 앞 호출부터 차례로 하나씩 나간다 [제안]. 여러 요청을 묶어 한 번에 보이는 화면은 L4가 `pending()`으로 만들 수 있다.
- `tool_execution_start`는 거부될 호출에도 발화한다(원본 agent-loop.ts:543, 598). 그래서 의도 기록의 근거로 쓰지 않는다(`_research/notes/L1-1.md` §3(c)).
- 중단으로 실행하지 않는 호출은 루프가 같은 배치 안에서 `settleRejected(…, "not_executed")`로 닫는다(L1.loop.spec §3.3 규칙 4). core-tools는 그 호출들을 의도가 있으면 `effect.result{ status: "abandoned" }`와 toolResult item 한 커밋으로, 의도가 없으면 toolResult item 하나(`effectId: null`)로 기록한다. `stopReason: "length"`로 잘린 응답의 호출은 `"truncated"`로 닫는다. 같은 호출을 두 번 닫아도 처음 결과를 돌려주고 다시 쓰지 않는다.
- 차단된 호출(2~5d 실패)에는 효과 이벤트가 없다. 그 오류 결과는 core-tools가 `prepare` 안에서 toolResult `item.recorded`(`effectId: null`, 커밋 키 `tool:<key>:result`)로 기록한다. 루프는 toolResult item을 직접 기록하지 않는다.
- 같은 파이프라인 밖에서 도구를 실행하는 경로는 두지 않는다. 도구가 다른 도구를 부를 때도 `prepare`·`execute`를 지나야 하고, 중첩 호출의 `ToolCallPayload.parentToolCallId`를 채운다. 중첩 호출의 진입점 이름과 위치는 [미결](§10)이다.
- 태스크 엔진 연결 규칙 [제안]:
  - tool 노드의 작업은 7a~10단계다. 어댑터는 이 구간을 `toolNode.track(…)`으로 등록한다. 그래서 turn 취소(L1.tasks.spec §4.2)는 실행 중 도구의 신호를 켜고, turn 노드는 10단계 커밋이 끝난 뒤 정착한다.
  - 서브에이전트를 부르고 결과를 기다리는 도구(core-agents의 `agent` 도구)는 기다리는 동안 `slot.suspendWhile(child.settle())`로 `tools` 슬롯을 내려놓는다(L1.tasks.spec §4.5 C2, L1.agents.spec §4.1 4번). 슬롯은 7c에서 얻은 것을 어댑터가 실행 맥락으로 넘긴다.
  - 7b의 키 산출 함수(durable `file-mutation-queue.ts` 7-26행 `mutationKey`, `canonical`)는 core-tools로 옮긴다(L1.tasks.spec §4.4 포크 2번). 파일 시스템 접근은 `xeon.exec`만 쓴다(DR-13).
  - 능력 밖 도구(`DirectToolRegistration`)는 M1에 잠금 선언이 없다. 필요해지면 같은 모양의 선택 필드를 더한다 [제안].
  - `rerun`(§4.9)도 7a~11단계를 지나므로 키 잠금과 슬롯을 다시 얻는다.

### 4.3 어댑터 환원

능력 도구의 `ToolSpec` → 도구 항목(`ToolEntry`)과 실행 함수 변환(core-tools `entries.ts`)은 F.capabilities.spec §3.3 대응표와 §4.2 환원 규칙 5단계를 그대로 따른다. 이 문서는 L1 쪽 결정만 더한다.

| F.capabilities §4.2 단계 | core-tools 구현 |
|---|---|
| 1. 인자 검증 | `prepare` 4단계(core-tools `validate.ts`, §4.2)가 한다. 어댑터는 다시 검증하지 않는다 |
| 2. `toInput` | 어댑터 `execute` 안에서 부른다 |
| 3. 메서드 호출 `api[method](input, { signal, requestId })` | `requestId`는 `tool:<toolCallId>`다 [제안]. `signal`은 `execute`가 합친 신호(루프가 넘긴 호출 신호, turn 신호, tool 노드 신호) |
| 4. `toContent` 또는 기본 렌더링 | 결과를 `AgentToolResult`로 만든다. `structuredContent`는 `outputSchema`로 검증하고 위반은 `internal` 오류 결과로 바꾼다(F.capabilities.spec §5 사례 3) |
| 5. `CapabilityError` → `isError: true` | `content`는 `"[<code>] <message>"`, `details`는 `CapabilityErrorData`. `code: "aborted"`는 중단 결과로 처리하고 `effect.result.status`를 `interrupted`로 둔다 |

- `replay`: 능력 도구는 `ToolSpec.replay`(F `ReplayPolicy`, 미선언은 `"unsafe"`)를 그대로 쓴다. `DirectToolRegistration`은 F `AgentTool.replay`(`"never" | "safe"`)를 `toReplayPolicy`로 바꾼다(`"never"`·미선언 → `"unsafe"`). `effect.intent.replay`에는 이 F `ReplayPolicy` 값을 쓴다.
- `label`, `executionMode`, `outputSchema`는 그대로 옮긴다. `hints`는 `ToolMeta.hints`로 보관하고 위험 등급 유도(§4.6)에 쓴다.
- `input_required` 출력 변형 [결정: L1A.4]: 판별 필드는 `status: "input_required"`다(L2.dialog `ask`, L2.work `submit`, L2.mcp `callTool`의 출력 변형이 모두 이 필드를 쓴다). 어댑터는 메서드 출력을 렌더링하기 전에 이 변형을 본다.
  - `approvalId`가 있으면(도구가 자기 승인을 이미 올렸다. dialog, work) 어댑터는 그 승인의 해결을 기다린다. 해결이 기록되면 같은 입력, 같은 `requestId`로 메서드를 다시 부른다. 도구는 같은 `requestId`의 재호출에서 저장된 답으로 완료 결과를 낸다(L2.dialog.spec §4.1.2 6번). 대기하는 동안 호출의 `effect.intent`와 `effect.exec`는 커밋되어 있고 `effect.result`는 없다. 한 효과에 provider 호출이 여러 번 있는 셈이다.
  - 대기는 호출 신호를 따른다. turn이 취소되면 그 승인을 `cancelled`로 닫고(§4.7 8번) 호출은 `[aborted]` 중단 결과가 된다. 승인이 이 프로세스의 메모리에 없으면 `[xeon:approval_unknown]` 오류 결과다.
  - 같은 호출에서 `input_required`를 이어 받는 횟수는 8번까지다. 해결된 승인을 되풀이해 가리키는 도구가 무한히 도는 것을 막고, 넘으면 `[xeon:input_required_loop]` 오류 결과다.
  - `approvalId`가 없는 변형(L2.mcp의 `inputRequests`와 `requestState`)은 아직 처리하지 않는다. 일반 결과로 기록한다. D5(a)대로 L1.tools가 `question` 승인을 올리고 `continuation`으로 다시 부르려면 F의 `CallOptions`에 연속 정보 필드와 MCP 질문을 `QuestionBody`로 옮기는 규칙이 필요하다(§8.3 F 요청 12).
  - 재시작 뒤: 대기 체크포인트(`waiting: "approval"`)와 열린 효과가 남는다. `ask_user`, `submit_plan`은 `replay: "safe"`라 `decideEffectRecovery`가 `rerun`을 내고, `rerun`이 같은 경로로 도구를 다시 부르면 도구는 같은 `requestId`로 기존 승인을 이어 받는다.

### 4.4 효과 기록

[결정] 외부 효과는 의도를 커밋한 뒤 트랜잭션 밖에서 낸다(eng.transactions.design TX-02, `_research/foundation-plan.md` §1 결정 1이 인용한 durable spec 1917-1927).

1. 불변식: 어댑터 `execute`는 그 `toolCallId`의 `effect.intent`가 커밋된 뒤에만 provider를 부른다. core-tools는 의도 커밋 결과(`CommitResult.status: "committed"`)를 대화별 메모리 표에 넣고, `execute`는 이 표에 항목이 없으면 provider를 부르지 않고 `tools.intent_missing` 버그로 끝낸다. 읽기 도구도 같다. 예외를 두지 않는다(eng.transactions.design §5.1 불변식 1).
2. `effect.intent` 필드: `effectId`(IdFactory `efx_`), `toolCallId`, `toolName`, `itemId`(도구 호출 item), `argsHash`(최종 인자 정규화 JSON의 sha256 hex), `args`(256 KiB를 넘으면 `BlobRef`), `replay`(§4.3), `idempotencyKey`(도구가 주면 그 값, 없으면 null). F.records.spec §3.5와 같다.
3. `effect.exec`는 의도와 별도 커밋이다 [제안]. 두 커밋을 나누면 재개 때 "실행 시작 전 중단"(`not_started`)과 "실행 중 중단"(`outcome_unknown`)이 구분된다(F.records.spec §3.5 결정표).
4. `effect.result`와 toolResult `item.recorded`는 한 커밋이다. `effect.result.resultItemId`는 같은 커밋의 item id, `output`은 `{ structuredContent, terminate, status, inputRequired }`, `blobRef`는 경계화로 옮긴 원문(§4.8), `durationMs`는 어댑터가 잰 실행 시간이다.
5. 도구별 커밋: 의도·실행·결과는 도구 호출마다 따로 커밋한다(E1 의도, E2 실행 시작, E3 결과). ADR-0004 §3.2 3번의 보충으로 올리고 단계당 커밋 수는 `3 + 3n`이다 [결정: review.decisions-2 U-10]. eng.transactions.design §4.1 C3은 모델 응답 확정 커밋에 호출마다 의도를 넣는다고 적었지만, 승인 대기(§4.7)가 의도 앞에 오므로 응답 확정 때는 의도를 쓸 수 없다. architecture.runtime-flow.design §4.1 그림도 도구마다 의도를 커밋한다. eng.transactions.design은 이 모양으로 고쳤다(§4.1·TX-08).
6. 커밋은 모두 `xeon.session`의 커밋 경로(eng.transactions.design TX-07 `SessionWriter.commit`)로 한다. core-tools는 세션 테이블에 직접 쓰지 않는다.

### 4.5 정책 평가

[제안] 규칙은 `{action, resource, effect}`이고 결과 우선은 deny > ask > allow, 관리 설정이 최우선이다(`_research/ref-synthesis.md` L1 코어 (d) 권한, `_research/item-catalog.md` L1-d "선언형 정책 엔진"). 설계는 Gemini CLI 정책 엔진과 opencode `permission.ts`를 참고한다. 두 코드는 가져오지 않는다(`_research/packages.md` §4.3 L1-d). [가정] Gemini 정책 엔진의 내부 결합도는 확인하지 않았다. 규칙 표현만 참고한다.

`evaluatePolicy(input, rules)` 순서 [제안]:

1. 일치 규칙 M = `rules` 중 `action`이 같고 `ruleMatches`가 참인 것.
2. M에 `effect: "deny"`가 하나라도 있으면 deny다. 가장 높은 티어, 그 안에서 가장 큰 priority의 deny 규칙을 `ruleId`로 낸다. 어느 티어의 allow도 deny를 뒤집지 못한다. 그래서 상위 티어 deny는 하위 allow에 지지 않는다.
3. 모드 `plan`이고 `input.risk`가 `write` 또는 `exec`이면 deny(`reason: "mode"`)다(§4.6).
4. 모드 `bypass`이면: `bypassAllowed`가 거짓이면 모드를 `default`로 보고 계속한다(`reason`에 `bypass_forbidden` 표시). 참이면 allow(`reason: "mode"`)다.
5. M이 비지 않으면 M에서 가장 높은 티어의 규칙만 남긴다. 그 안에서 가장 큰 priority의 규칙만 남긴다. 남은 규칙 중 ask가 있으면 ask, 아니면 allow다(`reason: "rule"`).
6. M이 비면 모드 기본값(§4.6 표)이다(`reason: "mode"`).
7. 결과가 ask이고 `interactive`가 거짓이면 deny(`reason: "noninteractive"`)다.

- 상위 티어 우선(5단계)으로 사용자 규칙이 기본 규칙의 ask를 allow로 풀 수 있고, managed 규칙이 사용자 규칙을 덮는다. deny는 2단계에서 티어와 무관하게 확정된다.

ceiling 단계(파이프라인 5b, 자식 대화) [제안]:

- `ToolRunContext.ceiling`이 있으면 5b의 결정은 `stricter(childDecision(call, parent, child, rules), evaluatePolicy(input, rules))`다. `parent`는 `ToolRunContext.ceiling`, `child`는 자식 관점 입력(caller, depth, 자식 모드)이다. `childDecision`은 부모 관점 평가, 자식 관점 평가, 정의 제한(`ceiling.allow`)을 `stricter`로 합치는 순수 함수다(L1.agents.spec §4.3 1번). F `policy.ts`에 두도록 요청한다(§8.3 F 요청 9, L1.agents.spec §8.3 5와 같은 항목).
- `evaluatePolicy` 자체는 ceiling을 받지 않는다. ceiling 단계는 파이프라인이 평가기 바깥에서 적용한다. 그래서 위 1~7단계의 순수성과 번호는 그대로다.
- 합친 결과가 ask이고 `interactive`가 거짓이면 deny(`reason: "noninteractive"`)다. 7단계와 같은 규칙이다.
- `childDecision`이 F에 들어가기 전에는 ceiling 단계를 켜지 않는다. 그 사이 자식 대화는 M2 착수 조건을 채우지 못한 것으로 본다(L1.tools.plan TL-13 선행).
- `ruleMatches`의 glob은 `*`(구분자 없는 임의 문자열)와 `?`만 쓴다. 정규식은 규칙 적재 때 `validateRules`로 한 번 컴파일해 캐시하고, 잘못된 규칙은 적재하지 않고 진단으로 남긴다. 평가 중에 예외를 던지지 않는다.
- 평가기는 순수 함수다. 시각, 난수, 파일, 설정 읽기를 하지 않는다. 규칙 목록과 모드는 호출자가 넘긴다. 같은 입력이면 같은 결과다(§9 수용 기준).

티어와 규칙 출처 [제안]:

| 티어 | 출처 | 예 |
|---|---|---|
| `default` | core-tools 내장 규칙, L1 패키지가 `registerRules("core:<도메인>", …)`로 넣은 규칙(L1.agents.spec의 자식 차단 규칙) | `default.read-allow`, `subagent.no-spawn` |
| `extension` | 확장이 등록한 규칙(2차: 매니페스트 선언). M2까지는 내장 그룹만 | Helm이 쓰기 금지를 규칙으로 표현할 때 |
| `user` | 설정 `l1.tools.rules`의 `user`, `project`, `local`, `session` 범위 값 | `{ tool: "bash", args: [{ pointer: "/command", pattern: "^git status" }], effect: "allow" }` |
| `managed` | 설정 `l1.tools.rules`의 `managed` 범위 값 | `{ tool: "*", mcpServer: "untrusted-*", effect: "deny" }` |

- 설정 범위별 규칙 수집 [제안]: F.wire-settings.spec §4.7 규칙 2는 키 하나의 값을 통째로 바꾼다. 정책 규칙은 범위마다 모아야 한다. 그래서 core-tools는 `l1.tools.rules`를 유효 값 하나로 읽지 않고 범위별 층(`ScopeStack`)에서 각각 읽어 티어를 붙인다. 이 읽기 방식을 SettingDef에 표시하는 필드(예: `merge: "collect"`)를 F.wire-settings.spec에 요청한다(§8.3 F 요청 5).
- 코어 규칙 등록 [제안]: L1 패키지는 `ToolService.registerRules(source, rules)`로 default 티어 규칙을 넣는다. `source`는 `core:<도메인>`이고 `TieredRule.source`에 그대로 들어간다. 같은 `source`로 다시 부르면 그 출처의 규칙을 통째로 바꾼다. core-agents는 `l1.agents.maxDepth`가 바뀔 때 차단 규칙을 다시 등록한다. 등록은 `validateRules`를 거치고, 문제가 있는 규칙은 적재하지 않고 `RuleRegistration.issues`로 돌려준다. 규칙 변경은 다음 단계 경계의 `advertise`와 다음 도구 호출 평가부터 적용한다(M2).
- 내장 기본 규칙(M1): `default.read-allow`(risk `read` → allow), `default.ls-allow`, `default.read-tool-allow`(도구 `read`, `ls` → allow), `default.bash-ask`(도구 `bash` → ask). 나머지는 모드 기본값을 따른다.
- 확장의 `tool_call` 핸들러와 정책 규칙의 관계: 둘 다 거부할 수 있다. 핸들러는 그룹 상태에 따라 바뀌는 동적 판정(예: Helm 확산 단계의 쓰기 거부, L3.helm.spec §4.6)에 쓰고, 규칙은 선언형 정적 판정에 쓴다. 순서는 핸들러(5a) 뒤 정책(5b)이다. 핸들러가 거부하면 정책과 승인을 부르지 않는다. 그래서 사용자는 이미 거부된 호출의 승인 요청을 받지 않는다.

### 4.6 권한 모드와 위험 등급

[제안] 모드는 기본, 자동 편집, 계획, 전체 허용 네 가지다. 계획 v2 구성요소 표기를 따른다(`_research/layer-plan-v2.json` L1-d "권한 모드").

| 모드 | read | write | exec | 비고 |
|---|---|---|---|---|
| `default` | allow | ask | ask | 기본값 |
| `acceptEdits` | allow | allow | ask | 편집 도구 자동 허용 |
| `plan` | allow | deny | deny | 쓰기 도구 차단. 계획 승인(§4.7)으로 빠져나온다 |
| `bypass` | allow | allow | allow | 규칙 ask도 allow. deny 규칙은 남는다. managed가 `l1.tools.bypassAllowed = false`로 금지할 수 있다 |

- 위험 등급 [제안]: 도구가 등급을 선언하고 선언이 없으면 가장 위험한 쪽을 쓴다(`_research/item-catalog.md` L1-d "위험 등급과 승인 필요 선언", omp 미선언 시 exec). 등급과 재생 선언은 도구 등록 필드로 받는다. 미선언 등급은 `exec`, 미선언 재생은 `unsafe`다.
- 등급 유도 [제안]: `ToolPolicyMeta.risk`가 있으면 그 값이다. 없으면 `hints.readOnly === true`면 `read`, 그 밖은 `exec`다. MCP annotation(`readOnlyHint` 등)은 `hints`로 들어오는 입력일 뿐이다. annotation이 `destructiveHint: false`라도 등급을 `write`로 낮추지 않는다. 신뢰할 수 없는 서버의 선언이기 때문이다.
- 위험 등급은 F `ToolSpec`에 필드가 없다. F.capabilities.spec에 `risk?: ToolRisk`, `classes?: ToolClass[]` 추가를 요청한다(§8.3 F 요청 1). 추가 전에는 `CapabilityToolsRegistration.policy`로 받는다.
- 권한 모드는 세션 범위 설정 `l1.tools.permissionMode`의 유효 값이다. 모드 변경은 다음 도구 호출부터 적용한다(`runtimeChange: "live"`). 이미 승인 대기 중인 요청은 모드가 바뀌어도 그대로 둔다.
- 비대화형 실행: [제안] 비대화형 실행에서 ask는 deny로 해석한다(`_research/item-catalog.md` L1-d "권한 모드"). `ToolRunContext.interactive`는 turn을 시작한 쪽이 정한다 [제안]. 사용자 입력 turn(`turn.start`)은 대화형, 예약 실행(L2.schedule)과 헤드리스 CLI 실행은 비대화형이다. drive와 위임 turn은 부모 대화를 따른다.
- 보류 [제안: 카탈로그 "보류" 표기를 따른다]: 자동 분류 모드(별도 모델이 ask를 판정)와 자동 승인 리뷰어·연속 거부 서킷브레이커(`_research/item-catalog.md` L1-d, 진보된 설계 3·4번)는 이 문서 범위 밖이다. 도입하면 리뷰어 장애 시 거부하는 쪽으로 설계한다. 모델 자가 위험도(OpenHands `security_risk`)는 정책 입력의 하나로만 검토한다.

### 4.7 승인 프로토콜

[결정] 도구 승인, 계획 승인, 사용자 질문은 하나의 대기 형식으로 처리하고 대기 상태는 L1-f에 저장한다(`_research/layer-plan-v2.json` L1-d "승인과 질문 프로토콜", `_research/foundation-plan.md` §1 결정 5).

흐름:

1. 요청자: 도구 승인은 core-tools 파이프라인(§4.2 5c)이 낸다. 질문과 계획 승인은 L2 dialog·work 능력이 자기 도구의 실행 안에서 `xeon.approvals.request`를 부른다(eng.context-map.design §4.4 표 3행).
2. 커밋: `request`는 한 커밋에 `approval.requested`와 `checkpoint.step`(`ToolRunContext.drafts.waitingCheckpoint`, `next: "await_input"`(L1.loop.spec §4.5 재진입 표), 해당 호출의 `pendingToolCalls[].waiting = "approval"`)을 쓴다. requestId는 §3.9 표다. 커밋 뒤 `ui_prompt_start`를 발화한다.
   - L2가 낸 요청은 `origin.toolCallId`로 core-tools의 활성 호출 표에서 그 호출의 `ToolRunContext`를 찾아 체크포인트 초안을 만든다. 도구 승인은 의도 전이라 `pendingToolCalls[].effectId`가 null이고, 도구 실행 안에서 낸 질문·계획 요청은 그 호출의 `effect.intent`의 `effectId`를 싣는다. `waiting`은 모두 `"approval"`이다(저장소의 A1 예외가 이 값만 받는다). 활성 호출이 없는 요청(그룹 코드가 턴 밖에서 낸 요청)은 체크포인트 없이 이벤트만 쓴다.
3. 대기: 메모리 대기 목록에 넣고 응답을 기다린다. 대기 중에 도는 프로세스는 없다(architecture.runtime-flow.design §4.5).
4. 응답: `respond`가 kind별 규칙(§3.6 표)을 검사하고 `approval.resolved`를 커밋한다. 커밋 뒤 대기를 풀고 `ui_prompt_end`를 발화한다. 같은 `approvalId`의 두 번째 응답은 `applied: false`다.
5. 결과 반영:
   - tool: allow → 파이프라인 6단계로 간다. deny → `{ block: true, reason }`. 사유 문장은 `"[xeon:denied_by_user] The user denied this tool call."`에 feedback이 있으면 `" Feedback: <feedback>"`를 붙인다.
   - plan: allow이고 `answer.mode`가 있으면 `ToolService.setMode(threadId, mode, "plan_approval")`을 부른다. 계획 도구의 결과 내용은 L2.work.spec이 정한다.
   - question: `QuestionAnswer`를 질문 도구에 돌려준다. 결과 문장은 L2.dialog.spec이 정한다.
6. 기억 범위:
   - `once`: 이번 호출만.
   - `thread`: 같은 소유 트리 루트 대화가 끝날 때까지 같은 도구·같은 `ruleId`(규칙이 낸 ask) 또는 같은 도구(모드가 낸 ask)의 ask를 allow로 본다. 저장은 `approval.resolved` 이벤트 자체다. core-tools는 재개 때 이 이벤트에서 세션 허용 목록을 다시 만든다.
   - `always`: 2차 항상 허용 캐시(§4.11)가 들어오기 전에는 `thread`로 낮춰 적용하고 `requestedRemember: "always"`를 남긴다 [제안].
7. 비대화형: 도구 승인은 정책이 이미 deny로 바꾸므로 요청이 나가지 않는다(§4.5 7단계). question·plan 요청은 `approval.requested`와 `approval.resolved{ decision: "deny", resolvedBy: "noninteractive" }`를 한 커밋에 쓰고 바로 deny를 돌려준다. 감사 기록을 남기기 위해서다. 이 커밋에는 대기 체크포인트와 `ui_prompt` 발화가 없다. 비대화형인지는 요청의 `origin`으로 찾은 활성 호출의 `ToolRunContext.interactive`로 본다. 활성 호출이 없는 요청(턴 밖의 그룹 코드)은 대화형으로 본다.
8. 취소: 턴 취소(eng.transactions.design §6.2)는 그 턴의 미해결 요청을 `resolvedBy: "cancelled"`로 닫는다. 대기 중이던 도구 호출은 의도가 없으므로 실행되지 않고, 루프는 `not_executed` 합성 결과로 닫는다.
   - 살아 있는 호출이 기다리는 요청은 파이프라인(`decide`)과 어댑터(`input_required` 대기)가 신호가 끊길 때 닫는다. 프로세스가 끊긴 뒤 남은 요청은 호출이 없다. core-loop가 열린 turn을 닫을 때(`closeOpenTurn`) `ApprovalService.restore`로 미해결 요청을 읽어 그 turn의 것을 `cancel`로 닫는다.
9. 계획 승인의 모드 변경 [결정: L1A.4]: `allow`의 `answer.mode`가 현재 모드와 다르면 `setMode(origin.threadId, mode, "plan_approval")`을 부른다. `approval.resolved` 커밋 뒤, 대기를 풀기 전에 한다. 그래서 계획 도구가 이어갈 때 모드가 이미 바뀌어 있다. 모드를 바꾸지 못해도(`tools.mode_forbidden`, 저장소 실패) 해결은 그대로이고 경고를 남긴다. 해결 커밋 뒤 모드 쓰기 전에 끊기면, 재시작 뒤 계획 도구가 같은 `requestKey`로 다시 요청할 때 저장된 해결을 읽는 자리에서 같은 규칙으로 이어서 적용한다(이미 같은 모드면 쓰지 않는다).

내구화와 재개:

- [제안] 대기 상태는 `StepCheckpoint.pendingToolCalls[].waiting`으로 내구화하고 재개 때 복원한다(F.records.spec §3.6, architecture.runtime-flow.design §4.5, durable spec 1898-1915).
- 재개 절차 [제안]: L1.persistence.spec의 재개가 마지막 체크포인트에서 `waiting: "approval"`인 호출을 찾으면 `ApprovalService.restore(threadId)`를 부른다. `restore`는 `approval.resolved`가 없는 `approval.requested`를 다시 읽어 메모리 대기 목록에 넣는다. core-loop는 `runTurn({ kind: "tools", awaitInput: true })`에서 그 호출들에 `prepare`를 다시 부른다(§3.3, L1.loop.spec §4.5 `await_input` 행).
- 이 재실행은 같은 파이프라인을 지난다. `tool_call` 핸들러와 정책은 다시 실행된다. 의도 전이므로 다시 실행해도 된다(F.extensions.spec §4.3 재생 계약). 승인 단계에서 같은 `requestKey`(toolCallId)로 `request`를 부르면 커밋이 `replayed`로 끝나고 같은 `approvalId`의 기존 요청을 기다린다. 그 사이 응답이 커밋되었으면 바로 그 결과를 쓴다. 그래서 강제 종료 뒤 재개하면 같은 승인 요청이 복원된다(§9).
- 질문 도구는 실행(8단계) 안에서 대기하므로 대기 전에 의도와 실행 표시가 이미 커밋되어 있다. 그래서 질문 도구는 `replay: "safe"`를 선언해야 한다 [제안]. 재개 때 `decideEffectRecovery`가 `rerun`을 내고, 다시 실행된 도구가 같은 `requestKey`로 같은 요청을 이어 기다린다. L2.dialog.spec·L2.work.spec에 이 선언을 요청한다(§8.4).
- 서비스 모드 유휴 종료에서 승인 대기 세션을 live로 셀지는 architecture.runtime-flow.design §7 [미결]을 따른다. 이 문서는 정하지 않는다(§10).

### 4.8 결과 경계화

[결정] 긴 출력을 자르고 원문은 blob으로 뺀다. pi durable truncate 포크를 쓴다(`_research/layer-plan-v2.json` L1-d "결과 경계화", adr.0003). 포크 위치는 `platform-exec`이고 core-tools는 `xeon.exec`로 부른다(§3.7).

1. 한도: 줄 `l1.tools.output.maxLines`(기본 2,000), 바이트 `l1.tools.output.maxBytes`(기본 51,200). 먼저 걸리는 쪽이 적용된다. pi와 같은 값이다(`_research/item-catalog.md` L1-d "도구 결과 경계화", durable `truncate.ts:11-12`). 도구별 `outputLimits`가 있으면 그 값을 쓴다.
2. 대상: `tool_result` chain(§4.2 9단계)을 거친 최종 결과의 텍스트 파트다. 텍스트 파트를 `"\n"`으로 이어 한 문자열로 재고, 한도 안이면 그대로 둔다. 이미지 파트는 자르지 않는다. 큰 이미지 데이터는 F.records.spec §3.4의 문자열 분리 규칙으로 blob이 된다.
3. 한도를 넘으면:
   - 원문 전체(이어 붙인 텍스트)를 UTF-8로 `xeon.store.putBlob(bytes, "text/plain; charset=utf-8")`에 넣는다. 커밋 전, 트랜잭션 밖에서 한다(eng.transactions.design §4.2 `StoreService.putBlob`).
   - 모델용 내용은 `truncateHead(full, limits).content` 한 파트와 안내 문장 한 파트다. 안내 문장: `"[xeon:output_truncated] Showing the first <outputLines> of <totalLines> lines (<formatSize(outputBytes)> of <formatSize(totalBytes)>). The full output is stored as blob sha256:<hex>."`
   - `effect.result.blobRef`에 그 `BlobRef`를 넣는다. 이벤트에는 해시만 남는다(architecture.runtime-flow.design §5 "큰 도구 출력은 블롭 파일로 저장하고 이벤트에는 해시만").
   - `details`에 `{ truncation: { totalLines, totalBytes, outputLines, outputBytes, truncatedBy } }`를 더한다.
4. 원문 상한 [제안]: blob 원문이 50 MiB를 넘으면 앞뒤 25 MiB씩만 저장하고 가운데 생략 표시를 둔다(`docs/design/13-tools-and-execution.md` §3.3.2 "전체 출력" 행 참고). 상한 값은 설정하지 않는다.
5. `outputLimits: "self"` 도구: 스스로 경계화한 도구(예: L2.workspace의 bash가 durable `harness/output.ts` 방식으로 꼬리를 남기는 경우)는 이 단계를 건너뛴다. 그 도구가 낸 `blobRef`는 `details.blobRef`로 받아 `effect.result.blobRef`에 옮긴다.
6. 모델이 원문을 다시 읽는 도구 [제안]: M2에 내장 도구 `read_tool_output`(인자 `sha256`, `offset`, `limit`, risk `read`)을 둔다. M1은 안내 문장만 둔다.
7. 꼬리 보존 미리보기(bash처럼 끝부분이 중요한 출력)는 durable 포크에 `truncateTail`이 없어 1차에 두지 않는다. 필요한 도구는 `"self"`로 스스로 처리한다. 공통 꼬리 모드를 둘지는 [미결](§10)이다.

truncate 위치: 출력 절단 함수는 adr.0003의 포크 대상이고 L0 `platform-exec`에 둔다. core-tools와 L2.workspace의 read·bash 포크는 같은 함수를 F 서비스 `xeon.exec`로 부른다. L1과 L2가 구현 패키지를 import하지 않으므로 사본이나 F 순수 함수가 필요 없다 [결정: review.decisions-2 D-08]. adr.0003 §3 표의 `D/src/truncate.ts` 행 위치를 `xeon/packages/platform-exec`로 고치는 일은 §8.4에 적는다.

### 4.9 재생

- 재개 때 결과 없는 효과의 판정은 F.records.spec §3.5 `decideEffectRecovery`가 한다. 호출은 L1.persistence.spec 몫이다.
- 결정이 `rerun`이면 L1.persistence가 `ToolService.rerun(intent, run)`을 부른다. `rerun`은 `tool_call` 지점, 정책, 승인을 다시 거치지 않고 저장된 `intent.args`로 단계 7a~11을 실행한다(durable spec 3136-3170 "Recovery does not rerun beforeTool", architecture.runtime-flow.design §4.2 "재생 시 도구 지점" 행). `effect.result`의 requestId는 처음과 같은 `tool:<toolCallId>:result`다.
- 재실행 횟수 상한(eng.transactions.design §5.2 `MAX_REPLAY_ATTEMPTS = 2`)과 시도 기록 이벤트는 F.records.spec에 kind가 없다. 시도 표시를 `effect.exec`의 반복으로 셀지 L1.persistence.spec과 함께 정한다 [미결](§10).
- 결정이 `synthesize`이면 합성 결과(`OUTCOME_UNKNOWN_TEXT` 또는 `NOT_STARTED_TEXT`)를 L1.persistence가 커밋한다. core-tools는 관여하지 않는다.

### 4.10 인자 재작성 (2차)

- pi-agent-core 1.3.0 원본의 `BeforeToolCallResult`에는 `args` 필드가 없었다(agent `types.ts:66-74`, `_research/notes/L1-1.md` §3(e)). 자체 루프(adr.0009)에서는 포크 조건이 없다. `prepare`가 검증한 인자를 `PreparedCall.args`로 돌려주므로 교체 인자를 같은 자리에 넣으면 된다.
- 그래서 인자 재작성은 2차로 둔다. 도입할 때는 `prepare` 안에서 재검증하고 `PreparedCall.args`와 `effect.intent.args`에 같은 값을 넣는다(`_research/packages.md` §4.3 L1-d "인자 재작성").
- `tool_call` 지점에서는 인자를 바꿀 수 없다. 이 지점의 결정은 허용·거부·결과 대체뿐이다. 인자를 바꾸면 의도 커밋과 실행 인자가 달라져 재생 판정이 복잡해지기 때문이다. 확장의 인자 변경이 필요하면 2차에 별도 chain 지점을 더한다 [결정: review.decisions-2 U-06].
- 도입 뒤 규칙 [제안]: 재작성된 인자는 스키마 검증을 다시 거치고, 승인 요청에는 재작성된 인자를 싣는다. `effect.intent.args`는 재작성 뒤 값이다. 승인자가 본 인자와 실행되는 인자가 같아야 하기 때문이다(`_research/item-catalog.md` L1-d "인자 재작성과 재검증").

### 4.11 2차 항목

- 항상 허용 캐시: `remember: "always"`를 저장하는 테이블 `core_tools_approvals`(eng.context-map.design §5.2 `core_tools_` 접두). 키는 (범위: 프로젝트 경로 또는 사용자, 도구, 규칙 또는 인자 지문), 값은 허용 시각과 출처 `approvalId`. omp `approval-cache.db`(`_research/refs/oh-my-pi.md` 173행)를 참고한다. 목록 조회·철회 명령과 설정 화면을 함께 둔다(`_research/settings.md` §2.6 "승인 캐시"). 캐시 결과는 `user` 티어 allow 규칙으로 평가기에 들어간다.
- 셸 명령 접두 규칙: `PolicyAction`에 `"shell.command"`를 더하고 resource에 명령 접두 목록과 리다이렉션 조건을 둔다. 허용된 명령이라도 리다이렉션은 기본 ask다(`_research/item-catalog.md` L1-d "셸 명령 규칙"). 명령 파싱은 tree-sitter-bash를 쓸 수 있다 [가정: npm 패키지 동작 미검증, `_research/packages.md` §4.3].

### 4.12 실행 환경·샌드박스·비밀의 책임 경계

[제안] core-tools는 도구를 직접 실행하지 않는다. 명령 실행과 샌드박스 래핑은 도구 구현(L2.workspace의 `bash` 등)이 L0 서비스로 하고, core-tools는 그 앞뒤의 정책·승인·기록·마스킹을 맡는다.

| 일 | L1.tools (core-tools) | L2.workspace (cap-workspace) | L0 |
|---|---|---|---|
| 명령 실행, 샌드박스 래핑 | 하지 않는다. `xeon.exec`의 `Shell`과 `xeon.sandbox`를 부르지 않는다 | `bash` 도구가 샌드박스 데코레이터를 거친 `Shell`로 실행한다(L2.workspace.spec §3.3) | `xeon.exec`, `xeon.sandbox`(L0.exec.spec, L0.sandbox.spec) |
| 경로 정규화 | 잠금 키 산출에만 `xeon.exec.canonicalPath`를 쓴다(§4.2 7b) | 파일 도구의 탈출 검사(L2.workspace.spec "역할 나눔" 표) | `xeon.exec` |
| 비밀 값 주입(`ShellExecOptions.secretEnv`) | 하지 않는다. 값을 보지 않는다 | 실행 옵션으로 참조(`secret://…`)를 넘긴다 | `xeon.exec`가 spawn 직전에 `xeon.secrets` lease로 값을 넣는다(L0.exec.spec §3.6) |
| 승인과 명령 패턴 | 정책 규칙의 `args` 패턴과 승인 프로토콜(§4.5, §4.7). `xeon.secrets.check`가 `needs_approval`이면 `xeon.approvals`로 묻고 받은 증거를 넘긴다(L0.secrets.spec §4.2) | 없음 | 정책 판정은 `xeon.secrets`(L0.secrets.spec §4.2) |
| 도구 결과 마스킹(2계층 `tool-result`) | 8단계 결과와 진행 갱신을 `tool_execution_update`·`tool_result` 발화, 경계화·blob 쓰기, 10단계 커밋 전에 `Redactor.maskDeep`으로 가린다. 텍스트, `structuredContent`, `details`, 오류 문장 모두다. 가린 것이 있으면 `secret.masked`(`layer: "tool-result"`)를 남긴다 | 없음 | `Redactor` 구현(L0.secrets.spec §3.5, §4.4) |
| 도구 인자의 남의 비밀 구문 검사 | 4단계 검증 뒤 `findForeignSecretSyntax`를 부른다 [가정: L0.secrets.spec 103행] | 없음 | 검사 함수 |

- M1 종료 조건의 비밀 항목(`product.scope.spec` §4.4 M1 행: SOPS 비밀 참조 1종을 쓰는 도구 호출에서 값이 이벤트 DB와 모델 요청 본문에 없다)은 위 표대로 나뉜다. L1.tools 몫은 승인·명령 패턴과 2계층 마스킹이다. 주입과 lease는 L0.exec·L0.secrets 몫이다. 세 몫을 한 번에 확인하는 것은 `apps/cli` M1 스모크 시나리오다(L1.tools.plan §6).
- 비밀 사용 승인 [결정: L1A.4]: 5b 정책과 5c 승인 뒤, 의도 커밋 전에 한다. 도구 인자에 `secretEnv`(env 이름 → `secret://<name>`)가 있는 호출만 대상이다.
  1. `secretEnv`의 값이 `secret://<name>` 형식이 아니면(`$VAR`, `{{secret:x}}` 같은 남의 구문 포함) `[xeon:invalid_secret_ref]` 거부다. 이 검사는 비밀 인자로 선언된 필드에만 한다(L0.secrets.spec §3.1). `command` 문자열이 없으면 묶을 명령이 없어 거부다.
  2. 비밀마다 `xeon.secrets.check`를 모드 `env`, 목적 `bash:<명령 이름>`, 대상 `{ kind: "command", argv0, commandLine }`, 행위자 `agent`, 증거 없이 부른다. 목적 문자열은 cap-workspace의 shell `run`이 lease에 넘기는 값과 같은 규칙이다. `check`가 오류이거나 `deny`면 `[xeon:secret_denied]` 거부다. secrets 서비스가 없으면 `[xeon:secret_unavailable]` 거부다.
  3. 하나라도 `needs_approval`이면 승인 증거(`ApprovalEvidence { approvalId, scope: "per-use", grantedAt, expiresAt: null }`)를 만든다. 이 호출의 정책 승인을 사용자가 방금 허용했으면(`resolvedBy: "user"`) 그 승인이 실행마다의 승인(U-19)이라 같은 `approvalId`를 증거로 쓴다. 규칙이나 모드가 허용했거나 `thread` 기억으로 건너뛴 호출은 사용자가 이 호출을 본 적이 없으므로 비밀 사용을 따로 묻는다: kind `tool`, 규칙 id `secret.use`, 제목에 비밀 참조, `remember: ["once"]`, `requestKey`는 `<toolCallId>:secret`을 `requestKeyFor`로 줄인 값이다. 거부·취소는 §4.7 5번과 같은 거부 문장이다.
  4. 증거는 호출 상태(`RawCall.secretApproval`)에 실린다. 도구 구현에 전달하는 길은 F `CallContext`에 증거 필드가 생겨야 열린다(§8.3 F 요청 13). 그 전에는 `xeon.exec`의 `withEnv`가 `approval_missing`으로 거부한다(fail-closed). `rerun`은 증거를 만들지 않는다.
- [미결] lease를 부르는 쪽이 문서마다 다르다. L0.exec.spec §3.6은 `xeon.exec`가 `secretEnv`마다 lease를 얻는다고 적었고, L0.secrets.spec §8.1 제공 표는 L1.tools가 `lease`를 쓴다고 적었다. 이 문서는 L0.exec 쪽을 따른다.
- M1 비밀 검증 모드는 `env` 주입(bash 도구, 실행마다 승인)이다 [결정: review.decisions-2 U-19]. L1.tools 몫은 실행마다의 승인(§4.7)과 2계층 마스킹이다.
- [미결] M1에서 모델 도구 호출이 `secretEnv`를 받는 경로. L2.workspace.spec §3.3은 `secretEnv`를 모델 도구 파라미터에 두지 않는다. 참조를 bash 실행 옵션으로 넘기는 위치는 L2.workspace.spec과 정한다.

## 5. 실패와 경계 사례

1. 모델이 광고하지 않은 도구를 부름(전역 deny로 뺀 도구 포함): `prepare` 2단계는 광고 목록을 다시 보지 않고 등록 표에서 이름을 찾는다. 등록되지 않은 이름이면 `[xeon:tool_unavailable]` 오류 결과(`settled`)다. 등록된 도구면 5a·5b를 지나므로 전역 deny 규칙이 그 호출을 거부한다.
2. 인자 검증 실패: 예외를 던지지 않고 `isError: true` 도구 결과로 모델에 돌아간다. 효과 이벤트는 없다. 루프는 계속된다(§4.2 4단계, core-tools `validate.ts`).
3. `tool_call` 핸들러 예외 또는 결정 스키마 위반: `FIRST_DENY.tool_call`(`{ block: true, reason: "extension handler failed" }`)로 거부한다(F.extensions.spec §3.5, §5 사례 2). ext-host 디스패치 호출 자체가 실패해도 같은 거부로 본다(fail-closed).
4. 정책 규칙의 정규식이 잘못됨: 적재 때 그 규칙만 빼고 진단을 남긴다. 평가는 나머지 규칙으로 한다. managed 규칙이 빠지면 설정 화면에 오류 배지를 보인다(L4.settings-ui.spec).
5. 승인 대기 중 턴 취소: §4.7 8번. 승인 대기 중 프로세스 강제 종료: §4.7 재개.
6. 승인 대기 중 클라이언트 재접속: 클라이언트는 `events.subscribe`로 미해결 `approval.requested`를 다시 받는다. 호스트는 `ApprovalService.pending`으로 현재 목록을 줄 수도 있다.
7. `effect.result` 커밋 실패(`busy`, `disk_full`): 같은 requestId로 재시도한다(eng.transactions.design TX-05). 끝내 실패하면 결과를 메모리에만 두고 run을 실패로 끝낸다. 재개 때 의도와 실행 표시만 남은 효과가 되어 `decideEffectRecovery`가 처리한다.
8. `effect.intent` 커밋 실패: 실행하지 않는다. 호출은 `tools.commit_failed` 거부 결과다.
9. 승인 요청 이후 도구 등록이 사라짐(확장 비활성화): 응답이 allow여도 실행 단계 진입 전에 도구 해석을 다시 확인하고 `tool_unavailable` 오류 결과로 닫는다. 요청은 `resolvedBy: "superseded"`로 닫는다.
10. blob 쓰기 실패: 경계화 미리보기만 모델에 보내고 `blobRef: null`, `details.truncation.blobError`를 남긴다. 원문은 잃는다. 이 경우를 경고 이벤트로 남길지는 L0.store.spec의 blob 실패 정책을 따른다.
11. `bypass` 모드인데 managed가 금지함: `setMode`는 `tools.mode_forbidden`을 돌려준다. 이미 세션 값이 `bypass`인 채 managed 금지가 생기면 평가기가 `default`로 본다(§4.5 4단계).
12. 같은 이름의 도구를 두 출처가 등록함: `register`가 `err({ kind: "name_conflict", toolName })`을 돌려주고 도구 표는 바뀌지 않는다. 확장 조합이 낼 수 있는 정상 운영 중의 실패라 던지지 않는다(eng.typescript.guide TY-24). 해소 규칙은 F.capabilities.spec §10 [미결](도구 이름 네임스페이스)을 따른다.

## 6. 설정 노출

모든 키는 `defineSettings("l1.tools", …)`로 선언한다(F.wire-settings.spec §3.8.3). SettingDef 규칙 D1~D9를 지킨다.

| 키 | 타입 | 기본값 | runtimeChange | allowedScopes | 탭 | widget |
|---|---|---|---|---|---|---|
| `l1.tools.permissionMode` | `"default" \| "acceptEdits" \| "plan" \| "bypass"` | `"default"` | live | managed, user, project, local, session | permissions | select |
| `l1.tools.bypassAllowed` | boolean | `true` | live | managed | permissions | toggle |
| `l1.tools.rules` | `PolicyRule[]` | `[]` | live | managed, user, project, local, session | permissions | table |
| `l1.tools.output.maxLines` | integer(100~100,000) | 2000 | nextTurn | managed, user, project, local | tools | number |
| `l1.tools.output.maxBytes` | integer(1,024~1,048,576) | 51200 | nextTurn | managed, user, project, local | tools | number |
| `l1.tools.exposure.deferThreshold` | integer(0~128) | 64 | nextTurn | managed, user, project, local | tools | number |

- `l1.tools.rules`는 범위별로 모아 티어를 붙인다(§4.5). 화면은 각 규칙의 출처 범위와 파일을 보인다(`_research/settings.md` §2.6 "규칙 편집기, 우선순위 표시, 각 규칙이 나온 파일 표시").
- `l1.tools.exposure.deferThreshold`가 0이면 auto 도구는 모두 지연 도구다. 64는 [제안] 값이다. 근거가 되는 provider 측정값은 없다 [가정].
- 모드는 CLI 플래그(`--permission-mode`)와 세션 명령으로도 바꾼다. 둘 다 `session` 범위 쓰기다(F.wire-settings.spec §4.9 생성 규칙).
- 2차: 항상 허용 캐시의 목록·철회는 permissions 탭의 목록 편집기와 명령으로 둔다. 키는 캐시가 들어올 때 정한다.

## 7. 확장 지점

발화 소유: core-tools는 7개 지점을 발화한다(`L1.readme` §6 소유표). fold, 페이로드, 실패 규칙은 F.extensions.spec §3.4·§3.5를 인용만 한다.

| 지점 | fold | 발화 위치 | 비고 |
|---|---|---|---|
| `tool_call` | first | §4.2 5a | 결정은 `ToolCallDecision`. 예외는 거부(fail-closed) |
| `tool_result` | chain | §4.2 9 | 패치는 `ToolResultPatch`, 병합은 `CHAIN_RULES.tool_result` |
| `tool_execution_start` | tap | §4.2 1 | core-tools가 `prepare`(또는 준비 없이 닫는 `settleRejected`)에서 발화한다 |
| `tool_execution_update` | tap | §4.2 8 | `execute`의 진행 콜백에서 발화한다 |
| `tool_execution_end` | tap | §4.2 11 | 호출 마감(`execute`, 준비 중 닫힘, `settleRejected`) 뒤 발화한다 |
| `ui_prompt_start` | tap(detached) | §4.7 2, `approval.requested` 커밋 뒤 | F.extensions.spec §7 배정과 같다 |
| `ui_prompt_end` | tap(detached) | §4.7 4, `approval.resolved` 커밋 뒤 | 같음 |

- `ToolCallPayload.capability`는 능력 도구일 때 채운다(F.capabilities.spec §7).
- [제안] 페이로드 추가 요청(§8.3 F 요청 4): `ToolCallPayload`에 `caller: CallerId`, `risk: ToolRisk`, `hints?: ToolHints`를 더한다. Helm의 쓰기 판정(L3.helm.spec §4.6 [미결 8] "메타 출처")과 그룹 핸들러의 자식 대화 구분에 쓴다. 추가 전에는 핸들러가 `xeon.tools.meta(name)`을 group-kit 경유로 조회한다.
- 서브에이전트 대화의 도구 호출에도 같은 지점이 같은 규칙으로 발화한다. `HandlerContext.threadId`는 자식 대화다 [제안].
- `post`, `drive`, `scope`와의 관계: core-tools는 post·drive를 쓰지 않는다. 확장 비활성화(scope)로 도구 등록이 빠지면 다음 단계 경계의 `advertise`에서 사라진다(F.capabilities.spec §5 사례 5).
- 확장 규칙 등록(extension 티어)은 2차다. 그 전에는 확장이 `tool_call` 핸들러로 거부한다. L1 코어 규칙 등록(`registerRules`, default 티어)은 M2다.

## 8. 다른 문서와의 인터페이스

### 8.1 제공

| 이름 | 쓰는 문서 |
|---|---|
| `xeon.tools` / `ToolService`, `ToolRegistration`, `ToolMeta`, `ToolRunContext`, `AdvertisedToolset`, `prepare`, `execute`, `settleRejected`, `runUserShell` | L1.loop.spec(광고·도구 배치·중단 정리·사용자 셸, 재개 때 같은 단계 계약으로 실행), L1.context.spec(광고 목록 차이), L1.agents.spec(자식 광고·평가), L1.persistence.spec(`rerun`), 모든 L2 spec(도구 등록), L2.mcp.spec(동적 도구 등록) |
| `registerRules`, `RuleRegistration` | L1.agents.spec(자식 차단 규칙, 출처 `core:agents`) |
| 잠금 키 산출(§4.2 7b) | L1.tasks.spec §4.4(키 큐는 불투명 키만 받는다) |
| `PolicyRule`, `TieredRule`, `PolicyResource`, `PolicyInput`, `PolicyDecision`, `PermissionMode`, `CallerId`, `ToolRisk`, `ToolClass`, `evaluatePolicy`, `stricter`, `PolicyCeiling` | L1.agents.spec(권한 상한, 차단 목록), L4.settings-ui.spec(규칙 편집기) |
| `xeon.approvals` / `ApprovalService`, `ApprovalRequest`, `ApprovalResolution`, `ApprovalBody` | L2.dialog.spec(질문), L2.work.spec(계획 승인), L2.knowledge.spec, L4.host-service.spec(`approval.respond` 처리), L4.cli.spec·L4.desktop.spec(승인 화면) |
| `approval.requested`, `approval.resolved` payload | F.records.spec(카탈로그), F.wire-settings.spec §4.6 |
| `boundToolResult` 동작, 한도 설정 | L2.workspace.spec(`"self"` 도구) |

### 8.2 요구

| 이름 | 출처 |
|---|---|
| `ToolSpec`, `orderTools`, `toolsetFingerprint`, `diffToolsets`, `CapabilityError`, `MAX_TOOLS_PER_REQUEST`, 환원 규칙 §4.2 | F.capabilities.spec |
| `ToolResultRecord`, `ReplayPolicy`, `toReplayPolicy`, `ItemRecord`, `IdFactory` | F.conversation.spec |
| `EffectIntent`, `EffectExec`, `EffectResult`, `decideEffectRecovery`, `StepCheckpoint`, `PendingToolCall`, `BlobRef` | F.records.spec |
| 지점 선언, `FIRST_DENY`, `CHAIN_RULES`, 재생 계약 | F.extensions.spec |
| `approval.respond`, `SettingDef`, `defineSettings`, 범위 층 | F.wire-settings.spec |
| 커밋 경로 `SessionWriter.commit`, requestId 규칙, TX-02 | eng.transactions.design, L1.persistence.spec(`xeon.session`) |
| `xeon.store.putBlob` | L0.store.spec |
| `TaskService`: `find("turn", …)`, `openScope`(kind `tool`), `TaskScope.track`, `locks`(`KeyedQueue`, `LockRequest`), `limiter("tools")`, `Slot.suspendWhile` | L1.tasks.spec §3.1~§3.5, §4.4, §4.5 |
| `xeon.exec`의 `canonicalPath`(잠금 키 산출), 출력 절단 메서드(§3.7, review.decisions-2 D-08) | L0.exec.spec §3 |
| `xeon.secrets`: `Redactor.maskDeep`, `check`, `findForeignSecretSyntax` | L0.secrets.spec §8.1 |
| `ToolSpec.locks`(잠금 선언, FR-T6) | L1.tasks.spec §8.1, F.capabilities.spec |
| `childDecision`(ceiling 단계) | L1.agents.spec §4.3(F `policy.ts` 이전 요청) |
| 에이전트 타입 `AgentTool`, `AgentToolCall`, `AgentToolResult`, `AgentToolUpdateCallback`, `ToolExecutionMode`(F 정의). 어느 패키지도 `@earendil-works/pi-agent-core`를 import하지 않는다 | F.conversation.spec §3.1.1, eng.dependency-rules.guide DR-07, adr.0009 |
| 확장 지점 디스패치(fold, 핸들러 스냅샷) | X.primitives.spec |
| 단계 체크포인트 쓰기, `ToolRunContext` 생성, 도구 배치 스케줄과 `prepare`·`execute` 호출(재개·중첩 호출) | L1.loop.spec |

### 8.3 F 요청 사항

1. F.capabilities.spec: `ToolSpec`에 `risk?: ToolRisk`, `classes?: readonly ToolClass[]` 추가. `ToolRisk`, `ToolClass` 타입을 `tool-spec.ts`에 둔다.
2. F.capabilities.spec §4.5: 순서 키 접두 `core.<L1 도메인>`(L1 내장 도구) 추가.
3. F.records.spec §3.2·§3.3: `CoreArea`에 `approval` 추가, 카탈로그에 `approval.requested`, `approval.resolved`(둘 다 durable, payload §3.9) 추가. F.wire-settings.spec §4.6이 낸 요청과 같은 항목이다.
4. F.extensions.spec §3.5: `ToolCallPayload`에 `caller: CallerId`, `risk: ToolRisk`, `hints?: ToolHints` 추가.
5. F.wire-settings.spec §3.8.2: 범위별 값을 모으는 키 표시(예: `SettingDef.merge?: "replace" | "collect"`, 기본 replace) 추가. `l1.tools.rules`가 첫 사용처다.
6. F: 서비스 인터페이스 `ToolService`, `ApprovalService`와 서비스 이름 상수를 `@xeon/contracts/services`에 둔다(review.decisions-2 D-04). 이 부분은 반영됨(`F.capabilities.spec` §3.12 `services/tools.ts`, `services/approvals.ts`). 정책·도구·승인 공용 타입(§3.1~§3.6)은 `capabilities/tools.ts`, `policy.ts`, `approvals.ts`로 이전한다(eng.context-map.design §5.3).
7. (없앰) F.conversation.spec §3.1 `pi.ts`의 agent-core 재노출에 `AgentLoopConfig`, `AgentToolCall`을 더하는 요청. adr.0009로 F가 `AgentToolCall` 등을 `agent.ts`에서 직접 정의하고(F.conversation.spec §3.1.1) `AgentLoopConfig`는 두지 않는다.
8. F.capabilities.spec §3.3: `ToolSpec.locks`(잠금 선언) 추가. L1.tasks.spec FR-T6과 같은 항목이고 core-tools가 키를 산출한다(§4.2 7b).
9. F.capabilities.spec `policy.ts`: `childDecision`을 순수 함수로 둔다. L1.agents.spec §8.3 5와 같은 항목이고 §4.5 ceiling 단계가 쓴다.
10. (반영됨) F.extensions.spec §3.2.1 `ports.ts`: X.primitives.spec §3.9의 `ToolsPort`, `ToolResourceDef`를 둔다(X.primitives.spec §10 요청과 같은 항목). §3.3 `ToolService extends ToolsPort`가 이 이름을 import한다.
11. F `services/approvals.ts`: `ApprovalService`에 비차단 `open`, `wait`, `get`을 더한다(§3.6 비차단 요청). cap-*의 `L2ApprovalsPort` 어댑터가 `request` 하나만으로는 `request`(즉시 상태)와 `wait`(메모리 대기)를 나눌 수 없다. core-tools는 `ApprovalsInternal`에 이미 구현했다.
12. F `CallOptions`(F.capabilities.spec §3.2): 연속 정보 필드(`continuation`)와, MCP `McpQuestion`을 `QuestionBody`(또는 확장 body)로 옮기는 규칙. D5(a)의 L1.tools 쪽 재호출에 필요하다(§4.3 `approvalId`가 없는 변형).
13. F `CallContext`(F.capabilities.spec §3.2): 비밀 사용 승인 증거 `approval?: ApprovalEvidence`. core-tools가 채우고 cap-workspace의 shell `run`이 `SecretEnvRequest.ctx.approval`에 옮긴다(§4.12).

### 8.4 다른 문서 수정 요청

- (반영됨) adr.0003 §3 표·§6, L0.exec.spec §1·§3, L2.workspace.spec: `D/src/truncate.ts` 포크 위치를 `xeon/packages/platform-exec`로 고치고 `xeon.exec`에 절단 메서드(`truncateHead`, `formatSize`)를 둔다 [결정: review.decisions-2 D-08].
- eng.context-map.design §5.1: `tool.` 접두 행을 `effect.`로 바꾸고 `approval.` 행 type 이름을 F 형식으로 맞춘다. §4.1 `tool-runtime` 행의 쓰는 서비스에 `xeon.store`(blob)를 더한다.
- L2.dialog.spec, L2.work.spec: 질문 도구와 계획 도구는 `replay: "safe"`, `risk: "read"`, `classes: ["user_interaction"]`를 선언하고 `xeon.approvals.request`를 실행 안에서 부른다(§4.7).

## 9. 수용 기준

1. 전역 deny 규칙(`{ tool: "bash", effect: "deny" }`, 인자·모드 조건 없음)이 있으면 `advertise` 결과의 `tools`에 `bash`가 없고 `removed`에 규칙 id와 함께 있다.
2. 같은 등록·규칙을 어떤 순서로 넣어도 `advertise`의 `tools` 순서와 `fingerprint`가 같다.
3. `tool_call` 핸들러가 예외를 던지면 그 호출은 거부 결과(`isError: true`)이고 `effect.intent`가 없다.
4. 스키마를 위반한 인자는 예외 없이 `isError: true` 도구 결과로 모델에 돌아가고 루프는 다음 단계로 간다.
5. 장애 주입으로 `effect.intent` 커밋을 실패시키면 provider `execute`는 한 번도 불리지 않는다. 의도 표에 없는 `toolCallId`로 어댑터 `execute`를 직접 부르면 provider를 부르지 않는다.
6. 정상 실행 한 건은 `effect.intent`, `effect.exec`, `effect.result` 순서로 기록되고, `effect.result`와 toolResult `item.recorded`는 같은 커밋(같은 requestId, 연속 seq)에 있다.
7. managed 티어 deny와 user 티어 allow가 같은 호출에 일치하면 deny다. user 티어 allow와 default 티어 ask가 일치하면 allow다.
8. `interactive: false`이고 결과가 ask인 입력은 deny(`reason: "noninteractive"`)다.
9. 모드 `plan`에서 risk `write`·`exec` 도구 호출은 deny이고 `read` 도구는 allow다. 광고 목록은 모드 `default`일 때와 같다.
10. 승인 대기 중 프로세스를 강제 종료한 뒤 재개하면 `ApprovalService.pending(threadId)`가 같은 `approvalId`의 요청 하나를 돌려주고, 새 `approval.requested` 이벤트가 생기지 않는다.
11. 출력 60,000바이트 텍스트를 내는 도구 호출은 `effect.result.blobRef`가 원문 sha256을 가리키고, 모델용 toolResult 내용은 51,200바이트 이하 미리보기와 안내 문장이다.
12. 질문 도구 요청과 계획 승인 요청은 둘 다 `approval.requested` 이벤트이고 payload가 `ApprovalRequestSchema`를 통과하며 `body.kind`만 다르다.
13. `evaluatePolicy`는 같은 입력에 같은 결과를 내고 입력 객체를 바꾸지 않는다(동결 객체로 확인).
14. 광고 목록은 128개를 넘지 않는다. always 도구 129개를 등록하면 `advertise`가 `tools.too_many`를 돌려준다.
15. 같은 파일을 쓰는 두 호출(잠금 선언 `write`, 경로 표기는 상대 경로와 심볼릭 링크로 다름)이 한 병렬 배치에 있으면 실행 구간이 겹치지 않는다. 다른 파일이면 겹친다.
16. 잠금 대기 중 turn을 취소하면 그 호출에 `effect.exec`가 없고 결과는 중단 결과다.
17. `l1.tasks.limits.tools = 1`이면 두 번째 도구 실행은 첫 실행이 슬롯을 반납한 뒤 시작하고, 키 잠금을 슬롯보다 먼저 얻는다(M2).
18. `ceiling`이 있는 자식 호출에서 부모 관점 결정이 deny면 자식 관점 결정이 allow여도 deny다.
19. `registerRules("core:agents", …)`를 두 번 부르면 두 번째 규칙 집합만 평가에 쓰이고, 잘못된 규칙은 `issues`로 돌아오며 적재되지 않는다.
20. 도구 결과에 알려진 비밀 값이 있으면 `effect.result`, toolResult `item.recorded`, blob 원문, `tool_result`·`tool_execution_update` 페이로드에 값 문자열이 없다.
21. core-tools와 F capabilities 소스의 import 목록에 `@earendil-works/pi-agent-core`가 없다(check-layers, DR-07).
22. 계획 승인 `allow { mode }`는 계획 도구가 이어가기 전에 세션 모드를 바꾼다. 해결이 커밋된 뒤 모드 쓰기 전에 끊겨도, 재시작 뒤 같은 `requestKey` 요청이 모드를 이어서 적용하고 모드 변경을 두 번 쓰지 않는다. 모드 밖의 `mode`, 질문용 decision은 `applied: false`다.
23. 질문 응답은 질문 묶음에 맞지 않으면(모르는 id, 없는 선택지, 단일 선택에 둘, 자유 입력 불허에 text, 빈 답) `applied: false`이고 이벤트가 없다.
24. 비대화형 실행의 질문·계획 요청은 `approval.requested`와 `approval.resolved{ deny, noninteractive }`가 한 커밋이고 대기 체크포인트가 없다.
25. `input_required { approvalId }`를 낸 도구 호출은 승인 해결까지 `effect.result` 없이 기다리고, 해결 뒤 같은 `requestId`로 다시 불려 완료 결과를 한 번 기록한다. 대기 중 turn 취소는 그 승인을 `cancelled`로 닫는다.
26. `secretEnv`를 쓰는 호출에서 `check`가 `needs_approval`이면, 정책 승인을 사용자가 방금 허용한 호출은 그 승인이 증거이고 그렇지 않은 호출은 규칙 id `secret.use` 요청을 따로 올린다. `check`가 거부하거나 참조 형식이 틀리면 승인 요청 없이 거부한다.

## 10. 미결 사항

- [미결] 서비스 모드 유휴 종료에서 승인 대기 세션을 live로 셀지(architecture.runtime-flow.design §7). 이 문서와 L1.tools.plan은 M2까지 live로 취급한다.
- [결정: review.decisions-2 U-06] `tool_call` 지점에서 인자 변경은 지원하지 않는다(fold `first`, 허용·거부·결과 대체만). 인자 변경이 필요하면 2차에 별도 chain 지점을 더한다(§4.10).
- [미결] 꼬리 보존 미리보기의 공통 모드(§4.8 7번).
- [미결] 재실행 시도 횟수 기록 방식과 상한(§4.9). eng.transactions.design `MAX_REPLAY_ATTEMPTS`와 F.records.spec 결정표의 연결.
- [결정: L1A.4] `input_required` 출력 변형의 판별 필드는 `status: "input_required"`이다(§4.3). `approvalId`가 없는 MCP 변형의 재호출은 F 요청 12가 닫히기 전까지 [미결]이다.
- [미결] `QuestionAnswer`(§3.6)와 L2.dialog의 `AskAnswer`(`{ answers: [{ questionId, selected, text }] }`)의 모양이 다르다. `approval.respond`의 `answer`는 클라이언트가 보내는 값이고 core-tools는 `QuestionAnswer`만 받는다. cap-dialog 어댑터가 `QuestionAnswer`와 `AskAnswer`를 서로 옮기거나 L2.dialog.spec §4.1.5를 `QuestionAnswer`로 맞춘다.
- [미결] 정책 규칙 수집 방식(범위별 수집 대 키 분리, §4.5). F 요청 5가 받아들여지지 않으면 `l1.tools.rules.managed`, `l1.tools.rules.user` 같은 범위별 키로 나눈다.
- [미결] Anthropic 서버 쪽 tool search 사용 여부(§4.1 8번).
- [미결] 확장(extension 티어) 규칙 등록 경로와 매니페스트 필드(2차).
- [미결] `remember: "always"`를 2차 전까지 `thread`로 낮추는 처리(§4.7 6번)가 사용자 기대와 맞는지.
- [미결] 도구가 다른 도구를 부르는 중첩 호출의 진입점(§4.2). `prepare`·`execute`를 부르는 쪽은 core-loop이므로 `LoopService`에 진입점을 둘지, 중첩 호출을 2차로 미룰지 L1.loop.spec과 정한다.
- [미결] 비밀 lease를 부르는 쪽(L0.exec 대 L1.tools)과 `secretEnv`가 모델 도구 인자로 들어오는 경로(§4.12). 증거를 도구 구현까지 옮기는 길은 F 요청 13이다. M1 검증 모드 자체는 `env`로 정했다(U-19).

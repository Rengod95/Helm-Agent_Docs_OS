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

모델이 부른 도구를 광고하고, 검증하고, 허용 여부를 정하고, 실행하고, 결과를 기록하는 L1 코어를 정한다. 승인과 질문을 하나로 묶은 승인 프로토콜도 이 문서가 정한다.

근거:

- 층 구성 계획 v2 L1-d 구성요소 8개(`_research/layer-plan-v2.json` L1-d): 도구 노출 분리, 실행 파이프라인, 검증 오류 반환, 선언형 정책 엔진, 권한 모드, 승인과 질문 프로토콜, 결과 경계화, 항상 허용 캐시와 셸 규칙(2차).
- 패키지 판정(`_research/packages.md` §4.3 L1-d 행): 노출 분리·파이프라인·검증 오류 반환은 agent-core 1.3.0 그대로, 정책 엔진·모드·승인 프로토콜은 설계, 결과 경계화는 포크. adr.0009 이후 파이프라인은 core-tools `prepare`·`execute`가, 인자 검증은 core-tools `validate.ts`가 옮겨 맡는다.
- [이동: review.m5 6.1·D-28, 2026-11-18] 질문 서비스(`dialog.ask`의 구현: 요청 키, 대기, 응답 옮기기, 시간 제한의 임시 타이머, 승인 포트 팩토리 `questionApprovalsOver`)는 이 패키지의 `src/ask/`에 둔다(옛 `cap-dialog/src/ask/`). 기능 등록과 `ask_user` 도구 등록은 cap-dialog와 apps/host에 남는다. 질문 도구의 모델 노출과 문장은 L2.dialog.spec이 정한다.
- [결정] 질문 도구와 계획 승인은 L1-d 승인 프로토콜 하나로 합친다(`_research/foundation-plan.md` §1 결정 5, `_research/decisions-log.md` 2026-10-21 3차). 계획 승인은 2026-11-13에 폐지했고 프로토콜은 질문과 도구·검토 승인만 쓴다 [결정: 2026-11-13 사용자].
- [결정] pi durable에서 truncate를 Chord 제거 포크로 가져온다(adr.0003, `_research/foundation-plan.md` §1 결정 1).

정하는 것:

- Cordis 서비스 `fresnel.tools`(`ToolService`)와 `fresnel.approvals`(`ApprovalService`). 두 서비스 모두 `core-tools`가 제공한다(eng.context-map.design §5.3).
- 도구 등록 형식(`ToolRegistration`), 광고 목록 산출(`advertise`), `ToolSpec`·`DirectToolRegistration` → 도구 항목(core-tools `ToolEntry`) 어댑터, 실행 파이프라인.
- 선언형 정책 엔진의 규칙 어휘(`PolicyRule`, 티어, 호출 주체 조건)와 순수 평가기 `evaluatePolicy`. L1.agents.spec이 같은 어휘를 그대로 쓴다.
- 권한 모드 4종과 비대화형 실행 규칙.
- 승인 프로토콜: 단일 대기 형식 `ApprovalRequest`, wire 응답 `approval.respond`와의 대응, 대기 상태 내구화와 재개 복원.
- 결과 경계화: 줄·바이트 한도, 원문의 blob 분리, 모델용 미리보기.
- 이 도메인이 발화하는 훅 7개와 설정 키 `l1.tools.*`.
- 태스크 엔진과의 연결: tool 범위 노드, 잠금 키 산출, 키 큐와 `tools` 풀 획득 순서(§4.2).
- 실행 환경·샌드박스·시크릿과의 책임 경계(§4.12).

다루지 않는 것:

- 기능 정의 형식, 도구 이름 규칙, 결정적 순서 함수: F.capabilities.spec.
- 효과 3단 이벤트의 payload와 재개 판정 함수(`decideEffectRecovery`): F.records.spec §3.5. 재개 절차 자체: L1.persistence.spec.
- 루프 단계, 체크포인트를 쓰는 시점, 병렬·순차 실행 모드 선택: L1.loop.spec, L1.tasks.spec.
- 개별 도구 구현(read, bash, 편집 등): L2.workspace.spec. 질문 도구의 모델 노출: L2.dialog.spec, L2.work.spec(계획 도구는 2026-11-13 폐지 [결정: 2026-11-13 사용자]).
- 샌드박스와 실행 환경: L0.sandbox.spec, L0.exec.spec. L1.tools와의 경계는 §4.12다.
- 서브에이전트의 권한 상한 계산: L1.agents.spec(이 문서의 평가기를 호출한다).
- 대화 중간 도구 추가·제거를 대화 기록에 넣는 일: L1.context.spec(F.capabilities.spec §4.5).

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 광고 목록 (advertised toolset) | 한 모델 요청에 실리는 도구 목록. `orderTools` 순서로 정렬하고 고정한다 |
| 지연 도구 (deferred tool) | 등록은 되었지만 광고 목록에 처음부터 싣지 않는 도구. 모델이 `tool_search`로 찾은 뒤 활성화되면 다음 단계부터 광고된다 |
| 전역 deny | 인자·모드 조건 없이 도구 이름(또는 기능·MCP 서버)만으로 거부가 정해지는 규칙 결과. 광고 목록에서 뺀다 |
| 호출 주체 (caller) | 도구를 부른 대화의 주체. 주 대화는 `main`, 서브에이전트는 `subagent:<정의 이름>` |
| 티어 (tier) | 규칙의 출처 등급. 낮은 쪽부터 `default` < `extension` < `user` < `managed` |
| 위험 등급 (risk) | 도구가 선언한 효과 범위. `read` < `write` < `exec`. 미선언은 `exec` |
| 도구 부류 (tool class) | 정책이 도구 이름 대신 쓰는 의미 표지. `spawn`, `user_interaction`, `shared_state_write`, `external_send` |
| 권한 모드 | 규칙이 정하지 않은 호출에 적용할 기본 허용 범위. `default`, `acceptEdits`, `bypass`. 계획 모드(`plan`)는 없다 [결정: 2026-11-13 사용자] [근거: 2026-11-13 사용자 결정] |
| 승인 요청 | 사람의 응답을 기다리는 단일 대기 레코드. 종류는 `tool`(도구 승인), `question`(사용자 질문). 계획 승인(`plan`)은 더는 만들지 않는다 [결정: 2026-11-13 사용자] |
| 결과 경계화 | 모델에 보낼 도구 결과를 한도 안으로 줄이고 원문을 blob으로 옮기는 일 |
| 대화형 실행 | 사람이 승인 요청에 답할 수 있는 실행. 예약 실행과 헤드리스 실행은 비대화형이다 |

이 문서는 F의 다음 이름을 그대로 쓴다: `ToolSpec`, `ToolHints`, `ToolName`, `CapabilityError`, `orderTools`, `toolsetFingerprint`, `diffToolsets`, `MAX_TOOLS_PER_REQUEST`(F.capabilities.spec), `ToolResultRecord`, `ReplayPolicy`, `toReplayPolicy`(F.conversation.spec §3.6), `EffectIntent`, `EffectExec`, `EffectResult`, `BlobRef`, `StepCheckpoint`, `PendingToolCall`, `DurableEventDraft`(F.records.spec), `ToolCallPayload`, `ToolCallDecision`, `ToolResultPayload`, `ToolResultValue`, `ToolResultPatch`, `FIRST_DENY`(F.extensions.spec §3.5).

용어 대응: eng.transactions.design의 `tool.intended`·`tool.settled`는 F의 `effect.intent`·`effect.result`이고, `effect.exec`가 그 사이의 실행 시작 표시다(F.records.spec §3.1.2 정본 표). 이 문서는 F 이름만 쓴다.

## 3. 인터페이스

서비스 인터페이스 `ToolService`와 서비스 이름 상수는 F `@fresnel/contracts/services` 서브패스에 둔다 [결정: review.decisions-2 D-04]. `ApprovalService`도 같은 서브패스에 두도록 요청한다. 도구·정책·승인의 공용 타입은 F `@fresnel/contracts/capabilities`의 `tools.ts`, `policy.ts`, `approvals.ts`에 둔다 [제안](eng.context-map.design §5.3 표의 "F 인터페이스(위치)" 열). L1 패키지끼리 import하지 않으므로 L1.loop, L1.agents, L2가 이 타입을 쓰려면 F에 있어야 한다. F.capabilities.spec에 이전을 요청한다(§8.3). 아래 블록의 파일 경로는 이전 뒤 위치다. 구현은 `core-tools`가 한다.

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
  /** 읽기 전용 샌드박스 상한 아래에서 쓸 위험 등급. 생략은 `risk`다(§4.5 읽기 전용 샌드박스 상한) [결정: 2026-11-13 사용자] */
  readonly riskUnderReadOnlySandbox?: ToolRisk;
  readonly classes?: readonly ToolClass[];
  /** MCP 서버 도구면 서버 이름. 정책 resource.mcpServer와 대조한다 */
  readonly mcpServer?: string;
}

export interface ToolMeta extends Required<Pick<ToolPolicyMeta, "risk" | "classes">> {
  readonly name: ToolName;
  readonly label: string;
  readonly ref: ToolRef;                         // 순서 키(기능 ID 또는 ext.<이름>, mcp.<서버>)
  readonly capability?: { readonly id: CapabilityId; readonly method: string };
  readonly mcpServer?: string;
  readonly hints: NonNullable<ToolSpec["hints"]>;
  readonly replay: ReplayPolicy;                 // 미선언은 "unsafe"
  readonly exposure: ExposureMode;
  readonly outputLimits: Required<OutputLimits> | "self";   // "self": 도구가 스스로 경계화함(§4.8)
}

/** 기능 도구: 정의 + 서비스 키. 실행 함수는 어댑터가 만든다(§4.3) */
export interface CapabilityToolsRegistration {
  readonly kind: "capability";
  readonly def: AnyCapabilityDef;
  readonly key: ServiceKey<unknown>;
  /** 도구 이름별 정책 메타. 생략한 도구는 hints에서 유도한다(§4.6) */
  readonly policy?: Readonly<Record<string, ToolPolicyMeta>>;
  readonly exposure?: Readonly<Record<string, ExposureMode>>;
  /** 도구 이름별 상태 조건. 참이면 지연 도구도 검색 없이 광고한다(§4.1 규칙 5) */
  readonly activeWhen?: Readonly<Record<string, (threadId: ThreadId) => boolean>>;
  readonly outputLimits?: Readonly<Record<string, OutputLimits | "self">>;
}

/** 기능 밖 도구: 확장 도구, MCP 서버 도구, core-tools·core-agents 내장 도구 */
export interface DirectToolRegistration {
  readonly kind: "direct";
  /** 순서 키 접두. "ext.<확장 이름>" | "mcp.<서버 이름>" | "core.<L1 도메인>" */
  readonly orderKey: string;
  readonly tool: AgentTool<TSchema>;
  readonly hints?: ToolSpec["hints"];
  readonly policy?: ToolPolicyMeta;
  readonly exposure?: ExposureMode;
  readonly activeWhen?: (threadId: ThreadId) => boolean;
  readonly outputLimits?: OutputLimits | "self";
  /** 서버 주도 입력 요청(MCP `input_required`)을 낼 수 있는 도구의 실행. 있으면 `tool.execute` 대신 쓴다 (§4.3 `input_required`) */
  readonly executeWithContinuation?: (call: {
    /** 호출이 속한 대화. `context.threadId`와 같은 값이다 */
    readonly threadId: ThreadId;
    /** 기능 도구가 받는 호출 문맥과 같은 값(`threadId`, `turnId`, `toolCallId`, `caller`, `interactive`, 시크릿 승인 증거) */
    readonly context: CallContext;
    readonly toolCallId: string;
    readonly params: unknown;
    readonly signal: AbortSignal;
    readonly onUpdate: AgentToolUpdateCallback;
    readonly continuation: CallContinuation | undefined;
  }) => Promise<AgentToolResult>;
}

export type ToolRegistration = CapabilityToolsRegistration | DirectToolRegistration;

export type Unregister = () => void;
/** 도구 이름이 이미 등록되어 있다. F.extensions.spec §3.2.1의 ToolRegisterError와 같다 */
export interface ToolRegisterError { readonly kind: "name_conflict"; readonly toolName: string }
```

- `ToolSpec`에는 `execute`가 없다(F.capabilities.spec §3.3). 기능 도구의 실행 함수는 §4.3의 어댑터가 서비스 키로 얻은 provider API에서 합성한다.
- 호출 문맥 [결정: m2c G1-09, A-08]: 기능 도구는 `CallOptions.context`(F `CallContext`)로, 직접 등록 도구는 `executeWithContinuation`의 `threadId`와 `context`로 같은 문맥을 받는다. 어댑터(`entries.ts`의 `callContext`)가 `ToolRunContext`에서 채운다: `caller`는 주 대화면 `{ kind: "model", agent: "main" }`, 서브에이전트면 `{ kind: "model", agent: "subagent", agentName: <정의 이름> }`이다. `afterUntrusted`는 같은 turn이 웹·MCP 도구 결과를 이미 읽었으면 `true`이고 아니면 필드가 없다(§4.3 `afterUntrusted` 규칙). `extension`은 확장·그룹 코드가 호출자일 때의 이름이라 이 경로에서는 비어 있다. 도구 구현과 L2 어댑터는 승인 origin의 `caller`를 `approvalCallerOf(context.caller)`(F `services/approvals.ts`) 하나로 만든다. 자기 복제를 두지 않는다. `execute`(pi `AgentTool.execute`)에는 문맥을 실을 자리가 없으므로 호출 주체와 대화가 필요한 직접 등록 도구는 `executeWithContinuation`으로 등록한다.
- 샌드박스 프로필 [결정: 2026-11-13 사용자]: 어댑터는 `ToolRunContext.ceiling.sandbox`가 `"read-only"`이면 `CallContext.sandbox: "read-only"`를 싣는다. 없으면 필드가 없다. 도구 구현(cap-workspace의 bash)은 이 값이 있으면 읽기 전용 샌드박스(쓰기 루트 없음, 네트워크 차단) 안에서만 실행하고, 샌드박스를 쓸 수 없으면 실행하지 않고 거부한다. 이 거부가 §4.5의 승인 생략을 뒷받침한다.
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
  /** 그룹(scope·drive 소유자)이 띄운 자식 대화면 그 출처(`RunSource`). core-agents가 `ChildTurnRequest.tools.source`로 주고 승인 origin이 이어 받는다. 모델의 `agent` 도구가 띄운 자식에는 싣지 않는다 */
  readonly source?: RunSource;
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

export const ToolServiceName = "fresnel.tools" as const;

export interface ToolService extends ToolsPort {
  /** L1·L2 코드 등록. 같은 순서 키·이름이 이미 있으면 ToolsError(tools.name_conflict)를 던진다 */
  register(registration: ToolRegistration): Result<Unregister, ToolRegisterError>;
  /** X ToolsPort 등록(확장 hostOf(g).registerTool). 아래 규칙으로 DirectToolRegistration을 만들어 위 메서드와 같은 경로로 등록한다 */
  register(owner: ScopeId, def: ToolResourceDef, options?: ToolRegisterOptions): Result<Unregister, ToolRegisterError>;

  /** 메타 조회. 동기, 순수 조회. 확장 핸들러가 쓰기 판정에 쓴다 */
  meta(name: ToolName, threadId?: ThreadId | null): ToolMeta | undefined; // threadId가 있으면 그 대화가 보는 이름으로 찾는다(§3.3.1)

  /** 광고 목록 산출(§4.1). 같은 입력과 같은 등록·규칙 상태면 같은 결과 */
  advertise(input: AdvertiseInput): Promise<Result<AdvertisedToolset, AdvertiseError>>;

  /**
   * 도구 호출 하나의 준비(adr.0009 §3.4). 도구 조회, 인자 검증, `tool.call.before` 지점, 정책·승인, E1(`effect.intent`) 커밋을 차례로 한다(§4.2).
   * 실패는 던지지 않고 `settled`로 돌려준다. 미발견·인자 오류·거부·중단 호출은 결과 item까지 기록된 상태다. 루프는 준비를 항상 원래 순서대로 하나씩 부른다
   */
  prepare(call: AgentToolCall, assistant: AssistantMessage, run: ToolRunContext): Promise<CallPreparation>;

  /** 준비를 마친 호출의 실행과 마감: E2(`effect.exec`), 실행, 마스킹, `tool.result` chain, 경계화, E3(`effect.result` + toolResult item). 병렬로 불러도 된다 */
  execute(call: PreparedCall, onUpdate: AgentToolUpdateCallback, run: ToolRunContext): Promise<ToolCallOutcome>;

  /** 실행하지 않은 호출을 이유와 함께 닫는다(중단 `not_executed`, 출력 한도 절단 `truncated`). 의도가 있으면 `effect.result`, 없으면 효과 없는 toolResult item으로 기록한다 */
  settleRejected(calls: readonly AgentToolCall[], reason: RejectReason, run: ToolRunContext): Promise<readonly ToolCallOutcome[]>;

  /** 재개 때 재실행. decideEffectRecovery가 rerun을 낸 효과만 받는다. tool_call 지점과 정책을 다시 거치지 않는다(§4.9). 결과는 effect.result와 같은 커밋에 기록되어 돌아온다 */
  rerun(intent: EffectIntent, run: ToolRunContext): Promise<Result<ToolCallOutcome, ReadFailure>>;

  /** 코어 규칙 등록(default 티어). source는 "core:<L1 도메인>". 같은 source로 다시 부르면 그 source의 규칙을 통째로 바꾼다(§4.5) */
  registerRules(source: `core:${string}`, rules: readonly PolicyRule[]): RuleRegistration;

  /** 사용자 셸(`!명령`) 경로(M2). L1.loop의 runUserBash가 user_bash 지점 뒤에 부른다. 정책은 caller "main", 대화형으로 평가한다 */
  runUserShell(request: UserShellRequest, run: ToolRunContext): Promise<ToolResultRecord>;

  /** 대화의 권한 모드. 이번 실행(launch) 범위 설정 l1.tools.permissionMode를 바꾸고 settings.changed로 남는다 */
  mode(threadId: ThreadId): PermissionMode;
  setMode(threadId: ThreadId, mode: PermissionMode, source: "user"): Promise<ModeChangeResult>;
}
```

- [결정: review.decisions-2 D-04] `ToolService`는 `ToolsPort`(`F.extensions.spec` §3.2.1 `ports.ts`, X.primitives.spec §3.9)를 확장한다(`F.capabilities.spec` §3.12 규칙 2, `services/tools.ts`). X는 같은 서비스 이름 `fresnel.tools`에 별도 인터페이스를 등록하지 않고, 확장의 `hostOf(g).registerTool(def)`는 `register(owner, def)` 오버로드로 들어온다. 이 오버로드가 `ToolsPort`를 충족한다.
- `register(owner, def)` 변환 규칙 [제안]: `orderKey`는 `ext.<owner의 확장 이름>`, `tool`은 `def.name`·`def.description`·`def.parameters`와 `def.execute`를 감싼 `AgentTool`, 재생 정책은 `def.replay`다. `def.risk`와 `def.hints`가 있으면 `ToolMeta.risk`·`hints`로 쓰고(`risk`가 없으면 `hints.readOnly`로 유도하고 그것도 없으면 `exec`), `policy`·`outputLimits`는 생략하고 §4.6 유도 규칙을 따르고, `exposure`는 `def.exposure`(`always` | `deferred`, 생략은 `always`)다 [제안: M3-REQ-78]. 선언의 신뢰는 core-tools가 가리지 않는다: builtin이 아닌 확장의 `read`·`write`·`hints.readOnly` 선언은 X의 `registerTool`이 `tool_risk_reserved`로 거부해 이 오버로드까지 오지 않는다(X.primitives.spec §4.6.6). 그래서 learning 같은 builtin 그룹의 도구가 `risk: "read"`로 등록되면 무인 위임 자식에서도 승인 없이 돈다. 반환 `Unregister`는 F `Unsubscribe`와 같은 모양(`() => void`)이다. owner scope가 dispose되면 X가 이 함수를 부른다.

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
- `tool.execution.before`·`tool.execution.update`·`tool.execution.after` tap 훅(§7)은 core-tools가 `prepare`(시작), `execute`의 진행 콜백(갱신), 호출 마감(끝)에서 발화한다. 준비 없이 닫는 호출(`settleRejected`)도 시작·끝 tap을 짝으로 낸다. 페이로드는 시크릿을 가린 값이다.
- `ToolMeta.executionMode`는 배치 스케줄에 쓴다. 호출 중 하나라도 `"sequential"`이면 루프는 그 배치를 순차로 돈다(L1.loop.spec §3.3 규칙 1).
- 재개 때 승인 대기 중이던 호출과 의도 없는 호출은 core-loop가 `runTurn({ kind: "tools" })`에서 주 경로와 같은 `prepare`·`execute`로 실행한다(L1.loop.spec §4.5 `tools`·`await_input` 행). 결과 불명 효과의 재실행만 `rerun`이다. 그래서 재실행도 같은 기록 경로를 지난다.
- `registerRules`의 첫 사용처는 core-agents의 자식 차단 규칙(`source: "core:agents"`, L1.agents.spec §4.3)이다. 확장 티어 규칙 등록은 2차다(§4.11).
- `runUserShell` [결정: L1A.5, L1F]: 사용자가 `!명령`으로 직접 친 셸 명령을 `bash` 도구로 같은 파이프라인에 넣는다. 정책은 caller `main`, `depth` 0, `interactive: true`로 평가하고 `ceiling`은 쓰지 않는다. deny 규칙과 `tool.call.before` 훅의 거부는 막는다. ask는 사용자 본인이 낸 명령이라 승인 요청 없이 허용으로 본다. 효과는 3단(`effect.intent`, `effect.exec`, `effect.result`)으로 남기고 `effect.result.resultItemId`는 null이다. toolResult item은 기록하지 않는다. 결과를 컨텍스트에 어떻게 넣을지는 호출한 쪽(L1.loop의 `runUserBash`)이 `includeInContext`로 정한다. `bash` 도구가 없거나 막히면 던지지 않고 `isError` 결과 레코드를 돌려준다. 실행 전에 닫힌 호출(정책 deny, `tool.call.before` 거부, 인자 오류, 도구 미등록)의 레코드는 `details.code`가 `not_executed`(미등록은 `tool_unavailable`)이고, L1.loop의 `runUserBash`가 이 값으로 "명령이 돌지 않았다"를 알아보고 `denied`로 돌려준다.
- `suspendWhile(threadId, toolCallId, wait)` [결정: M2 검토 3]: F `ToolService`의 메서드다(승격 완료, §8.3 F 요청 14). `tools` 풀 슬롯을 쥔 호출이 자식 대화를 기다리는 동안 슬롯을 내려놓고(`Slot.suspendWhile`), 기다림이 끝나면 같은 풀에서 다시 얻는다. 슬롯을 쥔 호출이 아니면 그냥 기다린다. core-agents의 `agent` 도구는 자식을 기다리는 `service.spawn`을 이 안에서 기다린다. 슬롯을 쥔 채 기다리면 `tools` 상한만큼의 `agent` 호출이 자식의 도구 호출 슬롯을 막아 교착한다.

#### 3.3.1 대화별 이름과 가시성 [결정: 2026-11-19, 사용자, AGE-56]

한 대화의 도구 목록은 그 대화가 실은 플러그인(E(T))의 도구뿐이고, 도구는 승인됐을 때와 같은 이름으로 보인다. 도구 표 하나로 이것을 하려고 표의 구조를 이렇게 정한다. 구현은 `core-tools`의 `registry.ts`·`runtime.ts`·`pipeline.ts`다.

1. `register(owner, def, { perThread: true })`로 등록한 항목은 열쇠가 (주인, 요청한 이름)이다. `def.name`은 플러그인이 요청한 이름이고, 주인이 다르면 같은 이름이 여럿이어도 `name_conflict`가 아니다. 같은 (주인, 이름)을 두 번 넣으면 `name_conflict`다. `perThread` 항목의 요청한 이름이 전역 항목(내장, 기능, MCP)의 이름과 같거나, 전역 항목이 이미 `perThread` 항목이 요청한 이름을 요구해도 `name_conflict`다(어느 대화에서 조용히 가려지는 도구를 만들지 않는다). `perThread`가 아닌 항목(내장, 기능 도구, MCP, `ToolRegistration`)은 지금처럼 전역 이름이 유일하다. 조립이 `perThread`를 쓰는 것은 이름 정책이 대화마다 정해야 하는 확장 도구뿐이다(X.operations.spec §3.5).
2. 조립 루트가 `ToolsDeps.exposureOf(threadId)`로 `{ nameOf(주인, 요청한 이름) }`를 준다. 돌려주는 값이 문자열이면 그 대화에서의 노출 이름이고, `null`이면 그 대화에 보이지 않는다. `exposureOf`가 없거나 `undefined`를 돌려주거나 대화가 없으면 `perThread` 항목이 모두 요청한 이름 그대로 보인다(호스트 없는 조립과 옛 시험).
3. 광고(`advertise`), 호출 준비(`prepare`), 재실행(`rerun`), 닫힌 호출의 기록, `tool_search`, 플러그인이 도구를 이름으로 부르는 `executeForPlugin`, `meta(name, threadId)`는 모두 그 대화가 보는 표(`ToolRegistry.view(exposure)`)에서 이름을 찾는다. 보는 표의 항목은 `name`·`label`·`ref.name`이 노출 이름이고 `owner`는 그대로다. 다른 대화에만 실린 플러그인의 도구는 요청한 이름으로도 정식 이름으로도 `tool_unavailable`이다. 전역 항목의 이름과 겹치는 `perThread` 항목은 그 대화에서 가려진다(전역 항목이 이긴다).
4. 정책 평가, 허용 규칙, 승인 기록, Hook 페이로드, 호출 추적, 턴 기록에 남는 도구 이름은 보는 표의 노출 이름, 곧 모델이 본 이름이다. 드래프트의 호출인지는 이름이 아니라 도구를 등록한 주인(`entry.owner`)으로 정한다(§4.6.1). 그래서 같은 이름의 승인본에 준 허용 규칙과 승인 상속은 드래프트의 호출에 물려지지 않고, 드래프트의 호출은 항상 드래프트 카드를 지난다(`auto`인 테스트 런만 그 카드를 건너뛴다).
5. 이미 저장된 이름(턴 기록의 `toolName`, `effect.intent`)은 그대로 읽는다. 옛 기록에 남은 드래프트의 내부 이름(`d<태그>-<이름>__<도구>`)도 문자열이라 그대로 읽히고, 그 이름이 지금의 표에 없으면 재실행은 전과 같이 `tools.rerun_tool_missing`이다(이 일은 이 변경 전에도 같았다).

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
  /** 모델이 대화 중 도구 추가를 받을 수 있는가. 생략은 참. 거짓이면 지연 없이 모두 싣는다(§4.1 규칙 5) */
  readonly deferralAvailable?: boolean;
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

export type PermissionMode = "default" | "acceptEdits" | "bypass";   // 계획 모드 없음 [결정: 2026-11-13 사용자]
/** 엄격한 쪽이 앞이다. 자식 모드 계산(L1.agents.spec)에 쓴다 */
export const PERMISSION_MODE_STRICTNESS: readonly PermissionMode[] = ["default", "acceptEdits", "bypass"];

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
  readonly capability?: string;                  // 기능 ID glob
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
  /** 예: "settings:managed", "settings:project:/repo/.fresnel/settings.json", "ext:helm", "core:agents" */
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

/** `draft`: 초안 출신 호출이라 모드와 허용 규칙을 무시하고 묻는다. 드래프트 승인 `auto`인 대화에서는 아니다(§4.6.1) [제안] */
export type DecisionReason = "rule" | "mode" | "noninteractive" | "bypass_forbidden" | "draft";

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
  /** 호출자가 준 거부 도구 이름 glob. 광고에서 빼지 않고 실행 시점에 거부한다 [제안: M3-REQ-78] */
  readonly deny?: readonly string[];
  /** allow 밖이거나 deny에 걸린 호출의 거부 문장에 붙일 안내 */
  readonly denyHint?: string;
}

/** 규칙 정적 검사. 잘못된 정규식, 범위 밖 priority, 중복 id를 돌려준다 */
export type PolicyIssueCode = "rule_id_duplicate" | "pattern_invalid" | "glob_invalid" | "priority_range" | "pointer_invalid";
export function validateRules(rules: readonly PolicyRule[]): readonly { readonly ruleId: string; readonly code: PolicyIssueCode; readonly message: string }[];
```

### 3.6 승인 (`approvals.ts`)

```ts
export const ApprovalServiceName = "fresnel.approvals" as const;

export type ApprovalKind = "tool" | "question" | "review";   // "plan"은 은퇴했다. 타입에만 남아 옛 기록을 읽고 새로 만들지 않는다 [결정: 2026-11-13 사용자]
export type ApprovalDecision = "allow" | "deny" | "answer";
export type ApprovalRemember = "once" | "thread" | "always";

export interface ApprovalOrigin {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly stepId: StepId | null;
  /** 이 요청을 일으킨 도구 호출. 질문 도구도 도구 호출이므로 보통 채워진다 */
  readonly toolCallId: string | null;
  readonly caller: CallerId;
  /**
   * 그룹(Helm 등)이 띄운 하위 대화의 요청이면 그 출처. 화면이 "렌즈 실패 사례 · grp:helm"으로 보인다.
   * `caller`와 `interactive`는 바꾸지 않는다. 승인 서비스가 활성 호출의 `ToolRunContext.source`로 채운다 [결정: 2026-10-31 사용자, fxHL]
   */
  readonly source?: RunSource;
}

/** 자식 대화를 띄운 소유 그룹의 출처. `scopeId`는 그룹 등록 id, `label`은 그룹이 `SpawnSpec.label`로 준 이름(없으면 null) */
export interface RunSource {
  readonly scopeId: string;
  readonly label: string | null;
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
  /** MCP 서버 도구면 서버 이름과 서버가 알린 성질. 표시용이고 신뢰하지 않는다(정책과 승인 결정에 쓰지 않는다). 옛 기록과 MCP가 아닌 도구에는 싣지 않는다 [결정: 오케스트레이터 기본값, fxMC] */
  readonly mcp?: { readonly server: string; readonly declared?: McpDeclaredHints };
  /** 훅 `tool.call.before`이 `ask`를 낸 카드면 그 확장과 사유. `ruleId`는 `hook:<확장 이름>`이다 [제안: M5e §4.3.1, D-6] */
  readonly askedBy?: { readonly extension: string; readonly reason: string };
  /** 초안 출신 호출의 표지(§4.6.1). 검토된 호출에는 없다 [제안] */
  readonly draft?: DraftMark;
}

// 계획 승인 본문(`PlanApprovalBody`)은 없다 [결정: 2026-11-13 사용자] [근거: 2026-11-15 사용자 정리]. 옛 기록의 body는 kind `plan`만 읽는다(F `LegacyPlanBody`).

export interface QuestionOption {
  readonly id: string;                 // 1~32자
  readonly label: string;
  readonly description?: string;
  readonly recommended?: boolean;      // 추천 표시. 화면이 강조만 하고 응답 검사에는 쓰지 않는다(m2 F.8)
}
export interface QuestionItem {
  readonly id: string;
  readonly header?: string;            // 질문 위의 짧은 머리글, 1~64자(m2 F.8)
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
  | { readonly kind: "question"; readonly question: QuestionBody }
  | { readonly kind: "review"; readonly review: ReviewBody };   // F services/approvals.ts. 본문 최소 집합은 adr.0018 §6

export interface ApprovalRequestInput {
  readonly origin: ApprovalOrigin;
  /** 요청 멱등 키(1~48자). 같은 대화에서 같은 키의 두 번째 요청은 처음 요청을 돌려준다. 도구 승인은 toolCallId */
  readonly requestKey: string;
  readonly title: string;              // 화면 제목. 1~120자
  readonly body: ApprovalBody;
  /** 이 요청에서 고를 수 있는 기억 범위. 질문은 ["once"]만 */
  readonly remember: readonly ApprovalRemember[];
  /** 만료 시각(epoch ms). 없으면 만료 없음. 내구 필드다(§4.7 6b) */
  readonly expiresAt?: number;
  /** 만료 때의 해결. 생략하면 deny */
  readonly onExpire?: { readonly decision: "deny" } | { readonly decision: "answer"; readonly answer: JsonValue };
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
  /** decision "answer"면 QuestionAnswer(question). decision "deny"면 { feedback } 허용. 옛 plan 기록의 allow는 받지 않는다 */
  readonly answer?: JsonValue;
  readonly remember?: ApprovalRemember;
}

export type ApprovalResolvedBy = "user" | "noninteractive" | "cancelled" | "superseded" | "expired";

export interface ApprovalResolution {
  readonly approvalId: string;
  readonly decision: ApprovalDecision;
  readonly answer: JsonValue | null;
  /** 실제 적용한 기억 범위. 2차 전에는 "always"를 "thread"로 낮춰 적용한다(§4.7) */
  readonly remember: ApprovalRemember;
  readonly requestedRemember: ApprovalRemember | null;
  readonly resolvedBy: ApprovalResolvedBy;
  /** `resolvedBy`가 `"extension"`이면 해결한 확장 이름. 훅 `ask.human.before`의 `cancel`·`answer`가 낸다 [제안: M5e §4.3.1] */
  readonly resolvedByExtension?: string;
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
  /** 비차단 요청(m2 F.8). 커밋만 하고 기다리지 않는다. 같은 requestKey면 새 이벤트 없이 기존 요청과 현재 해결 상태를 돌려준다 */
  open(input: ApprovalRequestInput): Promise<Result<OpenedApproval, ApprovalRequestError>>;
  /** 응답이 기록되면 이행된다. 이미 해결됐으면 바로 이행한다. signal이 끊기면 기다림만 그만둔다(요청은 남는다) */
  wait(approvalId: string, signal: AbortSignal): Promise<Result<ApprovalResolution, ApprovalWaitFailure>>;
  /** 메모리 대기 목록의 요청과 해결 상태. 모르는 approvalId면 undefined */
  get(approvalId: string): OpenedApproval | undefined;
}

/** 요청과 현재 해결 상태 */
export interface OpenedApproval { readonly request: ApprovalRequest; readonly resolution: ApprovalResolution | null }
export type ApprovalWaitFailure = { readonly kind: "aborted" } | { readonly kind: "unknown" };

export const ApprovalRequestSchema: TSchema;
export const ApprovalResolutionSchema: TSchema;
```

- wire 대응: `approval.respond { approvalId, decision, answer?, remember? }`(F.wire-settings.spec §3.3.1)가 `ApprovalService.respond(approvalId, { decision, answer, remember })`로 그대로 들어간다. 호스트(L4 host)가 이 호출을 한다.
- `approvalId`: 승인 요청은 내구 이벤트 `approval.requested`와 호스트 메서드 `approval.respond`로 한다 [결정: review.decisions-2 U-02]. `approvalId`는 `approval.requested` 이벤트의 `EventId`(`evt_` 접두)다. 같은 `requestKey` 재요청은 저장된 커밋 결과를 돌려받으므로(`replayed: true`) 같은 `approvalId`가 나온다.
- 종류별 응답 규칙:

| kind | 허용 decision | answer | remember |
|---|---|---|---|
| `review` | `answer`, `deny` | answer일 때 `ReviewAnswer`(`decisions`, `comments`, `submit` 필수. F `ReviewAnswerSchema`) 필수, deny일 때 `{ feedback }` 선택 | `once` |
| `tool` | `allow`, `deny` | deny일 때 `{ feedback: string }` 선택 | `once`, `thread`, `always`. 파이프라인은 `web.access`(`once`, `always`, `thread`)와 `sandbox.write_access`(`once`, `thread`) 밖에서는 `once`만 제안한다(§4.7 6번) |
| `plan`(옛 기록) | 없음 | 응답을 받지 않는다. 대기 목록에 올리지 않는다 [결정: 2026-11-15 사용자](§4.7 9번) | 없음 |
| `question` | `answer`, `deny` | answer일 때 `QuestionAnswer` 필수(질문 id마다) | `once` |

- 응답 검사 규칙 [제안]: 모두 `respond`가 커밋 전에 한다. 어긋나면 `applied: false`이고 이벤트를 쓰지 않는다. 요청은 대기 상태로 남는다. 결과의 `reason`이 클라이언트에 이유를 알린다: `answer_invalid`(decision이 kind에 맞지 않거나 answer·remember가 맞지 않음. `detail`에 한 줄. 요청은 대기 그대로라 고쳐 다시 보낼 수 있다), `already_resolved`(해결됐거나 다른 응답이 해결을 커밋하는 중), `unknown_approval`(이 런타임의 대기 목록에 없음. 메모리 표에서 빠진 해결된 요청도 여기에 든다), `commit_failed`(응답은 맞았으나 `approval.resolved` 커밋이 실패. 요청은 대기 그대로)(F `ApprovalApplyOutcome`, M2 마감 G1-09).
  - `tool`: `allow` 또는 `deny`. `remember`는 요청이 낸 범위 안이어야 한다.
  - `plan`(옛 기록): 대기 목록에 없어 응답 대상이 아니다. `respond`는 `unknown_approval`을 돌려준다(§4.7 9번).
  - `question`: `answer`의 `QuestionAnswer`는 질문마다 항목이 하나씩 있고(`{ selected: string[], text?: string }`, 그 밖의 필드 없음), `selected`의 id는 그 질문의 선택지 안에 있고 중복이 없고, `multiSelect`가 거짓이면 하나 이하다. `allowFreeText`가 거짓이면 `text`가 없다. 선택도 `text`도 비면 거부한다. `deny`의 `answer`는 `{ feedback }`만 받는다.
  - `review` [결정: M3-REQ-74, adr.0018]: `answer`의 `ReviewAnswer`는 F 스키마로 검사한다. 결정이 가리키는 hunk와 코멘트 대상이 실제로 있는지는 도메인(cap-artifacts)이 `approval.resolved`를 받을 때 본다. `allow`는 `answer_invalid`다. 요청은 `round >= 1`이고 파일 경로가 중복되지 않아야 한다.
  - `remember`: `question`, `review`는 `once`만 낸다.
- 요청 검사 [제안]: `request`와 `open`은 커밋 전에 입력을 본다. `requestKey` 1~48자, `remember`는 위 표대로, 질문은 1~4개이고 질문 id와 선택지 id(1~32자)가 각각 유일하고 선택지가 없는 질문은 `allowFreeText: true`여야 한다. 계획 승인(`plan`)은 요청 종류가 아니라서 만들 수 없다(§4.7 9번). 어긋나면 `ApprovalRequestError { kind: "rejected", code: "approvals.request_invalid" }` 값이다. 이벤트 payload 스키마(`ApprovalRequestedPayloadSchema`)도 같은 시점에 확인해, 저장소가 Bug로 거부하기 전에 값으로 돌려준다(TY-24).
- 비차단 요청 [제안]: `ApprovalService.request`는 `open`과 `wait`을 합친 것이다. L2 어댑터는 `open`(커밋만 하고 현재 상태를 돌려준다. 같은 `requestKey`면 기존 요청의 현재 상태)과 `wait(approvalId, signal)`(해결이 기록되면 이행. signal이 끊기면 기다림만 그만두고 요청은 남는다), `get(approvalId)`로 `L2ApprovalsPort`(`request`/`wait`/`get`)를 만든다. 세 메서드는 F `ApprovalService`에 올라갔다(§8.3 F 요청 11, m2 F.8). core-tools 구현은 `ApprovalsInternal`(= `ApprovalService`)이다.

### 3.7 결과 경계화 (`core-tools/src/bound.ts`)

출력 절단 함수(pi durable `truncate.ts` 포크)는 L0 `platform-exec`에 둔다. core-tools와 L2는 그 함수를 F 서비스 `fresnel.exec`로 부른다 [결정: review.decisions-2 D-08]. 아래는 core-tools가 쓰는 모양이다. 메서드 이름과 F 위치(`@fresnel/contracts/services`)는 `L0.exec.spec`이 정한다.

```ts
// platform-exec가 제공하는 절단(원본 truncate.ts의 export 이름과 시그니처 그대로). core-tools는 fresnel.exec로 받는다
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
  | "approvals.noninteractive";  // 비대화형 실행에서 question 요청

export interface ToolsError { readonly kind: ToolsErrorCode; readonly message: string; readonly detail?: JsonValue }
```

- `tools.intent_missing`은 버그로 보고 예외를 던진다(eng.typescript.guide TY-11). 등록 충돌은 `register`가 `ToolRegisterError { kind: "name_conflict", toolName }` 값으로 돌려준다. 나머지도 값으로 돌려준다.
- 승인 요청 이벤트의 커밋 실패는 `ApprovalService.request`가 `ApprovalRequestError`(`store` | `rejected` | `key_reused`) 값으로 돌려준다. 파이프라인 안에서는 호출을 `tools.commit_failed`로 거부한다. 이벤트 읽기 실패(`restore`, `rerun`의 효과 상태 읽기)는 `ReadFailure` 값이다.
- 모델에 보이는 거부·오류 문장은 영어로 둔다. 형식은 `"[fresnel:<code>] <message>"`이고 F.capabilities.spec §4.2 규칙 5의 `"[<code>] <message>"`와 같은 꼴이다.

### 3.9 이벤트

core-tools가 쓰는 코어 kind(F.records.spec §3.3 카탈로그):

| kind | 시점 | requestId [제안] |
|---|---|---|
| `effect.intent` | 정책·승인 통과 뒤, 실행 전(§4.2 6단계) | `tool:<toolCallId>:intent`. 이 표의 `<toolCallId>`는 F `commitKeyPart`의 값이다(review.decisions-2 U-13) |
| `effect.exec` | 키 잠금·슬롯을 얻은 뒤 실행 직전(§4.2 7d단계) | `tool:<toolCallId>:exec` |
| `effect.result` + toolResult `item.recorded` | 결과 경계화 뒤 한 커밋(§4.2 10단계) | `tool:<toolCallId>:result` |
| `settings.changed` | 권한 모드 변경(대화 범위) | `mode:<threadId>:<clientUlid>` |

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

- 이벤트는 `surfaceThreadId` 대화에 기록한다. 그래야 서브에이전트의 승인 요청이 부모 대화 구독자에게 보인다. 요청을 낸 대화는 payload `origin.threadId`에 남는다 [제안]. 도구 호출 id 없이 올라온 요청(기능 서비스의 도메인 승인)도 같다: 요청한 대화에 진행 중인 도구 호출이 있으면 그 호출의 `surfaceThreadId`를 쓴다(`ApprovalDeps.surfaceOf`). 그렇지 않으면 요청한 대화가 표면이다. 하위 대화를 표면으로 두면 쓰기 소유가 없어 답이 `thread.locked`로 거절된다.
- [제안] 이벤트 소유: `effect.*`, `approval.*`는 `tool-runtime`(core-tools) 소유다. eng.context-map.design §5.1 표의 `tool.` 행을 F 이름 `effect.`로 바꾸도록 요청한다(§8.4).
- requestId 길이: `approval:<threadId>:<requestKey>:request`는 `thr_` ULID(30자) + 키 48자로 64자를 넘을 수 있다. 64자를 넘으면 `approval:` + `sha256(threadId + ":" + 키 부분)` 앞 32자 + `:request`로 바꾼다 [제안].
- 키 부분: 도구 승인의 `requestKey`는 `toolCallId`에서 F `requestKeyFor(raw, sha256Hex)`(`@fresnel/contracts/records`, `commitKeyPart`(F.records.spec §3.9, eng.transactions.design §4.7, U-13) 위에 선 유일한 요청 키 변환, 상한 `APPROVAL_REQUEST_KEY_MAX`)로 만든다. core-tools는 자기 함수를 두지 않고 `sha256HexSync`를 넘겨 이 함수를 부른다 [결정: 통합 검토 L6]. `toolCallId`는 provider가 정하는 밖의 값이라 커밋 키 알파벳 밖 문자를 가질 수 있기 때문이다. 결과가 48자를 넘으면 `h_` + 원문 sha256 앞 40자로 줄인다. 호출자가 직접 넘긴 `requestKey`도 커밋 키에 넣기 전에 `commitKeyPart`를 거친다(`h_` + 해시 40자 형식은 그대로 쓴다) [제안].

## 4. 동작 규칙

### 4.1 노출

[제안] 광고 목록은 고정하고, deny된 도구는 빼고, 나머지는 tool search로 늦게 노출한다. 계획 v2 구성요소 표기를 따른다(`_research/layer-plan-v2.json` L1-d "도구 노출 분리").

1. 순서: 등록된 도구 전체에 `orderTools`(F.capabilities.spec §3.8)를 적용한다. 기능 밖 도구도 같은 비교 함수에 넣는다(§3.1 순서 키). 광고 목록의 순서는 이 결과의 부분 수열이다. 그래서 같은 등록 상태면 입력 순서와 무관하게 같은 목록과 같은 `fingerprint`가 나온다.
2. 전역 deny 제거 [제안]: 도구마다 `PolicyInput{ args: null }`로 `evaluatePolicy`를 부른다. 결과가 `deny`이고 그 규칙의 resource에 `args`와 `mode` 조건이 없으면 광고 목록에서 뺀다. 거부 응답을 내는 대신 목록에서 빼는 방식은 Gemini CLI 정책 엔진에서 가져왔다(`_research/item-catalog.md` 진보된 설계 5번, opencode `registry.snapshot(permissions)` `_research/refs/opencode.md` 161행). 인자나 모드에 따라 달라지는 deny는 목록에 남기고 실행 시점에 거부한다.
3. 모드에 따른 제거는 하지 않는다 [제안]. 모드가 정하는 허용과 확인(§4.6)은 실행 시점에 판정한다. 모드를 바꿀 때마다 광고 목록이 바뀌면 프롬프트 캐시 접두가 깨지기 때문이다(`_research/ref-synthesis.md` L1 코어 (c) 캐시 원칙). 모드에 묶인 지연 도구를 켜는 것(규칙 5의 `activeWhen`)은 제거가 아니라 대화 중 추가이고, 대화 중 도구 추가를 받는 모델에서만 일어나므로 접두를 깨지 않는다.
4. 지연 노출 [제안]:
   - `exposure: "always"`는 항상 광고한다. 내장 도구와 L2 작업 도구의 기본값이다.
   - `exposure: "deferred"`는 처음부터 지연 도구다.
   - `exposure: "auto"`는 광고 후보 수(always + auto)가 `l1.tools.exposure.deferThreshold`를 넘으면 지연 도구가 된다. MCP 서버 도구의 기본값이다. 넘으면 auto 도구가 모두 지연이고(일부만 고르지 않는다), 임계가 0이면 항상 지연이다. 
   - 내장 도구의 노출 [결정: 2026-11-13 사용자 "애매한 것들 전부 지연으로 넣어"]: 항상 싣는 도구는 작업 폴더 도구(`read`, `write`, `edit`, `bash`, `grep`), 질문(`ask_user`), 작업 목록(`task_write`)과 도구 실행 틀이 스스로 쓰는 `tool_search`(지연 도구가 있을 때)이다. `read_tool_output`은 폐지됐다(§4.8 6번). 그 밖의 내장 도구는 각 기능의 등록(`CapabilityToolsRegistration.exposure`)이 `deferred`로 지정한다: 웹(`web_search`, `web_fetch`, `web_browse_*`), 지식(`knowledge_search`, `session_scroll`, `session_read`, `memory_manage`, `skill_view`, `skill_manage`), MCP 기능 도구(`mcp_servers`, `mcp_list_resources`, `mcp_read_resource`)와 MCP 서버 도구, 산출물(`artifact_create`, `artifact_update`, `review_request`, `session_rename`), 예약(`schedule_create`), 서브에이전트(`agent`), 학습 제안(`learning_propose`). 작업 폴더 도구 `ls`와 `find`는 삭제됨 [결정: 2026-11-13 사용자 "ls find는 bash로 대체"]: 목록과 찾기는 `bash`가 맡고, 두 도구의 등록과 지연 노출 항목은 두지 않는다(L2.workspace.spec §3.2). 계획 도구 셋(`enter_plan_mode`, `exit_plan_mode`, `submit_plan`)도 [결정: 2026-11-13 사용자] 폐지되어 등록과 지연 노출 항목이 없다. 기본값 `always`는 바꾸지 않는다: 지정하지 않은 확장·그룹 도구는 그대로 항상 실린다. 확장·그룹 도구 정의(`ToolResourceDef.exposure`)와 직접 등록(`DirectToolRegistration.exposure`)도 같은 값을 받는다.
   - 지연 도구가 하나라도 있으면 내장 도구 `tool_search`(순서 키 `core.tools`)를 광고한다. `tool_search`는 질의(`query: string`, `limit?: number`)로 지연 도구의 이름·설명을 찾고, 결과로 고른 도구를 활성화한다. 활성화된 도구는 다음 단계부터 광고된다.
   - 대화 중간의 추가는 L1.context.spec이 `diffToolsets`의 `added`를 pi-ai `SystemMessage.toolsAdded`로 대화 기록에 넣는다(F.capabilities.spec §4.5). Anthropic 경로에서는 pi-ai가 `tool_addition` 블록으로 바꾸고, 첫 요청의 지연 자리표시 도구(`anthropic-messages.ts:200-209`, `defer_loading: true`)가 캐시 접두를 지킨다(`anthropic-messages.ts:1141-1149`).
5. 활성화 [결정: 2026-11-13 사용자 "애매한 것들 전부 지연으로 넣어"]: 지연 도구는 셋 중 하나면 광고된다. (가) `tool_search`가 활성화했다(아래). (나) 등록이 준 상태 조건 `activeWhen(threadId)`이 참이다. 조건은 대화 상태를 읽기만 하는 동기 질의이고 `planExposure`가 부른다. (다) 서브에이전트 정의의 도구 제한(`allow`)이 그 도구의 이름을 glob 없이 그대로 적었다. 정의가 그 도구를 쓰라고 정한 것이라 검색을 거치지 않는다(학습 검토 에이전트의 `learning_propose`). 모델이 대화 중 도구 추가를 받을 수 없으면(`AdvertiseInput.deferralAvailable === false`, core-loop가 `CachePolicy.midConversationToolChanges`에서 채운다) 활성화한 도구가 요청에 실리지 않으므로(L1.context.spec §4.3 5번 `defer`) 지연하지 않고 모든 도구를 싣고 `tool_search`는 싣지 않는다. 도구가 128개를 넘으면 이 예외 없이 지연으로 줄인다. 이 모델에서는 도구 정의가 줄지 않는다.
   - 활성화 상태는 이벤트에서 다시 계산한다. `tool_search`의 `effect.result.output.structuredContent`에 `{ activated: ToolName[] }`를 남기고, `advertise`의 `activated`는 그 대화의 이 값들의 합집합이다. 재개 뒤에도 같은 광고 목록이 나온다.
   - `tool_search` 구현 [결정: L1A.5]: 인자는 `query`(1~200자)와 `limit`(1~20, 기본 5)다. 질의를 영숫자 토큰으로 나눠 아직 활성화되지 않은 지연 도구의 이름(일치 10점, 포함 5점)과 설명(포함 2점)에 점수를 매기고 점수 0은 뺀다. 한글 같은 비영숫자 질의는 토큰이 없어 맞는 것이 없다. 그래서 도구 설명이 영어 키워드로 질의하라고 알리고, 맞는 도구가 없으면 결과가 지연 도구의 이름만 나열한다(설명은 싣지 않는다) [결정: 2026-11-13 사용자 "애매한 것들 전부 지연으로 넣어"의 구현 판단]. 점수가 같으면 순서 키 순이다. 전역 deny로 뺀 도구는 찾지 않는다. 결과 `content`는 도구 이름과 설명 첫 줄의 목록이고 `structuredContent`는 `{ activated }`다. 광고 목록에 남은 자리(128 − 현재 광고 수)만큼만 활성화하고 넘는 수는 결과 문장에 적는다. 도구는 `risk: read`, `replay: "safe"`다.
   - 재계산 위치: `tool_search`와 core-loop가 각자 활성 가지의 `effect.intent`(도구 이름)와 `effect.result`(`structuredContent.activated`)를 읽는다. core-loop는 turn마다 한 번 읽고 같은 turn의 `tool_search` 결과를 그때그때 더한다.
   - `tool_search` 광고: 지연 도구가 있거나 상한 때문에 지연이 생길 때 광고한다. 한 번 광고하면 지연 도구를 모두 활성화해도 목록에 남겨 캐시 접두를 흔들지 않는다(같은 등록 상태에서). 자리는 하나를 쓴다.
6a. 광고 구조 [결정: 2026-11-13 사용자]: 광고하는 `parameters`는 F.capabilities.spec §4.3 `toModelSchema`로 줄인 구조다(anyOf-const는 `enum`, 내장 도구는 검증 키워드 제거, MCP·확장·그룹 도구는 `enum`만). 실행 전 검증은 도구 정의의 원래 `parameters`로 한다(`validateToolArguments`). 서버가 거부하는 한도 중 모델이 알아야 하는 것은 필드 `description`에 있다.
6. 도구 수 상한: 광고 목록(내장 `tool_search` 포함)은 `MAX_TOOLS_PER_REQUEST = 128`(F.capabilities.spec §4.3) 이하다. core-tools가 집행한다.
   - always + auto 후보가 128을 넘으면 auto 도구를 순서 뒤쪽부터 지연 도구로 돌린다.
   - always 도구만으로 128을 넘으면 `advertise`가 `AdvertiseError { kind: "too_many" }` 값을 돌려주고(던지지 않는다. 확장이 정하는 always 도구 수가 만드는 예상 가능한 실패다) 루프는 그 단계의 모델 요청을 보내지 않고 `tools_unavailable`로 닫는다.
   - `tool_search`의 활성화가 상한을 넘기면 넘는 도구는 활성화하지 않고 결과 문장에 그 사실을 적는다.
7. 서브에이전트 대화의 광고 목록은 L1.agents.spec의 권한 상한을 따른다. `allow` 밖 도구와 자식 기준 전역 deny 도구를 뺀다. `keepParentList`를 주면 부모 광고 목록을 그대로 쓰고 실행 시점에만 거른다(캐시 접두 공유).
   - 구현 [결정: L1A.6]: 자식 관점(caller·depth)과 부모 관점(`ceiling`의 caller·depth) 중 어느 쪽에서든 전역 deny인 도구를 `removed`에 둔다. 도구 제한은 `AdvertiseInput.allow`(없으면 `ceiling.allow`)의 `matchToolGlob`으로 거른다. `tool_search`는 제한 밖이어도 제한 안의 지연 도구가 있으면 광고한다. `keepParentList`는 부모 `AdvertisedToolset`의 `tools`·`deferred`·`removed`·`fingerprint`를 그대로 돌려준다. 부모 목록에 있는 도구도 자식이 부르면 실행 시점의 ceiling 단계가 거부한다.
8. [미결] Anthropic 서버 도구 `tool_search`(서버 쪽 지연 로딩)를 쓸지. pi-ai 1.3.0은 Anthropic에서 `defer_loading`을 자리표시 도구에만 쓴다(`ai/src/api/anthropic-messages.ts:208`). provider 독립인 내장 `tool_search`를 1차로 두고 서버 도구는 2차 검토로 둔다 [제안].

### 4.2 실행 파이프라인

[결정: adr.0009] 순서는 pi-agent-core 1.3.0 파이프라인(`agent-loop.ts:684-949`)의 준비·실행·마감을 그대로 가져와 `prepare`·`execute`·`settleRejected` 세 메서드로 나눈 것이다. 원본의 `beforeToolCall`·`afterToolCall` 훅 자리는 없다. 정책·승인·효과 기록은 이 메서드 안의 단계다(`_research/packages.md` §4.3 L1-d "실행 파이프라인: 그대로"). 원본 줄 번호는 대조용이다(1.3.0 소스는 1.1.0과 바이트 동일, `_research/notes/L1-1.md` §2).

| # | 단계 | 위치 | 실패 처리 |
|---|---|---|---|
| 1 | `tool.execution.before` 발화(tap) | `prepare` 첫 단계 | 기록 후 계속 |
| 2 | 도구 이름 해석 | `prepare`. 원본 agent-loop.ts:716-722 | 없으면 `[fresnel:tool_unavailable]` 오류 결과(`settled`) |
| 3 | 인자 준비 | 없다. 도구별 `prepareArguments`는 F `AgentTool`에서 뺐다(F.conversation.spec §3.1.1) | — |
| 4 | 스키마 검증 `validateToolArguments` | `prepare`. core-tools `validate.ts`가 pi-ai 1.3.0 `validateToolArguments`의 TypeBox 경로(argumentsError 확인, 사본, 선택 null 제거, `Value.Convert`, 스키마 검사)를 옮겼다. TypeBox 표지가 없는 순수 JSON Schema(MCP)의 `coerceWithJsonSchema` 경로는 옮기지 않았다(M2 cap-mcp에서 더한다) | 예외 대신 `settled` 오류 결과로 모델에 돌아간다 |
| 5a | `tool.call.before` 훅(first, 합치기 `block` > `replace` > `ask`) | `prepare` | 핸들러 예외는 `FIRST_DENY.tool_call`로 거부(fail-closed). 디스패처 자체 예외도 거부. 막기는 거부다. 결과 대신 주기(`replace`)는 실행 없이 결과를 기록하고 5b~11을 건너뛴다. 묻기(`ask`)는 5c의 카드로 잇는다(§4.2.1) |
| 5b | 정책 평가 `evaluatePolicy`. 자식 대화(`ceiling` 있음)는 §4.5 ceiling 단계 적용 | `prepare` | deny는 `settled` |
| 5c | 승인 대기(정책이 ask일 때, 또는 훅이 `ask`를 냈을 때) | `prepare`. `ApprovalService.request`. 정책 카드와 훅 묻기 카드는 합쳐 한 장이다(§4.2.1) | deny·cancelled는 `settled`. 답할 사람이 없는 실행에서 훅 묻기가 거부되면 `[fresnel:denied_by_extension] <사유> (confirmation unavailable)`이다 |
| 5c2 | `guard.tool.before` 훅(first) [M3-REQ-109] | `prepare`. 정책·승인(시크릿 사용 승인 포함)을 모두 통과한 호출만 온다. 의도를 쓰기 전이다 | 핸들러 `{ block: true, reason }`는 `settled`(`[fresnel:denied_by_guard] <reason>`)이고 효과 이벤트가 없다. 핸들러·디스패처 예외도 거부(fail-closed, `FIRST_DENY["guard.tool.before"]`). 내장 검사는 없다. 페이로드는 5a와 같은 `ToolCallPayload`다 |
| 5d | 중단 확인 | `prepare`. 의도를 쓰기 전에 turn 신호를 본다 | 중단이면 `settled`(`[fresnel:aborted]`) |
| 6 | `effect.intent` 커밋 | `prepare`의 끝 | 커밋 실패는 `settled`(`[fresnel:tools.commit_failed] …`) |
| 7a | tool 범위 노드 열기: `fresnel.tasks.find("turn", run.turnId)`로 turn 노드를 찾고 `openScope(turn, { kind: "tool", id: toolCallId })`(L1.tasks.spec §4.1) | `execute` 진입 | 의도가 없으면 `tools.intent_missing`(호출 순서 위반, Bug). turn 노드가 `aborting`이면 신호가 켜진 노드를 받고 중단 결과로 끝난다 |
| 7b | 잠금 키 산출: 도구의 잠금 선언(`ToolSpec.locks`, L1.tasks.spec FR-T6)이 낸 경로마다 `fresnel.exec`의 `canonicalPath`로 정규 경로를 얻어 키 `${env.id}\0${realpath}`를 만든다. 없는 파일은 부모 정규 경로 + 이름이다. 읽기 도구(`hints.readOnly`)는 `shared`, 그 밖은 `exclusive`다 | 같은 자리 | 잠금 선언이 없으면 키 큐를 쓰지 않는다. 경로 해석 실패는 `invalid_input` 오류 결과다 [제안] |
| 7c | 키 잠금 뒤 `tools` 풀 슬롯 획득: `fresnel.tasks.locks.run(keys, toolNode, () => limiter("tools").acquire(toolNode) …)`. 순서는 L1.tasks.spec §4.5 C3(키 먼저, 슬롯 나중)이다. 잠금 선언이 없는 호출도 슬롯은 얻는다. 실행이 끝나면 슬롯을 놓는다(M2 구현 완료) | 같은 자리 | 대기 중 취소는 `[aborted]` 중단 결과이고 `effect.exec` 전이므로 재개 판정은 `not_started`다 |
| 7d | `effect.exec` 커밋 | 같은 자리 | 커밋 실패는 실행하지 않고 `tools.commit_failed` 결과 |
| 8 | 도구 실행 | 어댑터가 provider 메서드 또는 `DirectToolRegistration.tool.execute`를 부른다. `signal`은 tool 노드 신호다. 진행은 `onUpdate` 콜백과 `tool.execution.update`(tap)이고 발화 전에 시크릿 마스킹을 거친다(§4.12) | 예외는 오류 결과, `CapabilityError`는 §4.3. 실행이 끝나면 슬롯을 반납한다(C1) |
| 9 | `tool.result` 훅(chain) | `execute`의 마감. 페이로드는 마스킹한 결과다(§4.12) | 실패한 핸들러의 패치만 버린다(skip) |
| 10 | 결과 경계화 + `effect.result`·toolResult `item.recorded` 한 커밋. 커밋 뒤 tool 노드가 정착한다 | `execute`의 마감 | 커밋 실패는 §5 사례 7(`itemId: null`) |
| 11 | `tool.execution.after` 발화(tap) | 마감 뒤 | 기록 후 계속 |

부속 규칙:

- 단계 1~6은 한 `prepare` 호출 안에서 순서대로 실행한다. `prepare`는 예상 가능한 실패를 모두 `settled`로 돌려주고 던지지 않는다(Bug 제외). core-tools는 거부 사유를 직접 정해 모델에 보이는 문장을 고정한다.
- `execute`는 예상 가능한 실패를 던지지 않는다. 도구가 던진 오류는 `isError` 결과가 된다. chain의 핸들러별 skip은 ext-host 디스패처가 한다(F.extensions.spec §4.1).
- 의도 커밋에 넣는 인자는 단계 5a 이후의 최종 인자다. 1.3.0의 `BeforeToolCallResult`에는 인자 재작성 필드가 없으므로(agent `types.ts:66-74`) 최종 인자는 검증된 인자와 같다. 인자 재작성은 §4.10(2차)이다.
- 병렬 모드에서 루프는 배치의 준비(단계 1~6)를 앞 호출부터 하나씩 마친 뒤 실행을 함께 시작한다(L1.loop.spec §3.3 규칙 2·3, 원본 agent-loop.ts:596-648). 그래서 한 배치 안의 승인 요청은 앞 호출부터 차례로 하나씩 나간다 [제안]. 여러 요청을 묶어 한 번에 보이는 화면은 L4가 `pending()`으로 만들 수 있다.
- `tool.execution.before`는 거부될 호출에도 발화한다(원본 agent-loop.ts:543, 598). 그래서 의도 기록의 근거로 쓰지 않는다(`_research/notes/L1-1.md` §3(c)).
- 중단으로 실행하지 않는 호출은 루프가 같은 배치 안에서 `settleRejected(…, "not_executed")`로 닫는다(L1.loop.spec §3.3 규칙 4). core-tools는 그 호출들을 의도가 있으면 `effect.result{ status: "abandoned" }`와 toolResult item 한 커밋으로, 의도가 없으면 toolResult item 하나(`effectId: null`)로 기록한다. `stopReason: "length"`로 잘린 응답의 호출은 `"truncated"`로 닫는다. 같은 호출을 두 번 닫아도 처음 결과를 돌려주고 다시 쓰지 않는다.
- 차단된 호출(2~5d 실패)에는 효과 이벤트가 없다. 그 오류 결과는 core-tools가 `prepare` 안에서 toolResult `item.recorded`(`effectId: null`, 커밋 키 `tool:<key>:result`)로 기록한다. 루프는 toolResult item을 직접 기록하지 않는다.
- [제안: M5d-1 호출 추적] `ToolsDeps.callTrace`(선택)는 읽기 전용 싱크(`ToolCallTraceSink.record`, F `extensions/tool-call-trace.ts`)다. 호출이 닫힐 때 한 줄을 받는다. 닫는 자리는 셋이다. 실행을 마감하는 자리(`execute`, `rerun`, 사용자 셸의 실행)는 `allowed` 또는 중단 판정으로 한 줄을 쓴다. 실행 전에 닫는 자리(`prepare`의 2~5d·5c2 거부, 미발견, 인자 오류, `settleRejected`)는 그 거부의 판정을 쓴다. 플러그인 기능 호출(`executeForPlugin`)은 실행 전 거부와 미발견, 인자 오류를 쓰고 실행한 호출은 마감 자리가 쓴다. 이미 닫힌 호출을 다시 돌려주는 재생은 줄을 더 쓰지 않는다. 판정이 없는 닫기(저장 실패, 내부 오류)는 줄을 남기지 않는다. 싱크가 없으면 줄의 값도 만들지 않는다. 싱크가 던지면 `tools.call_trace_failed` 경고만 남기고 호출 결과는 그대로 둔다. 줄에는 인자 값과 결과 본문을 싣지 않는다(인자는 정규화 JSON의 해시와 글자 수다).
- 같은 파이프라인 밖에서 도구를 실행하는 경로는 두지 않는다. 도구가 다른 도구를 부를 때도 `prepare`·`execute`를 지나야 하고, 중첩 호출의 `ToolCallPayload.parentToolCallId`를 채운다. 중첩 호출의 진입점 이름과 위치는 [미결](§10)이다.
- 태스크 엔진 연결 규칙 [제안]:
  - tool 노드의 작업은 7a~10단계다. 어댑터는 이 구간을 `toolNode.track(…)`으로 등록한다. 그래서 turn 취소(L1.tasks.spec §4.2)는 실행 중 도구의 신호를 켜고, turn 노드는 10단계 커밋이 끝난 뒤 정착한다.
  - 서브에이전트를 부르고 결과를 기다리는 도구(core-agents의 `agent` 도구)는 기다리는 동안 `slot.suspendWhile(child.settle())`로 `tools` 슬롯을 내려놓는다(L1.tasks.spec §4.5 C2, L1.agents.spec §4.1 4번). 슬롯은 7c에서 얻은 것을 어댑터가 실행 맥락으로 넘긴다.
  - 7b의 키 산출 함수(durable `file-mutation-queue.ts` 7-26행 `mutationKey`, `canonical`)는 core-tools로 옮긴다(L1.tasks.spec §4.4 포크 2번). 파일 시스템 접근은 `fresnel.exec`만 쓴다(DR-13).
  - 기능 밖 도구(`DirectToolRegistration`)는 M1에 잠금 선언이 없다. 필요해지면 같은 모양의 선택 필드를 더한다 [제안].
  - `rerun`(§4.9)도 7a~11단계를 지나므로 키 잠금과 슬롯을 다시 얻는다.

#### 4.2.1 훅 결정 ask와 replace [제안: M5e 스펙 §4.2, §5.1 H-1~H-3, §7 E-1~E-3]

`tool.call.before`의 결정은 셋이다(`ToolCallDecision`, `contracts/src/extensions/hooks/tool.ts`). 허용은 값으로 내지 않는다(`undefined`가 허용이다).

| 화면 말 | 값 | core-tools가 하는 일 |
|---|---|---|
| 막기 | `block` | 실행하지 않고 `[fresnel:denied_by_extension] <사유>`를 모델에 준다. 기록은 차단된 호출과 같다 |
| 묻기 | `ask` | 정책 판정 뒤 승인 카드를 연다(아래 규칙 1~6). 허용이면 시크릿 사용 승인과 `guard.tool.before`가 이어진다. 거부면 `The user denied this tool call.`의 거부 결과다 |
| 결과 대신 주기 | `replace` | 실행하지 않고 훅이 낸 결과를 기록한다(아래 "결과 대신 주기의 기록"). 정책·승인·`guard.tool.before`·`tool.result`를 평가하지 않는다 |

합치기 [결정: 2026-11-17 사용자, U3. M5e §5.1 H-2]: `tool.call.before`는 같은 위치의 모든 핸들러를 돌린 뒤 `block` > `replace` > `ask` 순으로 가장 강한 결정을 쓴다. 같은 종류 안에서는 순서가 앞선 핸들러의 값이 이긴다. 구현은 `ext-host`의 `FIRST_RANK`다. 다른 first 훅은 처음 결정에서 멈춘다.

묻기의 규칙:

1. 정책 deny는 deny다. 훅의 묻기는 정책 거부를 풀지 못한다(H-1). 정책 판정은 카드보다 먼저 끝나므로 정책이 deny면 카드를 열지 않는다.
2. 정책이 allow거나 ask면 카드를 정확히 한 장 연다(H-3). 카드 본문의 `askedBy`는 `{ extension, reason }`이고 `ruleId`는 `hook:<확장 이름>`이다. `remember`는 `["once"]`뿐이다 [제안, M5e 12절 O-2]. 정책도 물었으면 카드 제목에 정책의 규칙 id와 훅의 사유를 함께 싣는다. 사유 전문은 `askedBy.reason`에 있다.
3. 훅이 물은 호출에서는 정책의 `ask`를 무인 거부로 바꾸지 않는다(§4.5 6단계를 건너뛴다). 답할 수 없을 때의 거부는 승인 서비스의 무인 정책(§4.7 6c)이 정한다.
4. 권한 모드 `bypass`에서도 훅의 묻기는 카드를 연다(E-2). `bypass`는 코어가 스스로 묻지 않는다는 뜻이다. 저장소가 고른 `bypassAllowed` 평가는 바뀌지 않는다.
5. 허용되면 시크릿 사용 승인(§4.12)과 `guard.tool.before`가 이어진다. 사용자가 누른 허용은 `state.userApprovalId`로 남아 시크릿 사용의 증거가 된다.
6. 사용자가 `!명령`으로 직접 친 셸 호출의 훅 묻기는 허용으로 본다. 사용자가 낸 명령이라서다 [가정: 확장이 사용자 셸 명령에 묻는 경로는 현재 구현에 들어 있지 않다. 근거: `core-tools/src/pipeline.ts`의 `decide`가 `state.userShell`이면 묻기도 허용으로 본다. 이 가정이 틀리면 §10에서 다시 정한다].

무인 실행 [결정: M5e §7 E-1, A-5]: 답할 사람이 없으면 승인 서비스의 무인 정책(`l1.tools.unattended.approval`: `deny`, `wait`, `expire`)을 따른다. `deny`로 거부되면 모델에 보이는 본문은 정확히 다음 한 줄이다.

`[fresnel:denied_by_extension] <사유> (confirmation unavailable)`

사유에 줄바꿈이 있으면 공백으로 바꾼다. 서브에이전트와 깊이가 있는 호출은 카드를 열지 않고 같은 문장으로 거부한다 [제안: 시험 지시의 "침묵 거부"를 이 문장으로 읽었다. M5e §7 E-4의 "묻지 않고 거부"와 맞다]. 이 거부 결과의 `details`는 `{ code: "denied_by_extension", hook: "tool.call.before", extension, outcome: "asked", reason }`이다. `outcome`의 `asked`는 M5e §4.5의 표시값 변환이 쓰는 값이다. 막음의 `details` 모양(`blocked`, `threw`)은 바뀌지 않는다.

결과 대신 주기의 기록 [제안: M5e §4.2 "replace의 동작"]:

- `effect.intent`를 쓰지 않는다. 도구 결과 항목 하나를 `effectId: null`로 기록한다. 커밋 키는 차단된 호출과 같은 `tool:<key>:result`다(§4.2 부속 규칙).
- 결과의 `content`는 훅이 낸 `content`다. `isError`는 훅이 낸 값이고, 없으면 `false`다. `details`는 훅이 낸 객체에 `{ hook: "replaced", extension }`을 합친다. 훅이 낸 `details`가 객체가 아니면 `details` 키 아래에 그대로 싣는다.
- `tool.result` 훅은 돌지 않는다. 훅이 이미 정한 값이기 때문이다. 정책, 승인, `guard.tool.before`도 평가하지 않는다. 기준 시험은 §9 43번이다.
- 결과 본문은 `outputLimits` 경계화(§4.8)를 거치지 않는다. 본문 상한은 §10 미결이다.
- 사용자 셸 호출에서 `replace`가 닫은 호출은 `runUserShell`이 `details.code`를 `not_executed`로 바꿔 돌려준다(§3.3 `runUserShell`).

### 4.3 어댑터 환원

기능 도구의 `ToolSpec` → 도구 항목(`ToolEntry`)과 실행 함수 변환(core-tools `entries.ts`)은 F.capabilities.spec §3.3 대응표와 §4.2 환원 규칙 5단계를 그대로 따른다. 이 문서는 L1 쪽 결정만 더한다.

| F.capabilities §4.2 단계 | core-tools 구현 |
|---|---|
| 1. 인자 검증 | `prepare` 4단계(core-tools `validate.ts`, §4.2)가 한다. 어댑터는 다시 검증하지 않는다 |
| 2. `toInput` | 어댑터 `execute` 안에서 부른다 |
| 3. 메서드 호출 `api[method](input, { signal, requestId })` | `requestId`는 `tool:<toolCallId>`다 [제안]. `signal`은 `execute`가 합친 신호(루프가 넘긴 호출 신호, turn 신호, tool 노드 신호) |
| 4. `toContent` 또는 기본 렌더링 | 결과를 `AgentToolResult`로 만든다. `structuredContent`는 `outputSchema`로 검증하고 위반은 `internal` 오류 결과로 바꾼다(F.capabilities.spec §5 사례 3) |
| 5. `CapabilityError` → `isError: true` | `content`는 `"[<code>] <message>"`, `details`는 `CapabilityErrorData`. `code: "aborted"`는 중단 결과로 처리하고 `effect.result.status`를 `interrupted`로 둔다 |

- `afterUntrusted` [결정: M3-REQ-100]: 파이프라인이 turn 안에서 웹·MCP 도구의 결과를 낸 호출을 기억한다. 웹 도구는 기능 id가 `web.`으로 시작하는 기능 도구이고 MCP 도구는 정책 메타에 `mcpServer`가 있는 도구다. 같은 turn의 뒤 호출은 시작 때 `RawCall.afterUntrusted = true`를 받고, 어댑터가 이것을 `CallContext.caller.afterUntrusted`로, 확장 도구(`ToolResourceDef.execute`)의 `ctx.caller.afterUntrusted`로 넘긴다. 확장 도구의 `ctx.toolCallId`는 호출 id다(M3-REQ-102, X.primitives.spec §4.6.6). 기억은 프로세스 안이고 turn 수가 512를 넘으면 오래된 것부터 잊는다. 웹·MCP 도구의 결과를 커밋할 때 내구 이벤트 `tool.untrusted_read`(`{ turnId, toolCallId, toolName, at }`)를 같은 커밋에 쓰고, 메모리에 없는 turn은 첫 조회에서 이 이벤트를 찾아 복원하므로 재시작 뒤 이어진 turn도 참으로 시작한다 [결정: M3-REQ-100]. 읽기에 실패하면 안전한 쪽으로 참으로 본다. 같은 배치의 병렬 호출은 먼저 끝난 호출의 표지를 볼 수 있다(안전한 쪽의 오차). 표지는 한 번 켜지면 turn이 끝날 때까지 꺼지지 않는다.
- `replay`: 기능 도구는 `ToolSpec.replay`(F `ReplayPolicy`, 미선언은 `"unsafe"`)를 그대로 쓴다. `DirectToolRegistration`은 F `AgentTool.replay`(`"never" | "safe"`)를 `toReplayPolicy`로 바꾼다(`"never"`·미선언 → `"unsafe"`). `effect.intent.replay`에는 이 F `ReplayPolicy` 값을 쓴다.
- `label`, `executionMode`, `outputSchema`는 그대로 옮긴다. `hints`는 `ToolMeta.hints`로 보관하고 위험 등급 유도(§4.6)에 쓴다.
- `input_required` 출력 변형 [결정: L1A.4]: 판별 필드는 `status: "input_required"`다(L2.dialog `ask`, L2.work `submit`, L2.mcp `callTool`의 출력 변형이 모두 이 필드를 쓴다). 어댑터는 메서드 출력을 렌더링하기 전에 이 변형을 본다.
  - `approvalId`가 있으면(도구가 자기 승인을 이미 올렸다. dialog, work) 어댑터는 그 승인의 해결을 기다린다. 해결이 기록되면 같은 입력, 같은 `requestId`로 메서드를 다시 부른다. 도구는 같은 `requestId`의 재호출에서 저장된 답으로 완료 결과를 낸다(L2.dialog.spec §4.1.2 6번). 대기하는 동안 호출의 `effect.intent`와 `effect.exec`는 커밋되어 있고 `effect.result`는 없다. 한 효과에 provider 호출이 여러 번 있는 셈이다.
  - 대기는 호출 신호를 따른다. turn이 취소되면 그 승인을 `cancelled`로 닫고(§4.7 8번) 호출은 `[aborted]` 중단 결과가 된다. 승인이 이 프로세스의 메모리에 없으면 `[fresnel:approval_unknown]` 오류 결과다.
  - 같은 호출에서 `input_required`를 이어 받는 횟수는 8번까지다. 해결된 승인을 되풀이해 가리키는 도구가 무한히 도는 것을 막고, 넘으면 `[fresnel:input_required_loop]` 오류 결과다.
  - `approvalId`가 없는 변형(L2.mcp의 `inputRequests`와 `requestState`)은 D5(a)대로 어댑터가 질문 승인으로 올린다 [결정: L1F]. 출력이 F `McpInputRequiredSchema`에 맞으면 `planMcpQuestionBody`로 질문 묶음을 만들고 kind `question` 승인을 비차단으로 연다(`ApprovalService.open`). 요청 키는 `mcp:<toolCallId 해시 32자>#r<round>`를 `requestKeyFor`로 줄인 값이라 라운드마다 다른 요청이고, 재시작 뒤 같은 라운드는 기록된 요청을 이어 받는다. 승인과 대기 체크포인트는 한 커밋이다(비대화형이면 요청과 거부 해결이 한 커밋). 해결이 오면 `decodeMcpAnswer`(답)나 `uniformMcpAnswer`(거부는 `decline`, 취소는 `cancel`)로 `inputResponses`를 만들고, 같은 입력과 같은 `requestId`로 메서드를 다시 부르며 `CallOptions.continuation = { round: 이전 라운드 + 1, inputResponses, requestState }`를 싣는다. 구현은 `src/mcp-input.ts`다.
  - 질문이 4개를 넘거나, 사용자 답이 폼에 맞지 않거나(JSON 폼 파싱 실패 등), 승인 요청 커밋이 실패하면 호출은 `[fresnel:input_questions_too_many]`, `[fresnel:input_answer_invalid]`, `[fresnel:input_request_failed]` 오류 결과로 끝난다. `approvalId`도 MCP 모양도 아닌 `status: "input_required"` 출력은 일반 결과로 흘려 보내지 않고 `[fresnel:input_required_invalid]` 오류 결과다.
  - `DirectToolRegistration`(동적 MCP 서버 도구)은 pi `AgentTool.execute` 시그니처에 연속 정보를 실을 자리가 없어, 선택 필드 `executeWithContinuation`으로 같은 길을 쓴다 [결정: 병합 HOST.6]. 이 필드가 있으면 어댑터는 `tool.execute` 대신 이것을 부른다. 결과가 `status: "input_required"`이면 `details.round`, `details.questions`와 `inputRequired`(`inputRequests`, `requestState`)를 `McpInputRequired`로 읽고, 위와 같은 질문 승인과 재호출(`continuation` 인자)을 한다. 읽을 수 없는 모양은 `[fresnel:input_required_invalid]` 오류 결과이고 8라운드 상한도 같다. 구현은 `src/entries.ts`의 `settleDirectInput`과 `src/mcp-input.ts`의 `inputRequestOfResult`다. 필드가 없는 직접 등록 도구는 한 번만 부른다.
  - 재시작 뒤: 대기 체크포인트(`waiting: "approval"`)와 열린 효과가 남는다. `ask_user`는 `replay: "safe"`라 `decideEffectRecovery`가 `rerun`을 내고, `rerun`이 같은 경로로 도구를 다시 부르면 도구는 같은 `requestId`로 기존 승인을 이어 받는다.

### 4.4 효과 기록

[결정] 외부 효과는 의도를 커밋한 뒤 트랜잭션 밖에서 낸다(eng.transactions.design TX-02, `_research/foundation-plan.md` §1 결정 1이 인용한 durable spec 1917-1927).

1. 불변식: 어댑터 `execute`는 그 `toolCallId`의 `effect.intent`가 커밋된 뒤에만 provider를 부른다. core-tools는 의도 커밋 결과(`CommitResult.status: "committed"`)를 대화별 메모리 표에 넣고, `execute`는 이 표에 항목이 없으면 provider를 부르지 않고 `tools.intent_missing` 버그로 끝낸다. 읽기 도구도 같다. 예외를 두지 않는다(eng.transactions.design §5.1 불변식 1).
2. `effect.intent` 필드: `effectId`(IdFactory `efx_`), `toolCallId`, `toolName`, `itemId`(도구 호출 item), `argsHash`(최종 인자 정규화 JSON의 sha256 hex), `args`(256 KiB를 넘으면 `BlobRef`), `replay`(§4.3), `idempotencyKey`(도구가 주면 그 값, 없으면 null). F.records.spec §3.5와 같다.
3. `effect.exec`는 의도와 별도 커밋이다 [제안]. 두 커밋을 나누면 재개 때 "실행 시작 전 중단"(`not_started`)과 "실행 중 중단"(`outcome_unknown`)이 구분된다(F.records.spec §3.5 결정표).
4. `effect.result`와 toolResult `item.recorded`는 한 커밋이다. `effect.result.resultItemId`는 같은 커밋의 item id, `output`은 `{ structuredContent, terminate, status, inputRequired }`, `blobRef`는 경계화로 옮긴 원문(§4.8), `durationMs`는 어댑터가 잰 실행 시간이다.
5. 도구별 커밋: 의도·실행·결과는 도구 호출마다 따로 커밋한다(E1 의도, E2 실행 시작, E3 결과). ADR-0004 §3.2 3번의 보충으로 올리고 단계당 커밋 수는 `3 + 3n`이다 [결정: review.decisions-2 U-10]. eng.transactions.design §4.1 C3은 모델 응답 확정 커밋에 호출마다 의도를 넣는다고 적었지만, 승인 대기(§4.7)가 의도 앞에 오므로 응답 확정 때는 의도를 쓸 수 없다. architecture.runtime-flow.design §4.1 그림도 도구마다 의도를 커밋한다. eng.transactions.design은 이 모양으로 고쳤다(§4.1·TX-08).
6. 커밋은 모두 `fresnel.session`의 커밋 경로(eng.transactions.design TX-07 `SessionWriter.commit`)로 한다. core-tools는 대화 테이블에 직접 쓰지 않는다.

### 4.5 정책 평가

[제안] 규칙은 `{action, resource, effect}`이고 결과 우선은 deny > ask > allow, 관리 설정이 최우선이다(`_research/ref-synthesis.md` L1 코어 (d) 권한, `_research/item-catalog.md` L1-d "선언형 정책 엔진"). 설계는 Gemini CLI 정책 엔진과 opencode `permission.ts`를 참고한다. 두 코드는 가져오지 않는다(`_research/packages.md` §4.3 L1-d). [가정] Gemini 정책 엔진의 내부 결합도는 확인하지 않았다. 규칙 표현만 참고한다.

`evaluatePolicy(input, rules)` 순서 [제안]:

1. 일치 규칙 M = `rules` 중 `action`이 같고 `ruleMatches`가 참인 것.
2. M에 `effect: "deny"`가 하나라도 있으면 deny다. 가장 높은 티어, 그 안에서 가장 큰 priority의 deny 규칙을 `ruleId`로 낸다. 어느 티어의 allow도 deny를 뒤집지 못한다. 그래서 상위 티어 deny는 하위 allow에 지지 않는다.
3. 모드 `bypass`이면: `bypassAllowed`가 거짓이면 모드를 `default`로 보고 계속한다(`reason`에 `bypass_forbidden` 표시). 참이면 allow(`reason: "mode"`)다.
4. M이 비지 않으면 M에서 가장 높은 티어의 규칙만 남긴다. 그 안에서 가장 큰 priority의 규칙만 남긴다. 남은 규칙 중 ask가 있으면 ask, 아니면 allow다(`reason: "rule"`).
5. M이 비면 모드 기본값(§4.6 표)이다(`reason: "mode"`).
6. 결과가 ask이고 `interactive`가 거짓이면 deny(`reason: "noninteractive"`)다.

- 상위 티어 우선(4단계)으로 사용자 규칙이 기본 규칙의 ask를 allow로 풀 수 있고, managed 규칙이 사용자 규칙을 덮는다. deny는 2단계에서 티어와 무관하게 확정된다.

ceiling 단계(파이프라인 5b, 자식 대화) [제안]:

- `ToolRunContext.ceiling`이 있으면 5b의 결정은 `stricter(childDecision(call, parent, child, rules), evaluatePolicy(input, rules))`다. `parent`는 `ToolRunContext.ceiling`, `child`는 자식 관점 입력(caller, depth, 자식 모드)이다. `childDecision`은 부모 관점 평가, 자식 관점 평가, 정의 제한(`ceiling.allow`)을 `stricter`로 합치는 순수 함수다(L1.agents.spec §4.3 1번). F `policy.ts`에 두도록 요청한다(§8.3 F 요청 9, L1.agents.spec §8.3 5와 같은 항목).
- `evaluatePolicy` 자체는 ceiling을 받지 않는다. ceiling 단계는 파이프라인이 평가기 바깥에서 적용한다. 그래서 위 1~6단계의 순수성은 그대로다.
- 읽기 전용 샌드박스 상한 [결정: 2026-11-13 사용자]: `ceiling.sandbox`가 `"read-only"`이고 도구가 `riskUnderReadOnlySandbox`를 선언했으면(대체 항목은 제외) 이 호출의 정책 위험 등급은 그 선언 값이다. 실효 등급이 `read`면 평가기는 `evaluateReadOnlySandboxed`(`policy/engine.ts`)다. 같은 평가기가 `evaluatePolicy`에 내장 기본 규칙(출처 `core:tools`)의 ask를 뺀 규칙을 넣는다. 그래서 `default.bash-ask`가 빠지고, `read`의 모드 기본값은 모든 모드에서 allow다. deny 규칙, managed와 사용자 규칙의 ask, 정의가 더한 규칙은 그대로 평가한다. 부모 관점 평가(`childDecision`의 두 평가)도 같은 평가기를 쓴다. 실효 등급이 `read`가 아니면 등급만 바꾸고 평가기는 `evaluatePolicy` 그대로다.
  - 이 판정이 승인을 건너뛰는 근거는 샌드박스를 쓸 수 없으면 도구가 실행을 거부한다는 구현이다(§3 `CallContext.sandbox`, cap-workspace의 `shell.run`이 판단한다). 이 구현이 없으면 이 절은 적용하지 않는다.
  - 선택 이유: 위험 등급만 `read`로 낮추면 `default.bash-ask`가 여전히 ask를 내고(ask가 이긴다), 그 규칙에 등급 조건을 더하면 샌드박스 밖에서 `read`로 선언한 같은 이름 도구의 승인까지 바뀐다. 그래서 판정 쪽에서 내장 ask만 뺀다.
- 합친 결과가 ask이고 `interactive`가 거짓이면 deny(`reason: "noninteractive"`)다. 6단계와 같은 규칙이다.
- 구현 [결정: L1A.6]: `prepare`는 `ceiling`이 있으면 `stricter(childDecision(evaluatePolicy, input, ceiling, { caller, depth, mode }, rules), evaluatePolicy(input, rules))`를 5b 결정으로 쓴다. `stricter`와 `childDecision`은 F `@fresnel/contracts/services`의 순수 함수이고 core-tools는 사본을 두지 않는다. 자식 관점의 `mode`는 자식 대화의 유효 권한 모드(`l1.tools.permissionMode`, core-agents가 교집합으로 써 둔다)다. 정의의 도구 제한은 `ceiling.allow`가 실행 시점에 거부하고(`agent.<이름>.tools`), 호출자의 `tools.deny`는 `ceiling.deny`가 거부한다(`agent.<이름>.tools.deny`). 두 거부 문장은 `ceiling.denyHint`로 끝난다 [제안: M3-REQ-78]. 정의가 더하는 규칙은 `registerRules("core:agents")`의 default 티어 규칙으로 들어온다.
- 서브에이전트 승인 [결정: L1A.6]: 자식 호출의 승인 요청은 `surfaceThreadId`(소유 트리 루트 대화)에 기록하고 `origin`에 자식 대화·호출·caller를 남긴다. 한 커밋은 한 대화의 것이라 대기 체크포인트는 같은 커밋에 넣지 않는다. 이벤트의 `turnId`·`stepId`는 비운다. 자식 대화는 재개 때 마지막 단계 체크포인트의 `tools` 진입으로 같은 `requestKey` 요청을 다시 내고, 커밋이 `replayed`로 끝나 기록된 요청을 이어 받는다.
- `childDecision`이 F에 들어가기 전에는 ceiling 단계를 켜지 않는다. 그 사이 자식 대화는 M2 착수 조건을 채우지 못한 것으로 본다(L1.tools.plan TL-13 선행).
- `ruleMatches`의 glob은 `*`(구분자 없는 임의 문자열)와 `?`만 쓴다. 정규식은 규칙 적재 때 `validateRules`로 한 번 컴파일해 캐시하고, 잘못된 규칙은 적재하지 않고 진단으로 남긴다. 평가 중에 예외를 던지지 않는다.
- 평가기는 순수 함수다. 시각, 난수, 파일, 설정 읽기를 하지 않는다. 규칙 목록과 모드는 호출자가 넘긴다. 같은 입력이면 같은 결과다(§9 수용 기준).

티어와 규칙 출처 [제안]:

| 티어 | 출처 | 예 |
|---|---|---|
| `default` | core-tools 내장 규칙, L1 패키지가 `registerRules("core:<도메인>", …)`로 넣은 규칙(L1.agents.spec의 자식 차단 규칙) | `default.read-allow`, `subagent.no-spawn` |
| `extension` | 확장이 등록한 규칙(2차: 매니페스트 선언). M2까지는 내장 그룹만 | Helm이 쓰기 금지를 규칙으로 표현할 때 |
| `user` | 설정 `l1.tools.rules`의 `user`, `project`, `local`, `launch` 범위 값 | `{ tool: "bash", args: [{ pointer: "/command", pattern: "^git status( |$)" }], effect: "allow" }`(접두 일치라 `git status && rm x`도 정규식은 통과하지만, 아래 연쇄 규칙이 ask로 낮춘다) |
| `managed` | 설정 `l1.tools.rules`의 `managed` 범위 값 | `{ tool: "*", mcpServer: "untrusted-*", effect: "deny" }` |

- 설정 범위별 규칙 수집 [제안]: F.wire-settings.spec §4.7 규칙 2는 키 하나의 값을 통째로 바꾼다. 정책 규칙은 범위마다 모아야 한다. 그래서 core-tools는 `l1.tools.rules`를 유효 값 하나로 읽지 않고 범위별 층(`ScopeStack`)에서 각각 읽어 티어를 붙인다. 이 읽기 방식을 SettingDef에 표시하는 필드(예: `merge: "collect"`)를 F.wire-settings.spec에 요청한다(§8.3 F 요청 5).
- 코어 규칙 등록 [제안]: L1 패키지는 `ToolService.registerRules(source, rules)`로 default 티어 규칙을 넣는다. `source`는 `core:<도메인>`이고 `TieredRule.source`에 그대로 들어간다. 같은 `source`로 다시 부르면 그 출처의 규칙을 통째로 바꾼다. core-agents는 `l1.agents.maxDepth`가 바뀔 때 차단 규칙을 다시 등록한다. 등록은 `validateRules`를 거치고, 문제가 있는 규칙은 적재하지 않고 `RuleRegistration.issues`로 돌려준다. 규칙 변경은 다음 단계 경계의 `advertise`와 다음 도구 호출 평가부터 적용한다(M2).
- bash 연쇄 규칙: 도구 `bash`의 `/command`를 정규식으로 보는 allow 규칙은 명령에 `;`, `&`, `|`, `<`, `>`, `$(`, 백틱, 개행이 있으면 allow가 아니라 ask로 평가한다(규칙 id와 티어는 그대로, 평가기 `demoteCompound`). 셸 구문을 해석하지 않는 보수적 판정이라 따옴표 안의 `;`도 ask다. deny와 ask 규칙, `/command` 조건이 없는 규칙은 그대로다. 셸 명령 단위 규칙은 §4.11의 2차다.
- 내장 기본 규칙(M1): `default.read-allow`(risk `read` → allow), `default.read-tool-allow`(도구 `read` → allow. 이름만으로 허용하지 않고 기능 `workspace.files`와 risk `read`를 함께 본다. 같은 이름을 등록한 확장 도구는 기능 id가 없고 위험 등급이 exec라 모드 기본값을 따른다), `default.bash-ask`(도구 `bash` → ask. 읽기 전용 샌드박스 상한 아래의 `read` 호출에는 적용하지 않는다, 위 절). 나머지는 모드 기본값을 따른다.
- 확장의 `tool.call.before` 핸들러와 정책 규칙의 관계: 둘 다 거부할 수 있다. 핸들러는 그룹 상태에 따라 바뀌는 동적 판정(예: Helm 확산 단계의 쓰기 거부, L3.helm.spec §4.6)에 쓰고, 규칙은 선언형 정적 판정에 쓴다. 순서는 핸들러(5a) 뒤 정책(5b)이다. 핸들러가 거부하면 정책과 승인을 부르지 않는다. 그래서 사용자는 이미 거부된 호출의 승인 요청을 받지 않는다.

### 4.6 권한 모드와 위험 등급

모드는 세 가지다. 화면(설정 화면, 입력창 칩, 승인 카드)에서 부르는 이름은 `default` 기본(실행마다 묻기), `acceptEdits` 편집 자동 허용, `bypass` 모두 허용이다 [결정: 2026-11-08]. 계획 모드(`plan`)는 없다 [결정: 2026-11-13 사용자] [근거: 2026-11-13 사용자 결정]. 계획은 모델이 글로 쓰고 `ask_user`로 묻는다. 시스템 프롬프트·환경 블록·도구 설명에 계획 모드 안내를 더하지 않는다. 계획 v2 구성요소 표기를 따른다(`_research/layer-plan-v2.json` L1-d "권한 모드").

| 모드 | read | write | exec | 비고 |
|---|---|---|---|---|
| `default` | allow | ask | ask | 기본값 |
| `acceptEdits` | allow | allow | ask | 편집 도구 자동 허용 |
| `bypass` | allow | allow | allow | 규칙 ask도 allow. deny 규칙은 남는다. managed가 `l1.tools.bypassAllowed = false`로 금지할 수 있다 |

- 위험 등급 [제안]: 도구가 등급을 선언하고 선언이 없으면 가장 위험한 쪽을 쓴다(`_research/item-catalog.md` L1-d "위험 등급과 승인 필요 선언", omp 미선언 시 exec). 등급과 재생 선언은 도구 등록 필드로 받는다. 미선언 등급은 `exec`, 미선언 재생은 `unsafe`다.
- 등급 유도 [제안]: `ToolPolicyMeta.risk`가 있으면 그 값이다. 없으면 `hints.readOnly === true`면 `read`, 그 밖은 `exec`다. MCP annotation(`readOnlyHint` 등)은 `hints`로 들어오는 입력일 뿐이다. annotation이 `destructiveHint: false`라도 등급을 `write`로 낮추지 않는다. 신뢰할 수 없는 서버의 선언이기 때문이다.
- 위험 등급은 F `ToolSpec`에 필드가 없다. F.capabilities.spec에 `risk?: ToolRisk`, `classes?: ToolClass[]` 추가를 요청한다(§8.3 F 요청 1). 추가 전에는 `CapabilityToolsRegistration.policy`로 받는다.
- 권한 모드는 대화 범위 설정 `l1.tools.permissionMode`의 유효 값이다. 우선순위는 managed > launch > profile > local > project > user다(M5c §3.3, 프로필 범위는 대화가 참조한 프로필의 `settings` 값). 모드 변경은 다음 도구 호출부터 적용한다(`runtimeChange: "live"`). 이미 승인 대기 중인 요청은 모드가 바뀌어도 그대로 둔다.
- 옛 `plan` 값 [결정: 2026-11-13 사용자, 옛 대화 보호. 읽기 규칙 정리 2026-11-15 사용자]: 계획 모드 시절에 저장된 대화·설정의 `l1.tools.permissionMode` 값이 문자열 `"plan"`이면 `default`로 읽는다. 저장된 문자열은 바꾸지 않는다. 이 읽기는 `core-tools/src/settings.ts`의 `normalizeStoredMode` 한 곳에 있고, 엔진(`pickMode`)이 그 함수를 쓴다. `"plan"` 층에서 멈추고 아래 층으로 넘어가지 않는다. 설정 값 검사(`validateSettingValue`)는 `plan`을 거부하므로 새로 쓸 수 없다.
  - 설정 읽기(`settings.get`)도 엔진과 같은 `default`를 보여야 한다 [결정: 2026-11-15 사용자]. `resolveSetting`(F wire-settings)은 값 검사에 걸리는 층을 건너뛰므로, `settings.get`은 옛 `plan` 층을 건너뛰고 아래 층의 값을 보인다. 정의에는 값 정규화 훅이 없다. 그래서 `settings.get`을 만드는 host 층이 `resolveSetting`에 넘기기 전에 `normalizeStoredMode`를 거쳐야 한다 [미결: host 층에서 할 것. L4.host-service 범위라 이 층에서 고치지 않았다]. 그 전까지 화면과 엔진이 다른 값을 보일 수 있다. [근거: packages/contracts/src/wire-settings/settings/effective.ts resolveSetting]
  - 사용자 정책 규칙의 `resource.mode`에 든 `"plan"`은 그 항목만 뺀다(`policy/rules.ts` `withoutRetiredModes`). 목록이 비면 그 규칙만 건너뛴다. 빈 목록은 모든 모드에 적용되는 규칙이라 그렇게 두지 않는다. 건너뛰면 진단 하나를 남긴다(`collectRules`의 issues) [결정: 2026-11-15 사용자]. 계약은 읽기에서만 `plan`을 받는다(`RetiredPermissionMode`).
  - 에이전트 정의의 `permissions.mode: plan`은 모드 칸만 무시한다(L1.agents.spec §4.9) [결정: 2026-11-15 사용자].
- 새 대화의 기본 모드는 `bypass`다 [결정: 2026-11-13 사용자]("에이전트에게 자유로운 권한을 주는 것을 기본값으로"). 설정 기본값만 바뀐다: 이미 저장된 대화의 모드(대화 범위 값)와 managed의 `l1.tools.bypassAllowed = false`는 그대로이고, 금지되면 평가기가 `default`로 본다(3단계). 기본값을 물려받아 넓어지는 곳은 사람이 없는 실행이다: 예약 실행(L2.schedule)과 헤드리스 CLI의 새 대화는 설정의 기본 모드를 따르므로 비대화형이라도 규칙이 정하지 않은 호출이 ask가 아니라 allow다(6단계의 ask→deny는 ask가 있을 때만 일어난다). 서브에이전트는 부모 모드를 `childMode`로 이어받는다(더 느슨해지지 않는다). deny 규칙은 모드와 무관하게 막는다.
- "실행 허가" 승인의 덮기 [결정: 2026-11-13 사용자]: 정책 단계 밖에서 따로 묻던 승인 중 실행 허가 성격의 것은 `ToolService.coversRunApprovals(threadId)`를 묻기 전에 부른다. 이 판정은 대화의 모드가 `bypass`이고 `bypassAllowed`가 거짓이 아니며 그 모드가 저장소 범위(`project`, `local`)에서 온 값이 아닐 때만 참이며(`modeCoversRunApprovals`), `bypass` 문자열 비교는 정책 평가기와 이 함수에만 둔다. 덮는 승인: 웹 도메인 확인(`policy_ask`)과 처음 보는 URL(`unseen_url`)(`L2.web.spec` §4.5.3, §4.6.6), 브라우저 동작 확인(`L2.web.spec` §4.10.3). 덮지 않는 승인(질문 자체가 목적이거나 사용자의 내용 판단이 필요하다): `ask_user`, 학습 제안, 메모리·스킬 쓰기, 확장 화면의 승인 요청(`requestApproval`)·`loop.ask`, MCP 서버가 묻는 질문(elicitation), 리뷰 카드, 도구 대체 승인(§4.13). 시크릿 사용 승인(§4.12), 폴더 신뢰, 시크릿 패턴이 든 URL의 웹 질문(`secret_pattern`)은 이 판정을 쓰지 않아 모드와 무관하게 묻는다. 정책의 deny 규칙, 도메인 deny와 `unseenUrl = deny` 설정도 그대로 막는다.
- 비대화형 실행: [제안] 비대화형 실행에서 ask는 deny로 해석한다(`_research/item-catalog.md` L1-d "권한 모드"). `ToolRunContext.interactive`는 turn을 시작한 쪽이 정한다 [제안]. 사용자 입력 turn(`turn.start`)은 대화형, 예약 실행(L2.schedule)과 헤드리스 CLI 실행은 비대화형이다. drive와 위임 turn은 부모 대화를 따른다.
- 보류 [제안: 카탈로그 "보류" 표기를 따른다]: 자동 분류 모드(별도 모델이 ask를 판정)와 자동 승인 리뷰어·연속 거부 서킷브레이커(`_research/item-catalog.md` L1-d, 진보된 설계 3·4번)는 이 문서 범위 밖이다. 도입하면 리뷰어 장애 시 거부하는 쪽으로 설계한다. 모델 자가 위험도(OpenHands `security_risk`)는 정책 입력의 하나로만 검토한다.

#### 4.6.1 초안 출신 호출 [결정: 2026-11-17 사용자, U2. 테스트 실행의 `auto`는 [결정: 2026-11-18 사용자, AGE-56]]

검토되지 않은 플러그인 초안(덧씌우기 또는 시험 실행)에서 나온 도구 호출은 모드, 규칙, 위험 등급과 무관하게 항상 묻고, 카드에 "초안" 표지를 단다. 단, 테스트 실행의 드래프트 승인이 `auto`인 대화(와 그 서브에이전트 자식 대화)에서는 "드래프트라서 묻는" 판정(3번)과 승인 상속 금지(4번)를 건너뛴다(`[결정: 2026-11-18, 사용자, AGE-56]`). 그 대화의 드래프트 호출은 모드, 규칙, 위험 등급, 비대화형 거부, 가드 Hook을 일반 대화와 같게 받되, 권한 모드와 내장 기본 규칙이 낸 ask는 허용으로 바뀐다(3b번, 완전 자율, `[결정: 2026-11-19, 사용자, AGE-56]`). 이것은 "항상"을 호출한 대화 단위로 좁히는 것이고, 등록 범위의 표지는 그대로다. `auto`는 화면(통신을 부르는 쪽)만 고른다. 모델, 플러그인, 드래프트는 이 값을 정하지 못한다.

1. 표지 [제안]: `DraftMark = { plugin: string; draftId: string }`(`@fresnel/contracts/services`, 프로필 덧씌우기 `overlay`의 `plugin`·`draftId`와 같은 값)다. 준비 때 호출마다 한 번 정한다. 플러그인 기능 호출(`executeForPlugin`)은 호출한 플러그인의 `plugin.scopeId`를 먼저 보고, 없으면 도구 항목의 `owner`(등록 스코프)를 본다. 모델이 부른 도구 호출은 `owner`만 본다. 같은 값으로 `draft`가 정해지면 그 호출은 초안 출신이다.
2. 주입 의존 [제안]: `ToolsDeps.draftOf?: (scopeId: RegistrationId) => DraftMark | undefined`(core-tools `deps.ts`). 조립 루트가 `ToolsPluginOptions.draftOf`로 넘긴다. 초안 목록(덧씌우기, 시험 실행)은 L1이 모르고 조립 루트가 안다. 넘기지 않으면 초안 호출이 없다. 도구 항목에는 등록 스코프 `ToolEntry.owner`가 붙는다(`resourceEntry`, 플러그인 등록 도구만).
3. 판정 [결정: 2026-11-17 사용자, U2]: 5b의 결정(ceiling을 합친 뒤)에 `evaluateDraft(decision, input)`을 한 번 건다. deny는 그대로다(deny 규칙과 모드의 deny). 그 밖의 결정(bypass의 allow, allow 규칙, 위험 등급의 allow)은 모두 ask가 되고 사유는 `draft`다(`DecisionReason`에 더했다 [제안]). 그다음 6단계대로 비대화형이면 deny(`noninteractive`)다. 허용으로 넘어가는 경로는 없다. 단, 호출한 대화가 드래프트 승인 `auto`인 테스트 실행이면 이 판정을 건너뛴다(`[결정: 2026-11-18, 사용자, AGE-56]`). 그 호출은 모드, 규칙, 위험 등급의 결정을 일반 대화와 같게 따른다. 모드가 물은 호출은 3b번이 허용으로 바꾸므로 카드가 없다(2026-11-18의 "모드가 물은 호출은 카드가 뜬다"를 2026-11-19 결정이 바꿨다). 판정 대화는 `ToolsDeps.draftAutoApproved(threadId)`가 정하며, 등록 범위의 표지로 정하지 않는다 [제안].
3b. 완전 자율 [결정: 2026-11-19, 사용자, AGE-56 "2-나". 범위의 한계 줄은 [제안]]: 호출한 대화가 드래프트 승인 `auto`인 테스트 런(과 그 자식 대화)이면 5b 판정(자식 천장을 합친 결정)이 ask일 때 허용으로 바꾼다. 드래프트의 호출이든 승인본의 호출이든 그 대화 안의 모든 호출이 같다. 허용으로 바뀌는 것은 사유가 권한 모드나 내장 기본 규칙(`default` 티어)인 ask뿐이다. 그대로 남는 것: (a) 거부 규칙과 모드의 deny, (b) `tool.call.before` Hook의 막기와 Hook이 낸 묻기(가드 플러그인의 묻기는 사용자가 만든 안전장치라서 `auto`가 넘지 않는다 [제안: 사용자가 "모드의 카드"라고 말했다]), (c) 읽기 전용 샌드박스와 자식 천장 같은 다른 평가기의 deny, (d) 관리(`managed`) 범위가 권한 모드를 정했거나 bypass를 금지했을 때의 ask(관리 설정이 이긴다, `ToolsScalarConfig.managedRestricts`), (e) 사용자·확장 티어 규칙이 낸 ask(사용자가 일부러 "묻기"로 적은 규칙이다 [제안]), (f) 내장 도구 대체 항목의 ask(§4.13), (g) 사람이 답할 수 없는 대화의 비대화형 거부, (h) 일반 대화와 형제 테스트 런(판정은 `deps.draftAutoApproved(threadId)`가 대화마다 정한다). 허용으로 바뀐 호출은 승인 기록이 없고(`userApprovalId`를 채우지 않아 시크릿 사용 증거가 되지 않는다) 호출 기록의 `policy`가 `{ effect: "allow", tier: "auto_test_run" }`이다("auto 테스트 런이라 묻지 않고 허용함"을 읽는 자리, 기존 필드 사용). 샌드박스의 쓰기 범위는 `auto`와 무관하게 그대로다(`auto`는 묻는 카드를 없앨 뿐 샌드박스를 넓히지 않는다).
4. 상속 금지: 초안 출신 호출은 `inheritApproval`, 바깥 호출의 승인 상속, 사람의 결정 허용(`withHumanDecision`)을 쓰지 않는다. 승인 상속을 찾는 단계를 건너뛰어 카드를 건너뛰지 못하게 닫는다. 단, 드래프트 승인 `auto`인 대화의 드래프트 호출은 이 금지를 받지 않는다(`[결정: 2026-11-18, 사용자, AGE-56]`). 상속의 나머지 조건(위험 등급이 바깥 승인 이하, 한 번만 씀, 경로 대조)은 일반 대화와 같다.
5. 카드 [제안]: 도구 승인 본문 `ToolApprovalBody.draft?: DraftMark`에 표지를 싣는다. 기록 스키마(`approval.requested`의 `ToolApprovalDetail`)도 같은 선택 필드를 받는다. 제목 앞에 `Draft plugin "<확장 이름>" asks.`를 둔다. `ruleId`는 `null`이다(초안이 물은 것이라 규칙이 아니다). 같은 호출의 시크릿 사용 승인 카드도 표지를 싣는다. 화면은 `draft`가 있으면 "초안" 표시를 단다.
6. 무인 [결정: D-M3-12를 따른다]: 답할 사람이 없고 무인 정책이 `deny`면 묻지 않고 거부한다(`noninteractive_ask_denied`). `expire`와 `wait`에서는 5번 카드로 기다린다(§4.7 6c). 드래프트 승인 `auto`인 대화의 드래프트 호출은 3번이 건너뛰어지므로 이 무인 정책을 일반 대화와 같게 받는다(모드가 물은 호출만 해당, `[결정: 2026-11-18, 사용자, AGE-56]`).
6b. 가벼운 길 닫기 [결정: 2026-11-17 사용자, U2, 구현: enB5]: 도구 매핑이 없는 `readOnly` 기능 메서드는 검토된 플러그인에는 파이프라인 항목이 없어(합성 항목은 `readOnly`가 아닌 메서드뿐) 가벼운 길로 가지만, 초안 출신 호출은 이 길을 타지 못한다. `ToolsPort.isDraftScope?(scopeId)`(`deps.draftOf`로 답한다)를 기능 래퍼(`routeOf`)가 묻고, 초안이면 파이프라인으로 보낸다. 그 호출을 위해 합성 항목은 `readOnly` 메서드에도 만들어지고(초안 호출자에게만) 위험 등급은 메서드의 `risk`, 없으면 `read`다. 3번의 판정이 그 호출을 ask로 바꾼다. 물을 대화나 호출 식별이 없어 파이프라인으로 갈 수 없는 초안 호출은 직접 부르지 않고 `effect_not_allowed`로 거부한다. 카드가 한 번 뜰 때마다 호출 하나이고 기억 범위는 `once`뿐이라(§4.7 6) 초안이 읽기 호출을 턴마다 n번 하면 턴마다 카드가 n번 뜬다. 드래프트 승인 `auto`인 대화에서도 초안 호출은 이 파이프라인 길로 가고, 판정만 일반 정책 경로(3번의 건너뜀)를 따른다. 그래서 deny 규칙과 가드 Hook은 그대로 막고, 허용 판정은 카드 없이 돈다(`[결정: 2026-11-18, 사용자, AGE-56]`).
6c. 초안 스크립트 실행 [제안, 2026-11-19, AGE-58. 카드를 덜 묻는 것은 [결정: 2026-11-19, 사용자, AGE-58 "웬만하면 자동 승인"]]: 플러그인 호출 대상에 `{ kind: "script", name, memoryKey?, run }`을 더했다(`PluginCallTarget`). 도구 실행 블록이 합성 항목 `script_<이름>`(위험 등급 `exec`, 모델에 광고하지 않음, 레지스트리 밖)을 만들고, 입력은 카드가 보여 줄 값 `{ command, args, envNames, stdinBytes, stdinPreview }`이다. 같은 순서(`tool.call.before`, 정책, 승인, `guard.tool.before`, 의도, 실행)를 지나고 승인된 호출만 `run`을 부른다. 초안 출신 호출에만 열린다(검토된 호출은 `unavailable`). 카드가 뜨는 때: (가) 드래프트 승인 `auto`인 테스트 런(과 자식 대화)에서는 카드가 없다(3b번이 모드의 ask를 허용으로 바꾸고, 호출 기록의 `policy.tier`는 `auto_test_run`이다). (나) 그 밖의 테스트 런에서는 스크립트마다 처음 한 번만 묻는다: 카드는 `ruleId = SCRIPT_RUN_RULE_PREFIX + memoryKey`와 기억 범위 `thread` 하나("이 테스트 런 동안 다시 묻지 않아요")를 낸다. 응답이 범위를 생략하면 그 하나로 본다. 승인하면 이 대화와 이 대화를 띄운 부모 대화의 승인 기록(`ApprovalService.remembered`)에 남아, 같은 `memoryKey`의 호출은 카드 없이 돈다(호출 기록 `policy.tier`는 `script_remembered`, 거부 규칙·Hook·관리 설정은 그대로 평가한다). `memoryKey`는 호출하는 쪽(호스트의 `createScriptDraftGate`)이 초안의 내용 해시, 스크립트 이름, 프로세스 시작마다 새로 나는 값으로 만든다: 내용이 바뀌면 다시 묻고, 거절한 카드와 키가 없는 호출(`once`)은 기억하지 않으며, 다른 대화·형제 테스트 런·일반 대화로 번지지 않는다. 프로세스를 다시 시작하면 시작 값이 달라져 같은 테스트 런이 되살아나도 다시 묻는다(가장 보수적인 쪽 [제안]). 승인 상속은 받지 않는다. 거부 규칙과 훅의 막기는 그대로 막고, 답할 사람이 없으면 거부한다(6번). 호출자가 주는 `requestId`는 호출마다 새로 나는 값이다(같은 값은 기록된 결과를 돌려주고 다시 돌지 않는다).
7. 범위 밖 [미결]: 등록 때 올라가는 내장 도구 대체 승인(`tool_replace`, §4.13)과 초안 도구 실행 안에서 낸 질문 승인(`approvals.request`의 question)은 호출의 도구 카드가 아니라 이 규칙 밖이다. 표지를 어떻게 싣을지는 정하지 않았다.

### 4.7 승인 프로토콜

[결정] 도구 승인과 사용자 질문은 하나의 대기 형식으로 처리하고 대기 상태는 L1-f에 저장한다(`_research/layer-plan-v2.json` L1-d "승인과 질문 프로토콜", `_research/foundation-plan.md` §1 결정 5).

흐름:

1. 요청자: 도구 승인은 core-tools 파이프라인(§4.2 5c)이 낸다. 질문 승인은 L2 dialog 기능이 자기 도구의 실행 안에서 `fresnel.approvals.request`를 부른다(eng.context-map.design §4.4 표 3행).
2. 커밋: `request`는 한 커밋에 `approval.requested`와 `checkpoint.step`(`ToolRunContext.drafts.waitingCheckpoint`, `next: "await_input"`(L1.loop.spec §4.5 재진입 표), 해당 호출의 `pendingToolCalls[].waiting = "approval"`)을 쓴다. requestId는 §3.9 표다. 커밋 뒤 `thread.prompt.before`를 발화한다.
   - L2가 낸 요청은 `origin.toolCallId`로 core-tools의 활성 호출 표에서 그 호출의 `ToolRunContext`를 찾아 체크포인트 초안을 만든다. 도구 승인은 의도 전이라 `pendingToolCalls[].effectId`가 null이고, 도구 실행 안에서 낸 질문 요청은 그 호출의 `effect.intent`의 `effectId`를 싣는다. `waiting`은 모두 `"approval"`이다(저장소의 A1 예외가 이 값만 받는다). 활성 호출이 없는 요청(그룹 코드가 턴 밖에서 낸 요청)은 체크포인트 없이 이벤트만 쓴다.
3. 대기: 메모리 대기 목록에 넣고 응답을 기다린다. 대기 중에 도는 프로세스는 없다(architecture.runtime-flow.design §4.5).
4. 응답: `respond`가 kind별 규칙(§3.6 표)을 검사하고 `approval.resolved`를 커밋한다. 커밋 뒤 대기를 풀고 `thread.prompt.after`를 발화한다. 같은 `approvalId`의 두 번째 응답은 `applied: false`다.
5. 결과 반영:
   - tool: allow → 파이프라인 6단계로 간다. deny → `{ block: true, reason }`. 사유 문장은 같은 파일의 다른 거부 사유처럼 영어 `"The user denied this tool call."`이고 feedback이 있으면 `" Feedback: <feedback>"`를 붙인다(엔진 문자열은 로케일을 따르지 않으므로 영어 CLI 출력에 한국어가 섞이지 않게 한다). 모델이 코드를 그대로 읊지 않도록 글에는 코드를 넣지 않고, 결과의 구조 필드 `details: { code: "denied_by_user" }`에만 둔다(화면이 이 필드로 "거부함"을 알아본다). 취소·만료·대화형이 아닌 실행의 거부는 글머리의 `[fresnel:<코드>]`가 그대로다. 사용자 거부의 공통 결과 한 곳(`approvals/protocol.ts`의 `denialReason`·`denialDetails`)에서 만든다 [결정: 오케스트레이터 기본값, fxMC2].
   - plan(옛 기록): 새로 만들지 않는다. 열 때 대기 목록에 올리지 않고 아무것도 쓰지 않는다(9번).
   - question: `QuestionAnswer`를 질문 도구에 돌려준다. 결과 문장은 L2.dialog.spec이 정한다.
6. 기억 범위:
   - `once`: 이번 호출만.
   - `thread`: 같은 소유 트리 루트 대화가 끝날 때까지 같은 도구·같은 `ruleId`(규칙이 낸 ask) 또는 같은 도구(모드가 낸 ask)의 ask를 allow로 본다. 저장은 `approval.resolved` 이벤트 자체다. core-tools는 재개 때 이 이벤트에서 대화 허용 목록을 다시 만든다.
   - `thread`·`always`: M4의 승인 기억은 요청 단위뿐이라 도구 승인(`remember`는 `["once"]`)도 어댑터 요청도 제안하지 않는다 [결정: 2026-10-31 사용자, 점검 2026-11-04]. `open`·`request`는 `once` 하나가 아닌 목록을 `approvals.request_invalid`로 거절하고, 응답이 `once` 밖이면 `answer_invalid`이며 요청은 대기 그대로다. 같은 도구의 다음 ask는 다시 묻는다(대화 단위 허용 목록 `isRemembered`는 없앴다). 예외 [결정: 2026-11-13 사용자]: 샌드박스 밖 쓰기 허용 승인(`ruleId: "sandbox.write_access"`, L2.workspace.spec §4.3.1)만 `remember: ["once", "thread"]`를 낸다. 이 규칙에서 허용+`thread`는 그 대화(와 하위 대화)에서 이후 이 규칙의 질문을 건너뛴다. `ApprovalService.remembered(threadId, ruleId)`가 `approval.resolved` 기록에서 읽는다(재시작 뒤에도 같다). 다른 규칙이 `thread`를 내면 요청이 거절된다(`approvals.request_invalid`). 예외 2 [결정: 2026-11-15 사용자]: 웹 접근 승인(`ruleId: "web.access"`, L2.web.spec §4.5.5)은 `remember: ["once", "always", "thread"]`를 이 순서로 낸다. 이 규칙에서 기억 범위는 도메인 정책 설정에 쓰는 선택이다: `always` = 이 사이트 계속 허용, `thread` = 모든 사이트 허용(이름과 달리 그 대화에 묶이지 않는다). 설정 쓰기는 cap-web이 허용 응답을 받은 뒤 한다. 승인 서비스는 이 두 값을 해결 기록에 남길 뿐 `remembered`로 읽지 않는다. 시크릿 의심 질문처럼 기억을 허용하지 않는 질문은 이 규칙이라도 `["once"]`만 낸다. 그 밖의 규칙이 `thread`·`always`를 내면 요청이 거절된다(`approvals.request_invalid`). 영구 허용은 사용자 범위 규칙 `l1.tools.rules`의 allow 규칙을 쓴다. 저장된 `approval.requested`·`approval.resolved` 사건의 `thread`·`always` 값은 스키마가 그대로 읽는다(저장 문자열은 바꾸지 않는다).
6b. 만료 [결정: M3-REQ-72, M3-06]: 요청의 `expiresAt`(epoch ms)과 `onExpire`는 `approval.requested`에 기록한다. 주입한 `Scheduler`(없으면 `setTimeout` 기반 대체 `systemScheduler`. 타이머가 없어 무인 turn이 영원히 기다리는 일을 막는다)가 `expiresAt`에 깨어 `expiresAt <= clock.now()`이면 `onExpire`대로 `approval.resolved`를 커밋한다: `deny`(기본) 또는 요청 kind가 받아들이는 `answer`(맞지 않으면 deny). 해결에는 `resolvedBy: "expired"`가 붙고 거부 사유 문장은 `[fresnel:approval_expired] …`다. 타이머가 시계보다 일찍 깨면 다시 걸 뿐이다. 응답이 `expiresAt` 뒤에 오면 만료가 먼저라 `already_resolved`다. 재시작 때 `restore`와 같은 `requestKey`의 `open`은 기록된 `expiresAt`을 쓴다: 지난 요청은 바로 해결하고 남은 요청은 처음부터 다시 재지 않는다. 만료 커밋이 실패하거나 던지면 대기로 되돌리고 5초 뒤 다시 시도한다. 만료 시각이 지난 요청은 만료 커밋이 실패해 아직 대기여도 응답을 받지 않는다(`already_resolved`, 만료를 다시 시도한다).
6c. 무인 정책 [결정: D-M3-12, M3-REQ-73. 키 이름과 기본 제한 시간은 제안]: 사람이 답할 수 없는(`interactive: false`) **주 대화**(`caller: "main"`, `depth: 0`, 표면 대화가 자기 자신) turn의 승인은 설정 `l1.tools.unattended.approval`을 따른다. `expire`(기본)는 기다리다 `l1.tools.unattended.timeoutSeconds`(기본 3600 [제안])가 지나면 6b로 거부한다(요청에 `expiresAt`이 이미 있으면 그 값이 먼저다). `wait`는 만료 없이 기다린다. `deny`는 7번처럼 바로 거부한다. 정책 평가는 `wait`·`expire`일 때 ask를 거부로 바꾸지 않고 승인 요청으로 보낸다(`interactive` 입력 = `run.interactive || 기다리는 정책`). 서브에이전트 등 주 대화가 아닌 호출은 정책과 관계없이 7번대로 바로 거부한다. print 모드는 사용자 입력이라 대화형이므로 이 정책 밖이다(사전 허용 규칙 적용과 전체 자동 승인 플래그는 L4 몫, D-M3-14).
7. 비대화형(무인 정책 `deny`이거나 주 대화가 아닌 호출): 정책이 낸 도구 승인은 정책이 이미 deny로 바꾸므로 요청이 나가지 않는다(§4.5 6단계). 정책을 지나지 않는 요청은 kind와 관계없이 사람이 없다 [근거: packages/core-tools/src/approvals/service.ts open]: 정책이 허용한 뒤 파이프라인이 다시 묻는 시크릿 사용 승인(§4.12)과 기능 서비스가 올리는 도구 승인(웹 도메인 승인 등)이 그렇다. 이 요청과 question 요청은 `approval.requested`와 `approval.resolved{ decision: "deny", resolvedBy: "noninteractive" }`를 한 커밋에 쓰고 바로 deny를 돌려준다. 감사 기록을 남기기 위해서다. 이 커밋에는 대기 체크포인트와 `ui_prompt` 발화가 없다. 비대화형인지는 요청의 `origin`으로 찾은 활성 호출의 `ToolRunContext.interactive`로 본다. 활성 호출이 없는 요청(턴 밖의 그룹 코드)은 대화형으로 본다.
8. 취소: 턴 취소(eng.transactions.design §6.2)는 그 턴의 미해결 요청을 `resolvedBy: "cancelled"`로 닫는다. 대기 중이던 도구 호출은 의도가 없으므로 실행되지 않고, 루프는 `not_executed` 합성 결과로 닫는다.
   - 살아 있는 호출이 기다리는 요청은 파이프라인(`decide`)과 어댑터(`input_required` 대기)가 신호가 끊길 때 닫는다. 프로세스가 끊긴 뒤 남은 요청은 호출이 없다. core-loop가 열린 turn을 닫을 때(`closeOpenTurn`) `ApprovalService.restore`로 미해결 요청을 읽어 그 turn의 것을 `cancel`로 닫는다.
9. 옛 계획 승인의 건너뜀 [결정: 2026-11-13 사용자 폐지, 2026-11-15 사용자 정리]: 계획 승인은 더는 만들지 않는다. 요청 종류에 `plan`이 없어 `request`·`open`으로 만들 수 없다. 열 때(`restore`) 옛 `plan` 요청은 `approval.requested` 기록에 있어도 대기 목록에 올리지 않고 건너뛴다. 쓰기도 없다. 그래서 정착 커밋(`resolvedBy: "cancelled"`)도 없고, 이미 해결된 옛 `plan` 기록도 그냥 지나간다. 옛 body는 kind만 읽는다(`approvalBodyOf`가 `undefined`를 돌려준다). 응답을 받지 않으므로 그 id로 `respond`하면 `unknown_approval`이다. 옛 대화가 닫힐 때 `restore`가 이 요청을 찾지 못하므로 해결 기록 없이 남는다. 화면과 대기는 이 기록에 기대지 않아 실행에는 영향이 없다 [제안]. 모드를 쓰는 경로는 없다. [근거: packages/core-tools/src/approvals/pending.ts approvalBodyOf, packages/core-tools/src/approvals/service.ts restore]
10. 메모리 표의 크기 [결정: 통합 검토 L7]: 해결된 요청은 `RESOLVED_KEPT`(256)개까지만 `byId`·`byKey`에 남기고, 넘으면 가장 먼저 해결된 요청부터 뺀다(FIFO). 대기 중인 요청은 해결되기 전이라 표에 오르지 않으므로 빼지 않는다(해결된 요청의 대기자는 해결 때 모두 깨워 비우고 새 대기자는 즉시 해결을 받으므로, 해결된 요청에 대기자가 남아 빼기를 막는 경우는 없다) [결정: 통합 검토 L7 후속 N-6]. 빠진 요청도 이벤트는 남아 있다. 같은 `requestKey`의 `open`은 커밋 키로 기록된 요청을 되찾고 저장된 해결을 이어 받는다(`replayed`, 같은 `approvalId`, 새 이벤트 없음). 빠진 `approvalId`로 `get`은 `undefined`, `wait`은 `unknown`이고 `respond`는 적용하지 않는다. 대화 허용 목록(`remember: "thread"`)은 이 표와 따로 둔다.

#### 4.7.1 사람에게 묻기 훅 [결정: 2026-11-16 사용자, M5e 결정 A. 발화 세부는 M5e 스펙 §4.3.1·§4.3.2]

두 훅은 승인 서비스(`core-tools/src/approvals/service.ts`)가 발화한다. 이름과 payload 모양은 `contracts/src/extensions/hooks/ask.ts`가 정한다.

- `ask.human.before`(first, 실패는 열린 실패). 발화: `open`이 새 요청을 만들 때, `approval.requested`를 커밋하기 전. 같은 `requestKey`의 요청이 메모리 표에 있으면(`known`) 발화하지 않는다. 복원된 요청(`restore`)에도 발화하지 않는다(M5e E-7). 범위는 모든 kind(`tool`, `question`, `review`)다. 결정은 둘이다.
  - `{ cancel: true, reason }`: 모든 kind에서 허용한다. 카드 없이 해결한다. `decision: "deny"`, `resolvedBy: "extension"`, `resolvedByExtension: <확장 이름>`이다. 모델에 보이는 거부 문장은 `[fresnel:denied_by_extension] An extension cancelled this approval request.`다. 사유는 기록에 남지 않는다(§10).
  - `{ answer, reason }`: `question`에서만 허용한다. 답이 질문 묶음 검사(§3.6 응답 규칙)를 통과하면 카드 없이 `decision: "answer"`로 해결하고 `resolvedBy: "extension"`이다. `tool`과 `review`에서 받은 `answer`는 무시하고 진단 `tools.ask_human_answer_ignored`를 남긴다. 승인은 권한이라서 훅이 대신 줄 수 없다(M5e H-1).
  - 결정이 없거나, 핸들러가 예외를 던지거나, 시간 초과이거나, 스키마에 맞지 않으면 결정 없음으로 보고 사람에게 묻는다(M5e E-3). 그 뒤에는 무인 정책이 이어진다.
  - 카드 없이 해결한 요청은 `approval.requested`와 `approval.resolved`를 한 커밋에 쓴다. 대기 체크포인트와 `ui_prompt` 발화는 쓰지 않는다(§4.7 7번과 같은 모양이다).
- `ask.human.after`(tap, 실패는 열린 실패). 발화: 이 프로세스가 해결을 새로 커밋한 뒤 한 번이다. 대화형 카드를 닫는 커밋(`prompt(end)` 자리, 4번)과 카드 없이 해결한 커밋 둘 다 해당한다. 복원된 해결에는 발화하지 않는다. 결정은 받지 않는다(값을 바꾸면 사용자의 답을 위조하게 된다). payload의 `resolution`은 `decision`, `resolvedBy`, `resolvedByExtension`, `answer`를 싣는다.
- 해결 기록: `approval.resolved`의 `resolvedBy`에 `"extension"`이 더해지고 `resolvedByExtension`이 그 확장 이름이다(§3.6). 카드 본문 `ToolApprovalBody.askedBy`는 §4.2.1의 묻기 카드에만 있다.
- `thread.prompt.before`와 `thread.prompt.after`(§7 표)는 대신하지 않는다. 화면이 카드를 띄우고 닫은 신호로 남는다(M5e §4.3.2).

내구화와 재개:

- [제안] 대기 상태는 `StepCheckpoint.pendingToolCalls[].waiting`으로 내구화하고 재개 때 복원한다(F.records.spec §3.6, architecture.runtime-flow.design §4.5, durable spec 1898-1915).
- 재개 절차 [제안]: L1.persistence.spec의 재개가 마지막 체크포인트에서 `waiting: "approval"`인 호출을 찾으면 `ApprovalService.restore(threadId)`를 부른다. `restore`는 `approval.resolved`가 없는 `approval.requested`를 다시 읽어 메모리 대기 목록에 넣는다. core-loop는 `runTurn({ kind: "tools", awaitInput: true })`에서 그 호출들에 `prepare`를 다시 부른다(§3.3, L1.loop.spec §4.5 `await_input` 행).
- 이 재실행은 같은 파이프라인을 지난다. `tool.call.before` 핸들러와 정책은 다시 실행된다. 의도 전이므로 다시 실행해도 된다(F.extensions.spec §4.3 재생 계약). 승인 단계에서 같은 `requestKey`(toolCallId)로 `request`를 부르면 커밋이 `replayed`로 끝나고 같은 `approvalId`의 기존 요청을 기다린다. 그 사이 응답이 커밋되었으면 바로 그 결과를 쓴다. 그래서 강제 종료 뒤 재개하면 같은 승인 요청이 복원된다(§9).
- 질문 도구는 실행(8단계) 안에서 대기하므로 대기 전에 의도와 실행 표시가 이미 커밋되어 있다. 그래서 질문 도구는 `replay: "safe"`를 선언해야 한다 [제안]. 재개 때 `decideEffectRecovery`가 `rerun`을 내고, 다시 실행된 도구가 같은 `requestKey`로 같은 요청을 이어 기다린다. L2.dialog.spec·L2.work.spec에 이 선언을 요청한다(§8.4).
- 서비스 모드 유휴 종료에서 승인 대기 대화를 live로 셀지는 architecture.runtime-flow.design §7 [미결]을 따른다. 이 문서는 정하지 않는다(§10).

#### 동의 표시 요건

승인 카드(`approval.requested`를 받아 `approval.respond`를 보내는 클라이언트 화면. L4 CLI와 데스크톱)가 지켜야 하는 요건이다 [결정: M2 마감 G2-10]. 사용자가 무엇에 동의하는지 정확히 알고 누르게 하는 것이 목적이다. 카드 구현은 L4 문서가 정하고, 이 절은 화면과 무관하게 보여야 하는 정보를 정한다.

1. 도구 승인(`tool`)은 도구 이름, 위험 등급(`risk`), 실제로 실행될 인자를 보인다. 인자가 `BlobRef`이거나 길어서 줄이면 줄였다는 표시와 전체를 볼 수 있는 길을 둔다. 줄인 인자만 보고 허용하게 두지 않는다.
   MCP 서버 도구면 서버 이름(`mcp.server`)을 보인다. 서버가 알린 성질(`mcp.declared`)이 있으면 그것을 보이면서 서버가 스스로 알린 것이라 믿을 수 없다는 경고를 함께 보인다. 이 표시는 승인 결정을 바꾸지 않는다 [결정: 오케스트레이터 기본값, fxMC].
2. 누가 요청했는지(`origin.caller`: 주 대화는 `main`, `subagent:<이름>`, `background`, `ext:<확장>`, `host`)와 어느 대화인지(`surfaceThreadId`와 `origin.threadId`가 다르면 서브에이전트 대화의 요청이다)를 보인다.
3. 묻는 이유를 보인다. `ruleId`가 있으면 그 규칙이 물었다는 것을, 없으면 권한 모드가 물었다는 것을 말한다. 시크릿 사용 승인(`secret.use`)은 쓰이는 시크릿 참조 이름을 보인다(값은 보이지 않는다).
4. 기억 범위는 요청 단위(`once`, 이번 호출만)뿐이라 선택지를 두지 않는다 [결정: 2026-10-31 사용자, 점검 2026-11-04]. 요청이 제안하지 않은 범위를 선택지로 만들지 않는다.
5. 거부는 사유(`feedback`)를 함께 보낼 수 있게 한다. 허용과 거부를 같은 무게로 보이고, 한쪽만 기본 강조하지 않는다.
6. 해결 뒤 `approval.resolved`의 `remember`와 `requestedRemember`가 다르면 낮춰 적용했다는 사실을 보인다("항상 허용"을 골랐으나 이 대화에서만 적용됨). 클라이언트가 `always`를 선택지로 보이지 않으므로(4번) 정상 경로에서는 나오지 않고, 기능 어댑터 요청에서만 나올 수 있다.
7. `approval.respond`가 `applied: false`를 돌려주면 `reason`에 따라 다르게 다룬다: `answer_invalid`는 `detail`을 보이고 카드를 유지한다, `commit_failed`는 다시 보내게 하고 카드를 유지한다, `already_resolved`와 `unknown_approval`은 카드를 닫고 목록을 다시 읽는다.
8. 비대화형 실행(`interactive: false`)에서 정책이 ask를 deny로 바꾼 호출은 카드를 올리지 않는다. 카드가 없는 거부는 도구 결과 문장(`noninteractive`)으로 사용자에게 보인다.

### 4.8 결과 경계화

[결정] 긴 출력을 자르고 원문은 blob으로 뺀다. pi durable truncate 포크를 쓴다(`_research/layer-plan-v2.json` L1-d "결과 경계화", adr.0003). 포크 위치는 `platform-exec`이고 core-tools는 `fresnel.exec`로 부른다(§3.7).

1. 한도: 줄 `l1.tools.output.maxLines`(기본 2,000), 바이트 `l1.tools.output.maxBytes`(기본 51,200). 먼저 걸리는 쪽이 적용된다. pi와 같은 값이다(`_research/item-catalog.md` L1-d "도구 결과 경계화", durable `truncate.ts:11-12`). 도구별 `outputLimits`가 있으면 그 값을 쓴다.
2. 대상: `tool.result` chain(§4.2 9단계)을 거친 최종 결과의 텍스트 파트다. 텍스트 파트를 `"\n"`으로 이어 한 문자열로 재고, 한도 안이면 그대로 둔다. 이미지 파트는 자르지 않는다. 큰 이미지 데이터는 F.records.spec §3.4의 문자열 분리 규칙으로 blob이 된다.
3. 한도를 넘으면:
   - 원문 전체(이어 붙인 텍스트)를 UTF-8로 `fresnel.store.putBlob(bytes, "text/plain; charset=utf-8")`에 넣는다. 커밋 전, 트랜잭션 밖에서 한다(eng.transactions.design §4.2 `StoreService.putBlob`).
   - 모델용 내용은 `truncateHead(full, limits).content` 한 파트와 안내 문장 한 파트다. 첫 줄 하나가 `maxBytes`를 넘으면 `truncateHead`는 빈 내용을 주므로(`firstLineExceedsLimit`), 그 줄의 앞 `maxBytes` 바이트(UTF-8 글자 경계)를 미리보기로 쓰고 안내의 줄 수는 1이다. 안내 문장은 한 꼴이다 [결정: 2026-11-13 사용자]: `"[Showing lines 1-<outputLines> of <totalLines>. Full output: <path>]"`. 바이트 한도에 걸렸거나 첫 줄만 보였으면 줄 수 뒤에 ` (<formatSize(outputBytes)> of <formatSize(totalBytes)>)`가 붙는다. 숫자는 천 단위 쉼표다. 도구 이름을 가리키는 말은 없다. 파일 사본 구성이 없으면 경로 자리가 `The full output was not saved to a file.`, blob 저장이 실패했으면 `The full output was not stored.`다.
   - 같은 원문을 파일 사본으로도 쓴다: `<상태 디렉터리>/spill/tool-output/<threadId>/<sha256>.txt`(소유자 전용 0600, 폴더 0700). bash의 spill 파일과 같은 `spill/` 아래다. 원문은 `tool.result` chain의 마스킹을 거친 텍스트라 blob과 파일에 같은 내용(가린 뒤의 원문)이 간다. 사본을 못 써도 호출은 실패하지 않는다(경고 기록만).
   - `effect.result.blobRef`에 그 `BlobRef`를 넣는다. 이벤트에는 해시만 남는다(architecture.runtime-flow.design §5 "큰 도구 출력은 블롭 파일로 저장하고 이벤트에는 해시만").
   - `details`에 `{ truncation: { totalLines, totalBytes, outputLines, outputBytes, truncatedBy } }`를 더한다.
4. 원문 상한 [제안]: blob 원문이 50 MiB를 넘으면 앞뒤 25 MiB씩만 저장하고 가운데 생략 표시를 둔다(`docs/design/13-tools-and-execution.md` §3.3.2 "전체 출력" 행 참고). 상한 값은 설정하지 않는다.
5. `outputLimits: "self"` 도구: 스스로 경계화한 도구(예: L2.workspace의 bash가 durable `harness/output.ts` 방식으로 꼬리를 남기는 경우)는 이 단계를 건너뛴다. 그 도구가 낸 `blobRef`는 `details.blobRef`로 받아 `effect.result.blobRef`에 옮긴다.
6. 모델이 원문을 다시 읽는 길 [결정: 2026-11-13 사용자, `read_tool_output` 폐지]: 전용 도구는 없다. 모델은 안내의 경로를 가진 도구로 읽는다(`read`의 `offset`·`limit`, `grep`, `bash`). 파일 도구의 **읽기** 루트에만 `spill/tool-output/` 폴더가 더해진다(쓰기 루트에는 없다, L2.workspace.spec §4.3). 읽기 전용 상황(`read`·`grep`만 가진 서브에이전트)에서도 같은 길이다. bash 샌드박스는 읽기를 기본 허용하므로 `cat`·`sed`도 된다. blob 저장소가 정본이므로 사본은 지워져도 된다: 파일 도구가 이 폴더 안의 없는 `<threadId>/<sha256>.txt`를 읽으려 하면 읽기 직전에 blob에서 다시 만든다(`ToolOutputFiles.restore`). 재시작·이어하기·보관 정리 뒤에도 안내의 경로가 살아 있다.
   - 정리: 대화를 지우면(`thread.delete`) 그 대화의 폴더도 지운다. 보관 정리가 대화를 지우는 경로는 하루마다 도는 쓸어내기(`sweep`)가 대화가 없는 폴더를 지운다. 기간·크기 상한은 두지 않는다: 사본은 blob이 정본이라 지워도 복원되고, 한 건은 blob 상한(4번, 50 MiB)을 넘지 않으며, spill 정리(`l0.exec.spillRetentionDays`)는 이 폴더를 건드리지 않는다(상위 폴더의 `tmp-` 접두 폴더와 파일만 지운다). `l0.exec.spillMaxBytes` 사용량에는 세어진다.
   - 옛 대화 기록에 남은 `read_tool_output` 호출은 표에 없는 도구로 보이고(화면은 generic 요약) 실행하지 않는다. 옛 `ls`·`find` 호출도 같다: 재생은 도구 이름 문자열만 읽고, 등록되지 않은 이름은 실행하지 않는다. 새 호출은 `tool_unavailable`이다 [결정: 2026-11-15 사용자].
7. 꼬리 보존 미리보기(bash처럼 끝부분이 중요한 출력)는 durable 포크에 `truncateTail`이 없어 1차에 두지 않는다. 필요한 도구는 `"self"`로 스스로 처리한다. 공통 꼬리 모드를 둘지는 [미결](§10)이다.

truncate 위치: 출력 절단 함수는 adr.0003의 포크 대상이고 L0 `platform-exec`에 둔다. core-tools와 L2.workspace의 read·bash 포크는 같은 함수를 F 서비스 `fresnel.exec`로 부른다. L1과 L2가 구현 패키지를 import하지 않으므로 사본이나 F 순수 함수가 필요 없다 [결정: review.decisions-2 D-08]. adr.0003 §3 표의 `D/src/truncate.ts` 행 위치를 `xeon/packages/platform-exec`로 고치는 일은 §8.4에 적는다.

### 4.9 재생

- 재개 때 결과 없는 효과의 판정은 F.records.spec §3.5 `decideEffectRecovery`가 한다. 호출은 L1.persistence.spec 몫이다.
- 결정이 `rerun`이면 L1.persistence가 `ToolService.rerun(intent, run)`을 부른다. `rerun`은 `tool.call.before` 훅, 정책, 승인을 다시 거치지 않고 저장된 `intent.args`로 단계 7a~11을 실행한다(durable spec 3136-3170 "Recovery does not rerun beforeTool", architecture.runtime-flow.design §4.2 "재생 시 도구 지점" 행). `effect.result`의 requestId는 처음과 같은 `tool:<toolCallId>:result`다.
- 재실행 횟수 상한(eng.transactions.design §5.2 `MAX_REPLAY_ATTEMPTS = 2`)과 시도 기록 이벤트는 F.records.spec에 kind가 없다. 시도 표시를 `effect.exec`의 반복으로 셀지 L1.persistence.spec과 함께 정한다 [미결](§10).
- 결정이 `synthesize`이면 합성 결과(`OUTCOME_UNKNOWN_TEXT` 또는 `NOT_STARTED_TEXT`)를 L1.persistence가 커밋한다. core-tools는 관여하지 않는다.

### 4.10 인자 재작성 (2차)

- pi-agent-core 1.3.0 원본의 `BeforeToolCallResult`에는 `args` 필드가 없었다(agent `types.ts:66-74`, `_research/notes/L1-1.md` §3(e)). 자체 루프(adr.0009)에서는 포크 조건이 없다. `prepare`가 검증한 인자를 `PreparedCall.args`로 돌려주므로 교체 인자를 같은 자리에 넣으면 된다.
- 그래서 인자 재작성은 2차로 둔다. 도입할 때는 `prepare` 안에서 재검증하고 `PreparedCall.args`와 `effect.intent.args`에 같은 값을 넣는다(`_research/packages.md` §4.3 L1-d "인자 재작성").
- `tool.call.before` 훅에서는 인자를 바꿀 수 없다. 이 훅의 결정은 허용·거부·결과 대체뿐이다. 인자를 바꾸면 의도 커밋과 실행 인자가 달라져 재생 판정이 복잡해지기 때문이다. 확장의 인자 변경이 필요하면 2차에 별도 chain 훅을 더한다 [결정: review.decisions-2 U-06].
- 도입 뒤 규칙 [제안]: 재작성된 인자는 스키마 검증을 다시 거치고, 승인 요청에는 재작성된 인자를 싣는다. `effect.intent.args`는 재작성 뒤 값이다. 승인자가 본 인자와 실행되는 인자가 같아야 하기 때문이다(`_research/item-catalog.md` L1-d "인자 재작성과 재검증").

### 4.11 2차 항목

- 항상 허용 캐시: `remember: "always"`를 저장하는 테이블 `core_tools_approvals`(eng.context-map.design §5.2 `core_tools_` 접두). 키는 (범위: 작업 폴더 경로 또는 사용자, 도구, 규칙 또는 인자 지문), 값은 허용 시각과 출처 `approvalId`. omp `approval-cache.db`(`_research/refs/oh-my-pi.md` 173행)를 참고한다. 목록 조회·철회 명령과 설정 화면을 함께 둔다(`_research/settings.md` §2.6 "승인 캐시"). 캐시 결과는 `user` 티어 allow 규칙으로 평가기에 들어간다.
- 셸 명령 접두 규칙: `PolicyAction`에 `"shell.command"`를 더하고 resource에 명령 접두 목록과 리다이렉션 조건을 둔다. 허용된 명령이라도 리다이렉션은 기본 ask다(`_research/item-catalog.md` L1-d "셸 명령 규칙"). 명령 파싱은 tree-sitter-bash를 쓸 수 있다 [가정: npm 패키지 동작 미검증, `_research/packages.md` §4.3].

### 4.12 실행 환경·샌드박스·시크릿의 책임 경계

[제안] core-tools는 도구를 직접 실행하지 않는다. 명령 실행과 샌드박스 래핑은 도구 구현(L2.workspace의 `bash` 등)이 L0 서비스로 하고, core-tools는 그 앞뒤의 정책·승인·기록·마스킹을 맡는다.

| 일 | L1.tools (core-tools) | L2.workspace (cap-workspace) | L0 |
|---|---|---|---|
| 명령 실행, 샌드박스 래핑 | 하지 않는다. `fresnel.exec`의 `Shell`과 `fresnel.sandbox`를 부르지 않는다 | `bash` 도구가 샌드박스 데코레이터를 거친 `Shell`로 실행한다(L2.workspace.spec §3.3) | `fresnel.exec`, `fresnel.sandbox`(L0.exec.spec, L0.sandbox.spec) |
| 경로 정규화 | 잠금 키 산출에만 `fresnel.exec.canonicalPath`를 쓴다(§4.2 7b) | 파일 도구의 탈출 검사(L2.workspace.spec "역할 나눔" 표) | `fresnel.exec` |
| 시크릿 값 주입(`ShellExecOptions.secretEnv`) | 하지 않는다. 값을 보지 않는다 | 실행 옵션으로 참조(`secret://…`)를 넘긴다 | `fresnel.exec`가 spawn 직전에 `fresnel.secrets` lease로 값을 넣는다(L0.exec.spec §3.6) |
| 승인과 명령 패턴 | 정책 규칙의 `args` 패턴과 승인 프로토콜(§4.5, §4.7). `fresnel.secrets.check`가 `needs_approval`이면 `fresnel.approvals`로 묻고 받은 증거를 넘긴다(L0.secrets.spec §4.2) | 없음 | 정책 판정은 `fresnel.secrets`(L0.secrets.spec §4.2) |
| 도구 결과 마스킹(2계층 `tool-result`) | 8단계 결과와 진행 갱신을 `tool.execution.update`·`tool.result` 발화, 경계화·blob 쓰기, 10단계 커밋 전에 `Redactor.maskDeep`으로 가린다. 텍스트, `structuredContent`, `details`, 오류 문장 모두다. 가린 것이 있으면 `secret.masked`(`layer: "tool-result"`)를 남긴다 | 없음 | `Redactor` 구현(L0.secrets.spec §3.5, §4.4) |
| 도구 인자의 남의 시크릿 구문 검사 | 4단계 검증 뒤 `findForeignSecretSyntax`를 부른다 [가정: L0.secrets.spec 103행] | 없음 | 검사 함수 |

- M1 종료 조건의 시크릿 항목(`product.scope.spec` §4.4 M1 행: SOPS 시크릿 참조 1종을 쓰는 도구 호출에서 값이 이벤트 DB와 모델 요청 본문에 없다)은 위 표대로 나뉜다. L1.tools 몫은 승인·명령 패턴과 2계층 마스킹이다. 주입과 lease는 L0.exec·L0.secrets 몫이다. 세 몫을 한 번에 확인하는 것은 `apps/cli` M1 스모크 시나리오다(L1.tools.plan §6).
- 시크릿 사용 승인 [결정: L1A.4]: 5b 정책과 5c 승인 뒤, 의도 커밋 전에 한다. 도구 인자에 `secretEnv`(env 이름 → `secret://<name>`)가 있는 호출만 대상이다.
  1. `secretEnv`의 값이 `secret://<name>` 형식이 아니면(`$VAR`, `{{secret:x}}` 같은 남의 구문 포함) `[fresnel:invalid_secret_ref]` 거부다. 이 검사는 시크릿 인자로 선언된 필드에만 한다(L0.secrets.spec §3.1). `command` 문자열이 없으면 묶을 명령이 없어 거부다.
  2. 시크릿마다 `fresnel.secrets.check`를 모드 `env`, 목적 `bash:<명령 이름>`, 대상 `{ kind: "command", argv0, commandLine }`, 행위자 `agent`, 증거 없이 부른다. 목적 문자열은 cap-workspace의 shell `run`이 lease에 넘기는 값과 같은 규칙이다. `check`가 오류이거나 `deny`면 `[fresnel:secret_denied]` 거부다. secrets 서비스가 없으면 `[fresnel:secret_unavailable]` 거부다.
  3. 하나라도 `needs_approval`이면 승인 증거(`ApprovalEvidence { approvalId, scope: "per-use", grantedAt, expiresAt: null, handles, purpose }`(`handles`는 승인 제목이 가리킨 시크릿 핸들 전부, `purpose`는 lease의 `UseCtx.purpose`와 같은 `bash:<명령 이름>`. L0가 핸들과 목적을 대조한다))를 만든다. 이 호출의 정책 승인을 사용자가 방금 허용했으면(`resolvedBy: "user"`) 그 승인이 실행마다의 승인(U-19)이라 같은 `approvalId`를 증거로 쓴다. 규칙이나 모드가 허용했거나 `thread` 기억으로 건너뛴 호출은 사용자가 이 호출을 본 적이 없으므로 시크릿 사용을 따로 묻는다: kind `tool`, 규칙 id `secret.use`, 제목에 시크릿 참조, `remember: ["once"]`, `requestKey`는 `<toolCallId>:secret`을 `requestKeyFor`로 줄인 값이다. 거부·취소는 §4.7 5번과 같은 거부 문장이다.
  4. 증거는 호출 상태(`RawCall.secretApproval`)에 실리고, 어댑터가 `CallContext.approval`로 도구 구현에 전달한다(§8.3 F 요청 13). cap-workspace의 shell `run`이 이를 `SecretEnvRequest.ctx.approval`에 옮긴다. 증거가 없으면 `fresnel.exec`의 `withEnv`가 `approval_missing`으로 거부한다(fail-closed). `rerun`은 증거를 만들지 않는다.
- [미결] lease를 부르는 쪽이 문서마다 다르다. L0.exec.spec §3.6은 `fresnel.exec`가 `secretEnv`마다 lease를 얻는다고 적었고, L0.secrets.spec §8.1 제공 표는 L1.tools가 `lease`를 쓴다고 적었다. 이 문서는 L0.exec 쪽을 따른다.
- M1 시크릿 검증 모드는 `env` 주입(bash 도구, 실행마다 승인)이다 [결정: review.decisions-2 U-19]. L1.tools 몫은 실행마다의 승인(§4.7)과 2계층 마스킹이다.
- [미결] M1에서 모델 도구 호출이 `secretEnv`를 받는 경로. L2.workspace.spec §3.3은 `secretEnv`를 모델 도구 파라미터에 두지 않는다. 참조를 bash 실행 옵션으로 넘기는 위치는 L2.workspace.spec과 정한다.

#### 4.12.1 MCP 서버 기동 승인 [결정: M3-05, M3-REQ-75]

시크릿 env(`secret://` 참조)를 쓰는 stdio MCP 서버는 도구 호출이 아니라 연결 때 뜬다. 시크릿이 없어도 작업 폴더 출처(`.fresnel/mcp.json` 등) 명령은 같은 게이트로 묻는다 [결정: 2026-11-04 사용자 A3]. 이때는 시크릿 정책 판정(②)을 건너뛰고 제목이 `Run MCP server "<id>" (<명령>)?`다. 기동 승인은 서버 정의 해시마다 한 번이고 정의가 바뀌면 다시 받는다(`L2.mcp.spec` §4.3, `L0.secrets.spec` §4.3.1).

- 승인 레코드: kind `tool`의 비차단 요청이다. 본문은 `toolName: "mcp_start"`, `risk: "exec"`, `ruleId: "mcp.start"`, `argsHash`는 정의 해시, `args`는 `{ server, source, command, args, cwd, envNames, secretEnv, definitionHash }`다(바뀐 정의면 `changed`가 더 있다, 아래). 평문 env 값은 싣지 않고 이름만 싣는다(해시가 값을 덮는다). 제목은 `Start MCP server "<id>" with <시크릿 참조>?`다. 요청 키는 `mcpstart:<서버 id>:<해시 앞 24자>`라 같은 정의는 같은 요청이다.
- 바뀐 정의 [결정: 오케스트레이터 기본값, fxPT]: 게이트는 서버 id마다 직전에 허용된 정의의 요약(출처, 명령, 인자, 실행 폴더, env 값의 다이제스트, `secretEnv` 전체)을 프로세스 안에만 둔다. 해시가 그 허용과 다른 정의를 물을 때만 승인 `args`에 `changed: { fields, before: { command, args, cwd } }`를 더한다. `fields`는 `command`, `args`, `cwd`, `source`, `env`, `secretEnv` 가운데 바뀐 것만 이 순서로 담는다. `env`는 이름이나 값이 바뀐 것이고 값은 싣지 않는다. `secretEnv`는 이름과 참조 전체를 비교한다(참조만 바뀌어도 잡는다). `before`는 이전 정의의 명령, 인자, 실행 폴더다(JSON 값만). 처음 묻는 정의는 `changed` 키를 싣지 않는다. 제목과 `argsHash`는 그대로다.
- 카드 [결정: 오케스트레이터 기본값, fxPT]: L4 승인 카드는 `mcp_start`의 제목을 저장된 영어 제목 대신 인자의 서버 이름으로 `MCP 서버 "<id>" 시작할까요?`(영문 `Start MCP server "<id>"?`)라고 그린다. 명령은 인자까지 셸 모양 한 줄로 보인다(공백이나 셸 기호가 든 인자는 작은따옴표로 감싼다). 출처는 `mcpjson:project`를 프로젝트 파일(.mcp.json), `settings:user`를 사용자 설정, `ext:<이름>`을 확장 이름으로 보이고 그 밖은 원문이다. 실행 폴더와 평문 env의 이름, 시크릿 참조를 보이고 값은 보이지 않는다. 규칙 줄(`규칙 mcp.start …`) 대신 묻는 까닭을 사람 말로 보인다(시크릿을 쓰는 서버, 프로젝트가 정의한 서버, 그 밖). `changed`가 있으면 `바뀜` 표식, 바뀐 필드, `이전: <명령> / 지금: <명령>` 줄을 보인다. 원본 인자 JSON은 '자세히'에 그대로 둔다.
- `createMcpStartGate`가 흐름을 맡는다: ① 해시와 같은 정의에 받은 증거가 있으면 `approved`. ② `fresnel.secrets.check`를 `mcp.start:<서버 id>` 맥락(대상 `mcp:<서버 id>`)으로 시크릿마다 부르고 거부가 있으면 `denied`(요청을 올리지 않는다). ③ 대화가 없으면 `pending`이다(올릴 곳이 없다). ④ `open`으로 요청을 올리고 응답이 없으면 `pending`, 허용이면 `approved`, 거부면 `denied`다.
- 증거: 허용된 요청의 `approvalId`와 `scope: "per-session"`, `expiresAt: null`이다. 정의를 되돌리면 같은 요청 키가 이미 해결되어 있어 다시 묻지 않는다.
- 응답이 오면 `onResolved(server)`가 서버 id를 알려 L2가 다시 연결을 시도한다. 증거는 프로세스 안에만 두고, 재시작 뒤에는 같은 대화에서 `open`이 해결된 요청을 돌려준다(요청 키가 같으므로). 다른 대화에서는 한 번 더 묻는다 [제안].

#### 4.12.2 샌드박스 밖 실행 감사 [결정: M3-33, 오케스트레이터 기본값]

도구 결과의 `structuredContent`가 `sandboxed: false`와 `unsandboxedBy`(`escape`, `run_unsandboxed`, `disabled`)를 싣고 있으면 결과 커밋(`effect.result`)에 감사 이벤트 `tool.sandbox_bypassed`를 함께 쓴다. 페이로드는 `{ toolCallId, toolName, reason, at }`이고 명령과 출력은 싣지 않는다. 소유자는 core-tools다(`L0.sandbox.spec` §4.8). 알 수 없는 이유 값은 기록하지 않는다.

#### 4.12.3 샌드박스가 막은 것의 이유 [제안: 2026-11-08]

도구 결과에 막은 것이 있으면 `sandboxBlocks`(성공 결과의 `structuredContent`, 또는 오류 결과 `details.detail`)를 읽어 결과를 바꾼다. 구현은 core-tools `src/sandbox-blocks.ts`와 `src/entries.ts`다. 막은 것의 분류는 L0.sandbox.spec §4.2 11번이 정하고, 이 절은 그것을 도구 결과로 옮기는 방법만 정한다.

- 모델에 가는 글: 막은 종류마다 영어 한 줄을 덧붙인다. 원래 본문은 그대로 둔다. 성공 결과는 본문 뒤에 줄을 한 조각 더하고, 오류 결과는 `[<코드>] <메시지>` 뒤에 줄을 잇는다. 줄은 `Blocked by network policy: <도메인> is in blockedDomains.`, `Blocked by sandbox: writing outside the workspace or to a protected path is not allowed: <경로>`, `Blocked by sandbox: reading a protected path is not allowed: <경로>`이다. 대상이 여섯 개를 넘으면 다섯 개만 적고 `(and N more)`를 붙인다. 엔진 글은 로케일을 따르지 않는다.
- 화면용 `details`: `code`는 첫 번째 막은 것의 종류(`sandbox.network_blocked`, `sandbox.write_blocked`, `sandbox.read_blocked`)다. 그 대상을 `domain` 또는 `path`에 싣는다. `blocks`에는 모든 막은 것을 `{ code, domain }` 또는 `{ code, path }`로 싣는다. 성공 결과의 기존 `details`가 객체면 이 칸들을 합친다. 오류 결과는 원래 CapabilityError 코드(예: `exit_nonzero`)를 `capabilityCode`에 두고, `code`는 막은 종류로 바꾼다.
- 막은 것이 없으면 결과는 바뀌지 않는다. `sandboxBlocks`가 있어도 모양이 맞지 않는 항목은 버린다.
- 이 절은 표시와 모델 글이다. 감사 이벤트(§4.12.2 `tool.sandbox_bypassed`)를 새로 쓰지 않는다. 막은 것은 실행이 샌드박스 안에서 일어난 결과이기 때문이다.
- 화면은 `details.code`가 이 세 값이면 결과 행에 한국어 이유를 보인다(L4 desktop 소관).

### 4.13 내장 도구 같은 이름 대체 [결정: 2026-11-03 사용자]

플러그인이 내장 도구(read, bash 등)를 같은 이름으로 바꿔 놓는 길이다. 정본 조건은 F.capabilities.spec §10이고 이 절은 L1.tools의 동작을 정한다.

- 등록: `register(owner, def)`의 `def.replaces`(`ToolReplaceClaim`: 확장 이름, 신뢰 등급)가 있으면 대체 등록이다. X가 매니페스트 `replaces`에 적힌 이름에만 이 값을 싣는다. `replaces`가 없으면 §3.3 그대로 `name_conflict`다.
- 대상: 기능 도구(`ToolEntry.capability`가 있는 내장 도구)만 대체한다. 순서 키 `core.*`의 도구(`tool_search`, 위임·질문 도구 등 도구 실행 틀)는 `replace_forbidden{reason:"core_pipeline"}`, MCP·확장 도구는 `not_builtin`, 없는 이름은 `no_target`이다. 한 이름에 후보는 하나라서 둘째는 `replace_conflict{existing}`다. 등록은 통째로 실패하고 표는 그대로다.
- 상태: 대체는 `pending`으로 시작한다. 표(`get`, `all`, `meta`, 광고)는 원본을 그대로 돌려준다. 사용자가 승인하면 `active`가 되어 다음 조회부터 원본 대신 대체 항목이 나오고, 거부하면 `denied`로 남는다. `ToolService.replacements()`가 모든 후보의 상태(`ToolReplacementState`)를 등록 순서로 돌려준다. 후보가 빠지면(확장 해제) 원본이 다시 보이고 열린 승인 요청은 취소된다.
- 승인 요청: `advertise`가 대화를 알 때 승인 전이고 아직 요청하지 않은 후보마다 요청을 하나 올린다(비차단, 요청 키는 도구·등록·신뢰 등급으로 정해 같은 대화에서 다시 묻지 않는다). 모양은 kind `tool`, `toolName: "tool_replace"`, `ruleId: "tools.replace"`, `risk`는 대체의 실제 위험 등급, `remember: ["once"]`이고 `args`에 `tool`, `extension`, `owner`, `trust`, `originalRisk`, `effectiveRisk`, `notice`를 싣는다. `notice`는 경로 보호가 내장 도구 안에 있어 대체 도구가 스스로 지켜야 한다는 안내다(`TOOL_REPLACE_NOTICE`). 사용자가 답한 요청만 결정으로 친다. 취소·만료·무인 거부는 `pending`으로 되돌려 다음에 다시 묻는다. 신뢰 등급이 `project`인 플러그인도 같은 요청을 거친다. 모달 화면은 별도 화면 트랙이 `tool_replace` 이름으로 알아보고 그린다.
- 위험 등급 하한: 대체 항목의 `risk`는 선언(없으면 §3.3 유도 규칙)과 원본 중 높은 쪽이고 `classes`는 원본과 선언의 합집합이다. `capability`는 비운다(원본의 기능 id를 물려주지 않는다).
- 기본 허용 배제: 대체 항목의 정책 판정이 내장 기본 규칙(`default` 티어)의 allow이거나 위험 등급 때문에 생기는 모드 기본 allow이면 ask로 낮춘다(`demoteReplacementAllow`). `read`의 기본 허용(기능 `workspace.files`와 위험 `read`로 묶인 규칙, §4.5)이 대체에 넘어가지 않는다. deny·ask 규칙, user·managed 범위의 allow, 사용자가 고른 `bypass`는 그대로다. 사람이 답할 수 없으면 ask는 deny다(§4.5 7단계).
- 저장소 범위 배제 [제안]: 저장소가 커밋할 수 있는 범위(`project`, `local`)의 설정은 사용자가 고른 것이 아니므로 대체 항목을 승인 없이 켜지 못한다. 이 범위의 `l1.tools.rules`에서 온 allow는 `user` 티어로 들어오므로 기본 허용 배제로는 막히지 않는다. 그래서 대체 항목의 평가(`evaluateReplacement`)에서 그 allow를 뺀다. 저장소 범위의 deny와 ask는 그대로 남는다. 저장소 범위의 `l1.tools.permissionMode`가 `bypass`이면 그 호출의 `bypassAllowed`를 거짓으로 보고 평가한다(`ToolsScalarConfig.modeFromRepository`). bypass는 기본값으로 내려가고 대체는 ask가 된다. 사용자·managed 범위가 고른 bypass는 그대로다. 저장소 범위가 대체 밖의 도구에 어떻게 적용되는지는 이 배제가 정하지 않는다(§4.5 그대로).
- 도구 실행 틀은 그대로: 대체 도구도 같은 파이프라인(§4.2)을 지난다. 정책·승인, `effect` 기록, 시크릿 검사, 마스킹, 절단, `tool.call.before`(인자를 바꾸지 못한다, U-06)는 대체하지 못한다.
- 경로 보호: 내장 파일 도구 안에 있는 경로 보호(쓰기 범위, 민감 경로)는 대체 도구에 적용되지 않는다. 대체 도구가 스스로 지켜야 하고 승인 요청 본문과 매니페스트 문서가 이를 알린다.
- 시험: `test/tool-replace.test.ts`.

## 5. 실패와 경계 사례

1. 모델이 광고하지 않은 도구를 부름(전역 deny로 뺀 도구 포함): `prepare` 2단계는 광고 목록을 다시 보지 않고 등록 표에서 이름을 찾는다. 등록되지 않은 이름이면 `[fresnel:tool_unavailable]` 오류 결과(`settled`)다. 등록된 도구면 5a·5b를 지나므로 전역 deny 규칙이 그 호출을 거부한다.
2. 인자 검증 실패: 예외를 던지지 않고 `isError: true` 도구 결과로 모델에 돌아간다. 효과 이벤트는 없다. 루프는 계속된다(§4.2 4단계, core-tools `validate.ts`).
3. `tool.call.before` 핸들러 예외 또는 결정 스키마 위반: `FIRST_DENY.tool_call`(`{ block: true, reason: "extension handler failed" }`)로 거부한다(F.extensions.spec §3.5, §5 사례 2). ext-host 디스패치 호출 자체가 실패해도 같은 거부로 본다(fail-closed). 이 거부의 도구 결과 `details`는 UI·로그용으로 `{ code: "denied_by_extension", hook: "tool.call.before", extension, outcome, reason }`를 싣는다. `outcome`은 핸들러 결정이면 `blocked`(`reason`은 그 사유), 예외·시간 초과·스키마 위반·중단으로 대체됐거나 디스패처가 실패했으면 `threw`(`reason`은 null)이고, 디스패처 실패만 `extension`이 null이다. 모델에 가는 본문(`content`)은 바뀌지 않는다 [결정: 오케스트레이터 기본값, scI].

   `guard.tool.before`가 막은 호출의 결과 `details`도 같은 방식으로 싣는다. 모양은 `{ code: "denied_by_guard", hook: "guard.tool.before", extension, outcome, reason }`이고, `outcome`·`extension`·`reason`의 뜻과 대체·디스패처 실패의 처리는 위 `tool.call.before`와 같다. 모델에 가는 본문(`[fresnel:denied_by_guard] <사유>`)은 바뀌지 않는다 [결정: 2026-11-11 사용자].
4. 정책 규칙의 정규식이 잘못됨: 적재 때 그 규칙만 빼고 진단을 남긴다. 평가는 나머지 규칙으로 한다. managed 규칙이 빠지면 설정 화면에 오류 배지를 보인다(L4.settings-ui.spec).
5. 승인 대기 중 턴 취소: §4.7 8번. 승인 대기 중 프로세스 강제 종료: §4.7 재개.
6. 승인 대기 중 클라이언트 재접속: 클라이언트는 `events.subscribe`로 미해결 `approval.requested`를 다시 받는다. 호스트는 `ApprovalService.pending`으로 현재 목록을 줄 수도 있다.
7. `effect.result` 커밋 실패(`busy`, `disk_full`): 같은 requestId로 재시도한다(eng.transactions.design TX-05). 끝내 실패하면 결과를 메모리에만 두고 run을 실패로 끝낸다. 재개 때 의도와 실행 표시만 남은 효과가 되어 `decideEffectRecovery`가 처리한다.
8. `effect.intent` 커밋 실패: 실행하지 않는다. 호출은 `tools.commit_failed` 거부 결과다.
9. 승인 요청 이후 도구 등록이 사라짐(확장 비활성화): 응답이 allow여도 실행 단계 진입 전에 도구 해석을 다시 확인하고 `tool_unavailable` 오류 결과로 닫는다. 요청은 `resolvedBy: "superseded"`로 닫는다.
10. blob 쓰기 실패: 경계화 미리보기만 모델에 보내고 `blobRef: null`, `details.truncation.blobError`를 남긴다. 원문은 잃는다. 이 경우를 경고 이벤트로 남길지는 L0.store.spec의 blob 실패 정책을 따른다.
11. `bypass` 모드인데 managed가 금지함: `setMode`는 `tools.mode_forbidden`을 돌려준다. 이미 `launch` 값이 `bypass`인 채 managed 금지가 생기면 평가기가 `default`로 본다(§4.5 4단계).
12. 같은 이름의 도구를 두 출처가 등록함: `register`가 `err({ kind: "name_conflict", toolName })`을 돌려주고 도구 표는 바뀌지 않는다. 확장 조합이 낼 수 있는 정상 운영 중의 실패라 던지지 않는다(eng.typescript.guide TY-24). 해소 규칙은 F.capabilities.spec §10 [결정: 2026-11-03 사용자](내장 도구 같은 이름 대체)를 따른다. 확장이 매니페스트 `replaces`로 선언한 내장 도구 이름만 대체할 수 있고, 선언 없는 겹침은 이 오류다. 대체는 §4.13이 정한다.
13. `tool.result` 훅이 결과를 고침: 체인의 `applied`에 든 확장이 있고 최종 값이 훅 호출 전과 다르면 결과 `details`에 `resultPatchedBy: [<확장 이름>…]`를 더한다. 이름은 등록 순서이고 같은 확장은 한 번만 적는다. 기존 `details`가 객체면 키를 더해 합치고, `null`이거나 없으면 `{ resultPatchedBy }`로 둔다. 객체가 아닌 값은 건드리지 않는다. 패치가 적용됐어도 최종 값이 그대로면, 또는 `applied`가 비었으면 아무것도 더하지 않는다. 화면은 이 키로 훅 개입을 일반 실패와 구분한다 [결정: 2026-11-11 사용자].
    - 파일 변경 `fileChanges`(M5e §5.4 F-1·F-3·F-4·F-6): 코어 기능 도구(`capability`가 있는 항목)의 결과 `details`에 든 변경(내장 `write`·`edit`의 옛 `FileChange` 한 건)은 체인에 들어가기 전에 떼어 둔다. 플러그인 도구가 `ctx.changes.report`로 알린 변경은 `source: "reported"`로 검증해 모은다. 체인이 끝난 뒤 두 목록을 합쳐 `details.fileChanges`에 싣는다. 관찰 항목이 같은 `path`의 보고 항목을 이긴다. 체인이 `details`를 지우거나 `isError`를 바꿔도 관찰·보고 항목은 남는다(오류 결과도 같다). 합칠 것이 없으면 예약 키 `fileChanges`는 두지 않는다. 도구나 훅이 낸 같은 키는 지운다. 관찰 항목이 옛 한 건과 같으면 `details`의 모양을 바꾸지 않는다. 합친 뒤에 마스킹한다. 구현은 core-tools `src/file-changes.ts`와 `src/pipeline.ts`의 `finishCall`이다.
14. 훅 묻기가 답할 사람이 없는 실행에서 거부됨: 카드는 열리지 않고, 모델 본문은 `[fresnel:denied_by_extension] <사유> (confirmation unavailable)` 한 줄이다. 결과 `details.outcome`은 `asked`다(§4.2.1 무인 실행, M5e E-1).
15. `ask.human.before` 핸들러가 예외를 던짐, 시간 초과, 스키마 위반: 결정 없음이다. 사람에게 묻는다(열린 실패, M5e E-3). 승인이 조용히 허용되지 않고 요청도 멈추지 않는다.
16. 같은 호출에서 훅이 `replace`를 내고 정책은 deny다: `replace`가 이긴다. 정책은 평가하지 않으므로 호출은 실행되지 않고 훅의 결과가 기록된다(§4.2.1). 이 동작의 검토는 §10에 있다.

## 6. 설정 노출

모든 키는 `defineSettings("l1.tools", …)`로 선언한다(F.wire-settings.spec §3.8.3). SettingDef 규칙 D1~D9를 지킨다.

| 키 | 타입 | 기본값 | runtimeChange | allowedScopes | 탭 | widget |
|---|---|---|---|---|---|---|
| `l1.tools.permissionMode` | `"default" \| "acceptEdits" \| "bypass"` | `"bypass"` [결정: 2026-11-13 사용자] | live | managed, user, project, local, launch, profile | permissions | select |
| `l1.tools.bypassAllowed` | boolean | `true` | live | managed | permissions | toggle |
| `l1.tools.rules` | `PolicyRule[]` | `[]` | live | managed, user, project, local, launch | permissions | table |
| `l1.tools.output.maxLines` | integer(100~100,000) | 2000 | nextTurn | managed, user, project, local | tools | number |
| `l1.tools.output.maxBytes` | integer(1,024~1,048,576) | 51200 | nextTurn | managed, user, project, local | tools | number |
| `l1.tools.exposure.deferThreshold` | integer(0~128) | 64 | nextTurn | managed, user, project, local | tools | number |
| `l1.tools.unattended.approval` [제안] | `"wait" \| "deny" \| "expire"` | `"expire"` | nextTurn | managed, user, project, local, launch | permissions | select |
| `l1.tools.unattended.timeoutSeconds` [제안] | integer(1~604,800) | 3600 | nextTurn | managed, user, project, local, launch | permissions | number |

- `l1.tools.rules`는 범위별로 모아 티어를 붙인다(§4.5). 화면은 각 규칙의 출처 범위와 파일을 보인다(`_research/settings.md` §2.6 "규칙 편집기, 우선순위 표시, 각 규칙이 나온 파일 표시").
- `l1.tools.exposure.deferThreshold`가 0이면 auto 도구는 모두 지연 도구다. 64는 [제안] 값이다. 근거가 되는 provider 측정값은 없다 [가정].
- 모드는 CLI 플래그(`--permission-mode`)와 대화 명령으로도 바꾼다. 둘 다 `session` 범위 쓰기다(F.wire-settings.spec §4.9 생성 규칙).
- 2차: 항상 허용 캐시의 목록·철회는 permissions 탭의 목록 편집기와 명령으로 둔다. 키는 캐시가 들어올 때 정한다.

## 7. 훅

발화 소유: core-tools는 9개 훅을 발화한다(`L1.readme` §6 소유표). `ask.human.before`와 `ask.human.after`를 더했다(M5e 결정 A). fold, 페이로드, 실패 규칙은 F.extensions.spec §3.4·§3.5를 인용만 한다.

| 훅 | fold | 발화 위치 | 비고 |
|---|---|---|---|
| `tool.call.before` | first(합치기 `block` > `replace` > `ask`) | §4.2 5a | 결정은 `ToolCallDecision`(막기, 묻기, 결과 대신 주기, §4.2.1). 예외는 거부(fail-closed) |
| `ask.human.before` | first, 실패는 열린 실패 | §4.7.1, `approval.requested` 커밋 전 | 결정은 `cancel`과 질문 답(`answer`)이다. 예외는 결정 없음이다 |
| `ask.human.after` | tap, 실패는 열린 실패 | §4.7.1, 해결 커밋 뒤 | 관찰만 한다 |
| `tool.result` | chain | §4.2 9 | 패치는 `ToolResultPatch`, 병합은 `CHAIN_RULES.tool_result` |
| `tool.execution.before` | tap | §4.2 1 | core-tools가 `prepare`(또는 준비 없이 닫는 `settleRejected`)에서 발화한다 |
| `tool.execution.update` | tap | §4.2 8 | `execute`의 진행 콜백에서 발화한다 |
| `tool.execution.after` | tap | §4.2 11 | 호출 마감(`execute`, 준비 중 닫힘, `settleRejected`) 뒤 발화한다 |
| `thread.prompt.before` | tap(detached) | §4.7 2, `approval.requested` 커밋 뒤 | F.extensions.spec §7 배정과 같다 |
| `thread.prompt.after` | tap(detached) | §4.7 4, `approval.resolved` 커밋 뒤 | 같음 |

- `ToolCallPayload.capability`는 기능 도구일 때 채운다(F.capabilities.spec §7).
- [결정: M3-REQ-71, M3-02] `tool.call.before`, `guard.tool.before`, `tool.result`의 페이로드는 `risk`(도구 등급), `hints`(도구 작성자의 힌트, 없으면 `{}`), `caller`(`ToolRunContext.caller`)를 항상 채운다. Helm의 쓰기 판정과 그룹 핸들러의 자식 대화 구분에 쓴다. `tool.execution.after`는 시크릿을 가린 호출 인자 `input`과 `stepId`를 싣는다(실행 전에 닫힌 호출도 같다). F 스키마에서는 이 필드들이 아직 선택이다: 채우는 쪽이 갖춰졌으므로 필수로 올릴 수 있다(F 변경 요청, 이 문서는 고치지 않는다).
- 서브에이전트 대화의 도구 호출에도 같은 훅이 같은 규칙으로 발화한다. `HandlerContext.threadId`는 자식 대화다 [제안].
- `post`, `drive`, `scope`와의 관계: core-tools는 post·drive를 쓰지 않는다. 확장 비활성화(scope)로 도구 등록이 빠지면 다음 단계 경계의 `advertise`에서 사라진다(F.capabilities.spec §5 사례 5).
- 확장 규칙 등록(extension 티어)은 2차다. 그 전에는 확장이 `tool.call.before` 핸들러로 거부한다. L1 코어 규칙 등록(`registerRules`, default 티어)은 M2다.

## 8. 다른 문서와의 인터페이스

### 8.1 제공

| 이름 | 쓰는 문서 |
|---|---|
| `fresnel.tools` / `ToolService`, `ToolRegistration`, `ToolMeta`, `ToolRunContext`, `AdvertisedToolset`, `prepare`, `execute`, `settleRejected`, `runUserShell` | L1.loop.spec(광고·도구 배치·중단 정리·사용자 셸, 재개 때 같은 단계 계약으로 실행), L1.context.spec(광고 목록 차이), L1.agents.spec(자식 광고·평가), L1.persistence.spec(`rerun`), 모든 L2 spec(도구 등록), L2.mcp.spec(동적 도구 등록) |
| `registerRules`, `RuleRegistration` | L1.agents.spec(자식 차단 규칙, 출처 `core:agents`) |
| 잠금 키 산출(§4.2 7b) | L1.tasks.spec §4.4(키 큐는 불투명 키만 받는다) |
| `PolicyRule`, `TieredRule`, `PolicyResource`, `PolicyInput`, `PolicyDecision`, `PermissionMode`, `CallerId`, `ToolRisk`, `ToolClass`, `evaluatePolicy`, `stricter`, `PolicyCeiling` | L1.agents.spec(권한 상한, 차단 목록), L4.settings-ui.spec(규칙 편집기) |
| `fresnel.approvals` / `ApprovalService`, `ApprovalRequest`, `ApprovalResolution`, `ApprovalBody` | L2.dialog.spec(질문), L2.work.spec(옛 계획 승인 기록), L2.knowledge.spec, L4.host-service.spec(`approval.respond` 처리), L4.cli.spec·L4.desktop.spec(승인 화면) |
| `approval.requested`, `approval.resolved` payload | F.records.spec(카탈로그), F.wire-settings.spec §4.6 |
| `boundToolResult` 동작, 한도 설정 | L2.workspace.spec(`"self"` 도구) |

### 8.2 요구

| 이름 | 출처 |
|---|---|
| `ToolSpec`, `orderTools`, `toolsetFingerprint`, `diffToolsets`, `CapabilityError`, `MAX_TOOLS_PER_REQUEST`, 환원 규칙 §4.2 | F.capabilities.spec |
| `ToolResultRecord`, `ReplayPolicy`, `toReplayPolicy`, `ItemRecord`, `IdFactory` | F.conversation.spec |
| `EffectIntent`, `EffectExec`, `EffectResult`, `decideEffectRecovery`, `StepCheckpoint`, `PendingToolCall`, `BlobRef` | F.records.spec |
| 훅 선언, `FIRST_DENY`, `CHAIN_RULES`, 재생 계약 | F.extensions.spec |
| `approval.respond`, `SettingDef`, `defineSettings`, 범위 층 | F.wire-settings.spec |
| 커밋 경로 `SessionWriter.commit`, requestId 규칙, TX-02 | eng.transactions.design, L1.persistence.spec(`fresnel.session`) |
| `fresnel.store.putBlob` | L0.store.spec |
| `TaskService`: `find("turn", …)`, `openScope`(kind `tool`), `TaskScope.track`, `locks`(`KeyedQueue`, `LockRequest`), `limiter("tools")`, `Slot.suspendWhile` | L1.tasks.spec §3.1~§3.5, §4.4, §4.5 |
| `fresnel.exec`의 `canonicalPath`(잠금 키 산출), 출력 절단 메서드(§3.7, review.decisions-2 D-08) | L0.exec.spec §3 |
| `fresnel.secrets`: `Redactor.maskDeep`, `check`, `findForeignSecretSyntax` | L0.secrets.spec §8.1 |
| `ToolSpec.locks`(잠금 선언, FR-T6) | L1.tasks.spec §8.1, F.capabilities.spec |
| `childDecision`(ceiling 단계) | L1.agents.spec §4.3(F `policy.ts` 이전 요청) |
| 에이전트 타입 `AgentTool`, `AgentToolCall`, `AgentToolResult`, `AgentToolUpdateCallback`, `ToolExecutionMode`(F 정의). 어느 패키지도 `@earendil-works/pi-agent-core`를 import하지 않는다 | F.conversation.spec §3.1.1, eng.dependency-rules.guide DR-07, adr.0009 |
| 훅 디스패치(fold, 핸들러 스냅샷) | X.primitives.spec |
| 단계 체크포인트 쓰기, `ToolRunContext` 생성, 도구 배치 스케줄과 `prepare`·`execute` 호출(재개·중첩 호출) | L1.loop.spec |

### 8.3 F 요청 사항

1. F.capabilities.spec: `ToolSpec`에 `risk?: ToolRisk`, `classes?: readonly ToolClass[]` 추가. `ToolRisk`, `ToolClass` 타입을 `tool-spec.ts`에 둔다.
2. F.capabilities.spec §4.5: 순서 키 접두 `core.<L1 도메인>`(L1 내장 도구) 추가.
3. F.records.spec §3.2·§3.3: `CoreArea`에 `approval` 추가, 카탈로그에 `approval.requested`, `approval.resolved`(둘 다 durable, payload §3.9) 추가. F.wire-settings.spec §4.6이 낸 요청과 같은 항목이다.
4. F.extensions.spec §3.5: `ToolCallPayload`에 `caller: CallerId`, `risk: ToolRisk`, `hints?: ToolHints` 추가.
5. F.wire-settings.spec §3.8.2: 범위별 값을 모으는 키 표시(예: `SettingDef.merge?: "replace" | "collect"`, 기본 replace) 추가. `l1.tools.rules`가 첫 사용처다.
6. F: 서비스 인터페이스 `ToolService`, `ApprovalService`와 서비스 이름 상수를 `@fresnel/contracts/services`에 둔다(review.decisions-2 D-04). 이 부분은 반영됨(`F.capabilities.spec` §3.12 `services/tools.ts`, `services/approvals.ts`). 정책·도구·승인 공용 타입(§3.1~§3.6)은 `capabilities/tools.ts`, `policy.ts`, `approvals.ts`로 이전한다(eng.context-map.design §5.3).
7. (없앰) F.conversation.spec §3.1 `pi.ts`의 agent-core 재노출에 `AgentLoopConfig`, `AgentToolCall`을 더하는 요청. adr.0009로 F가 `AgentToolCall` 등을 `agent.ts`에서 직접 정의하고(F.conversation.spec §3.1.1) `AgentLoopConfig`는 두지 않는다.
8. F.capabilities.spec §3.3: `ToolSpec.locks`(잠금 선언) 추가. L1.tasks.spec FR-T6과 같은 항목이고 core-tools가 키를 산출한다(§4.2 7b).
9. F.capabilities.spec `policy.ts`: `childDecision`을 순수 함수로 둔다. L1.agents.spec §8.3 5와 같은 항목이고 §4.5 ceiling 단계가 쓴다.
10. (반영됨) F.extensions.spec §3.2.1 `ports.ts`: X.primitives.spec §3.9의 `ToolsPort`, `ToolResourceDef`를 둔다(X.primitives.spec §10 요청과 같은 항목). §3.3 `ToolService extends ToolsPort`가 이 이름을 import한다.
11. (반영됨: m2 F.8) F `services/approvals.ts`: `ApprovalService`에 비차단 `open`, `wait`, `get`(`OpenedApproval`, `ApprovalWaitFailure`)을 올렸다(§3.6 비차단 요청). cap-*의 `L2ApprovalsPort` 어댑터가 `request` 하나만으로는 `request`(즉시 상태)와 `wait`(메모리 대기)를 나눌 수 없었다. core-tools의 `ApprovalsInternal`은 `ApprovalService` 그대로다(대화 단위 허용 목록은 없앴다).
12. (반영됨: m2 F.8, core-tools 연결 L1F) F `CallOptions.continuation`(`CallContinuation`: `round`, `inputResponses`, `requestState`)과 MCP `McpQuestion`을 `QuestionBody`로 옮기는 규칙(`planMcpQuestionBody`, `decodeMcpAnswer`, `uniformMcpAnswer`, F.capabilities.spec §3.9 `defs/mcp-questions.ts`)이 들어갔다. D5(a)의 L1.tools 쪽 재호출에 필요하다(§4.3 `approvalId`가 없는 변형). core-tools 어댑터가 `McpInputRequiredSchema`로 변형을 알아보고 질문 승인(요청 키 `mcp:<toolCallId 해시>#r<round>`)을 올려 `continuation`으로 다시 부른다(§4.3, `src/mcp-input.ts`).
13. (반영됨: m2 F.8) F `CallContext.approval?: SecretApprovalEvidence`(`services`의 `ApprovalEvidence`와 같은 타입)와 `CallContext.interactive?: boolean`. core-tools가 `entries.ts`의 `callContext`에서 채우고 cap-workspace의 shell `run`이 `SecretEnvRequest.ctx.approval`에 옮긴다(§4.12).
14. [해소: M2 검토 3] F `ToolService`(F.capabilities.spec §3.12 `services/tools.ts`)에 `suspendWhile(threadId, toolCallId, wait)`를 더했다(§3.3). core-agents의 `agent` 도구가 `tools` 슬롯을 내려놓고 자식을 기다리는 데 필요하다. `AgentTool.execute`와 `ToolRunContext`에는 슬롯을 실을 자리가 없다.
15. (반영됨: m2c G1-09, A-08) F `CallerInfo.agentName`, `approvalCallerOf`, `ApprovalCaller`(`services/approvals.ts`)와 `DirectToolRegistration.executeWithContinuation`의 `threadId`·`context`. core-tools가 `entries.ts`에서 채운다(§3.1 호출 문맥 규칙). L2 어댑터의 복제 `callerOf`는 L2 트랙이 `approvalCallerOf`로 바꾼다.
16. (반영됨: m2c G1-08) F `ApprovalApplyOutcome`(`applied`, `reason`, `detail`)과 `ApprovalNotAppliedReason`. core-tools `respond`가 낸다(§3.6 응답 검사 규칙).

### 8.4 다른 문서 수정 요청

- (반영됨) adr.0003 §3 표·§6, L0.exec.spec §1·§3, L2.workspace.spec: `D/src/truncate.ts` 포크 위치를 `xeon/packages/platform-exec`로 고치고 `fresnel.exec`에 절단 메서드(`truncateHead`, `formatSize`)를 둔다 [결정: review.decisions-2 D-08].
- eng.context-map.design §5.1: `tool.` 접두 행을 `effect.`로 바꾸고 `approval.` 행 type 이름을 F 형식으로 맞춘다. §4.1 `tool-runtime` 행의 쓰는 서비스에 `fresnel.store`(blob)를 더한다.
- L2.dialog.spec: 질문 도구는 `replay: "safe"`, `risk: "read"`, `classes: ["user_interaction"]`를 선언하고 `fresnel.approvals.request`를 실행 안에서 부른다(§4.7).

## 9. 수용 기준

1. 전역 deny 규칙(`{ tool: "bash", effect: "deny" }`, 인자·모드 조건 없음)이 있으면 `advertise` 결과의 `tools`에 `bash`가 없고 `removed`에 규칙 id와 함께 있다.
2. 같은 등록·규칙을 어떤 순서로 넣어도 `advertise`의 `tools` 순서와 `fingerprint`가 같다.
3. `tool.call.before` 핸들러가 예외를 던지면 그 호출은 거부 결과(`isError: true`)이고 `effect.intent`가 없다.
4. 스키마를 위반한 인자는 예외 없이 `isError: true` 도구 결과로 모델에 돌아가고 루프는 다음 단계로 간다.
5. 장애 주입으로 `effect.intent` 커밋을 실패시키면 provider `execute`는 한 번도 불리지 않는다. 의도 표에 없는 `toolCallId`로 어댑터 `execute`를 직접 부르면 provider를 부르지 않는다.
6. 정상 실행 한 건은 `effect.intent`, `effect.exec`, `effect.result` 순서로 기록되고, `effect.result`와 toolResult `item.recorded`는 같은 커밋(같은 requestId, 연속 seq)에 있다.
7. managed 티어 deny와 user 티어 allow가 같은 호출에 일치하면 deny다. user 티어 allow와 default 티어 ask가 일치하면 allow다.
8. `interactive: false`이고 결과가 ask인 입력은 deny(`reason: "noninteractive"`)다.
9. 모드 `acceptEdits`에서 risk `write` 도구 호출은 allow이고 `exec` 도구 호출은 ask다. 광고 목록은 모드 `default`일 때와 같다.
10. 승인 대기 중 프로세스를 강제 종료한 뒤 재개하면 `ApprovalService.pending(threadId)`가 같은 `approvalId`의 요청 하나를 돌려주고, 새 `approval.requested` 이벤트가 생기지 않는다.
11. 출력 60,000바이트 텍스트를 내는 도구 호출은 `effect.result.blobRef`가 원문 sha256을 가리키고, 모델용 toolResult 내용은 51,200바이트 이하 미리보기와 안내 문장이다.
12. 질문 도구 요청은 `approval.requested` 이벤트이고 payload가 `ApprovalRequestSchema`를 통과한다. 계획 승인 요청은 종류에 없어 만들어지지 않는다(§4.7 9번).
13. `evaluatePolicy`는 같은 입력에 같은 결과를 내고 입력 객체를 바꾸지 않는다(동결 객체로 확인).
14. 광고 목록은 128개를 넘지 않는다. always 도구 129개를 등록하면 `advertise`가 `tools.too_many`를 돌려준다.
15. 같은 파일을 쓰는 두 호출(잠금 선언 `write`, 경로 표기는 상대 경로와 심볼릭 링크로 다름)이 한 병렬 배치에 있으면 실행 구간이 겹치지 않는다. 다른 파일이면 겹친다.
16. 잠금 대기 중 turn을 취소하면 그 호출에 `effect.exec`가 없고 결과는 중단 결과다.
17. `l1.tasks.limits.tools = 1`이면 두 번째 도구 실행은 첫 실행이 슬롯을 반납한 뒤 시작하고, 키 잠금을 슬롯보다 먼저 얻는다(M2).
18. `ceiling`이 있는 자식 호출에서 부모 관점 결정이 deny면 자식 관점 결정이 allow여도 deny다.
19. `registerRules("core:agents", …)`를 두 번 부르면 두 번째 규칙 집합만 평가에 쓰이고, 잘못된 규칙은 `issues`로 돌아오며 적재되지 않는다.
20. 도구 결과에 알려진 시크릿 값이 있으면 `effect.result`, toolResult `item.recorded`, blob 원문, `tool.result`·`tool.execution.update` 페이로드에 값 문자열이 없다.
21. core-tools와 F capabilities 소스의 import 목록에 `@earendil-works/pi-agent-core`가 없다(check-layers, DR-07).
22. 옛 계획 승인 기록(`body.kind: plan`)은 대기 목록에 오르지 않고 건너뛴다. 열 때 아무것도 쓰지 않으며, 그 id에 응답하면 `unknown_approval`이다. 모드를 바꾸지 않는다.
23. 질문 응답은 질문 묶음에 맞지 않으면(모르는 id, 없는 선택지, 단일 선택에 둘, 자유 입력 불허에 text, 빈 답) `applied: false`이고 이벤트가 없다.
24. 비대화형 실행의 질문 요청은 `approval.requested`와 `approval.resolved{ deny, noninteractive }`가 한 커밋이고 대기 체크포인트가 없다.
25. `input_required { approvalId }`를 낸 도구 호출은 승인 해결까지 `effect.result` 없이 기다리고, 해결 뒤 같은 `requestId`로 다시 불려 완료 결과를 한 번 기록한다. 대기 중 turn 취소는 그 승인을 `cancelled`로 닫는다.
26. `secretEnv`를 쓰는 호출에서 `check`가 `needs_approval`이면, 정책 승인을 사용자가 방금 허용한 호출은 그 승인이 증거이고 그렇지 않은 호출은 규칙 id `secret.use` 요청을 따로 올린다. `check`가 거부하거나 참조 형식이 틀리면 승인 요청 없이 거부한다.

27a. 지연 도구의 `activeWhen`이 참이면 검색 없이 광고되고 거짓이면 지연으로 남는다. `allow`가 이름을 그대로 적은 지연 도구는 광고되고 glob은 그렇지 않다. `deferralAvailable: false`이면 지연 도구가 모두 광고되고 `tool_search`는 광고되지 않는다. 맞는 도구가 없는 `tool_search` 결과는 지연 도구의 이름을 나열하고 아무것도 활성화하지 않는다.
27. 광고 후보가 임계를 넘으면 auto 도구는 모두 지연 도구이고 `tool_search`가 광고된다. 지연 도구가 없으면 `tool_search`는 광고되지 않는다. `tool_search`가 기록한 활성화 집합을 `advertise`에 넘기면 그 도구들이 광고되고, 재시작 뒤 이벤트에서 다시 읽은 집합으로도 같은 목록이 나온다.
28. 잘린 도구 출력의 원문은 파일 사본으로 남고, 안내 문장의 경로를 `read`·`grep`·`bash`로 읽는다. 사본이 지워졌어도 `read`가 blob에서 되살린다(§4.8 6번). 전용 읽기 도구는 없다.
29. `runUserShell`은 caller `main`, 대화형으로 평가해 ask를 승인 요청 없이 실행하고 deny는 실행 없이 거부한다. 효과 3단이 남고 toolResult item은 없다.
30. `tools` 풀 슬롯이 1개이면 두 번째 호출은 첫 호출이 슬롯을 놓은 뒤 시작한다. 대기 중 turn을 취소하면 그 호출에 `effect.exec`가 없다. `suspendWhile` 동안 다른 호출이 슬롯을 쓸 수 있다.
31. `approvalId`가 없는 `input_required`(MCP)는 질문 승인(kind `question`)이 되고, 답이 `continuation.inputResponses`로 돌아가 같은 `requestId`로 다시 불린다. `requestState`는 바이트 그대로 가고 라운드는 이전 라운드 + 1이다. 거부는 모든 입력 요청에 `decline`, 비대화형은 요청과 거부 해결이 한 커밋이며 `decline`이다. 질문 중 turn 취소는 승인을 `cancelled`로 닫고 서버를 다시 부르지 않는다. 라운드마다 다른 요청 키를 쓴다. 모양이 틀린 변형은 `[fresnel:input_required_invalid]` 오류 결과다.
32. `secretEnv` 호출의 승인 증거는 `CallContext.approval`로 도구 구현에 전달된다. 증거가 없거나 비대화형이면 필드가 없거나 `interactive: false`다.
33. 해결된 요청이 `RESOLVED_KEPT`를 넘으면 가장 먼저 해결된 것이 메모리 표에서 빠지고 대기 중인 요청은 남는다. 빠진 요청의 `requestKey`로 다시 `open`하면 새 이벤트 없이 같은 `approvalId`와 저장된 해결을 돌려준다.
34. 기능 도구(`CallOptions.context`)와 직접 등록 도구(`executeWithContinuation`의 `context`)는 같은 `caller`를 받는다: 주 대화는 `{ kind: "model", agent: "main" }`, 서브에이전트는 `{ kind: "model", agent: "subagent", agentName: <정의 이름> }`이고 `approvalCallerOf`가 각각 `main`, `subagent:<정의 이름>`을 낸다.
35. 도구 승인의 `remember`는 `["once"]`이다(예외: `web.access`는 `["once", "always", "thread"]`, `sandbox.write_access`는 `["once", "thread"]`, §4.7 6번). `thread`·`always`를 보낸 응답은 `applied: false`, `reason: "answer_invalid"`이고 요청은 대기 그대로다. `once` 밖을 제안하는 요청은 열리지 않는다(`approvals.request_invalid`). 같은 도구의 다음 ask는 다시 묻는다.
36. `respond`는 `applied: false`일 때 `reason`을 낸다: 모르는 `approvalId`는 `unknown_approval`, 해결된 요청은 `already_resolved`, 맞지 않는 decision·answer·remember는 `answer_invalid`와 `detail`이다.
37. `origin.stepId`가 없는 요청은 활성 호출의 단계로 채워 기록한다(`approval.requested` payload의 `origin`과 이벤트 봉투가 같은 값). `secretEnv`를 쓰는 호출의 정책 승인 제목은 시크릿 참조를 말하고 120자를 넘으면 개수로 줄인다.
38. 같은 turn에서 웹·MCP 도구 결과 뒤에 부른 확장 도구(`ToolResourceDef.execute`)의 `ctx.caller.afterUntrusted`는 `true`이고, 그 전과 다음 turn에서는 없다. 기능 도구의 `CallOptions.context.caller`도 같다.
39. 훅 `ask`를 낸 `read` 호출은 승인 카드 한 장을 연다. 카드 본문의 `askedBy`가 `{ extension, reason }`이고 `ruleId`가 `hook:<확장 이름>`이며 `remember`가 `["once"]`다. 허용하면 실행되고 거부하면 결과 본문이 `The user denied this tool call.`이다.
40. 정책 deny인 호출에 훅 `ask`가 있으면 거부이고 카드를 열지 않는다. 정책 ask인 호출에 훅 `ask`가 있으면 카드는 한 장이고 제목에 정책 규칙 id와 훅 사유가 함께 있다.
41. 권한 모드 `bypass`에서도 훅 `ask`의 카드가 뜬다.
42. `interactive: false`이고 무인 정책이 `deny`인 호출의 훅 `ask`는 카드 없이 거부되고, 모델 본문은 `[fresnel:denied_by_extension] <사유> (confirmation unavailable)` 한 줄이다.
43. 훅 `replace`를 낸 호출은 도구를 실행하지 않고, `effect.intent`가 없고, 결과 `content`가 훅 값과 같고, `details`에 `{ hook: "replaced", extension }`이 있고, `tool.result` 핸들러는 한 번도 불리지 않는다.
44. 앞 핸들러가 `ask`를 내고 뒤 핸들러가 `block`을 내면 결과는 `block`이다. `ask`와 `replace`이면 `replace`다.
45. `ask.human.before`가 `cancel`을 내면 카드 없이 `resolvedBy: "extension"`으로 거부된다. `answer`는 질문 카드에서만 해결하고, 도구 카드에서는 무시되어 카드가 뜬다(진단 `tools.ask_human_answer_ignored`). 핸들러 예외는 카드를 띄운다.
46. 같은 `requestKey`의 두 번째 `open`과 재시작 뒤 복원된 요청은 `ask.human.before`를 다시 발화하지 않는다. `ask.human.after`는 해결 커밋마다 정확히 한 번 발화한다.

## 10. 미결 사항

- [미결] 서비스 모드 유휴 종료에서 승인 대기 대화를 live로 셀지(architecture.runtime-flow.design §7). 이 문서와 L1.tools.plan은 M2까지 live로 취급한다.
- [결정: review.decisions-2 U-06] `tool.call.before` 훅에서 인자 변경은 지원하지 않는다(fold `first`, 허용·거부·결과 대체만). 인자 변경이 필요하면 2차에 별도 chain 훅을 더한다(§4.10).
- [미결] 꼬리 보존 미리보기의 공통 모드(§4.8 7번).
- [미결] 재실행 시도 횟수 기록 방식과 상한(§4.9). eng.transactions.design `MAX_REPLAY_ATTEMPTS`와 F.records.spec 결정표의 연결.
- [결정: L1A.4, L1F] `input_required` 출력 변형의 판별 필드는 `status: "input_required"`이다(§4.3). `approvalId`가 없는 MCP 변형의 재호출은 어댑터가 질문 승인을 올려 `CallOptions.continuation`으로 닫는다.
- [결정: 병합 HOST.6] `DirectToolRegistration`으로 등록되는 동적 MCP 서버 도구의 `input_required` 재호출은 F `DirectToolRegistration.executeWithContinuation`(연속 정보를 인자로 받는 실행 함수)으로 닫는다. cap-mcp `createToolServiceRegistrar`가 이 필드를 채운다. 호스트 시험 `approval-shapes.int.test.ts`가 서버 질문, 질문 승인, 답, 재호출, 도구 완료를 한 엔진에서 확인한다.
- [결정: m2 F.8] `approval.respond`의 `answer` 정본은 `QuestionAnswer`(질문 id → `{ selected, text? }`)다. 계획 `allow`(옛 기록)는 받지 않는다 [결정: 2026-11-15 사용자]. `deny`는 `{ feedback }`이고 스키마는 F.records `ApprovalAnswerSchema`다(F.wire-settings.spec §3.3.1). L2.dialog의 `AskAnswer`(`{ answers: [{ questionId, selected, text }] }`)는 wire에 나오지 않고 cap-dialog 어댑터가 `QuestionAnswer`와 서로 옮긴다(L2.dialog.spec §4.1.1). core-tools는 `QuestionAnswer`만 받는다.
- [미결] 정책 규칙 수집 방식(범위별 수집 대 키 분리, §4.5). F 요청 5가 받아들여지지 않으면 `l1.tools.rules.managed`, `l1.tools.rules.user` 같은 범위별 키로 나눈다.
- [미결] Anthropic 서버 쪽 tool search 사용 여부(§4.1 8번).
- [미결] 확장(extension 티어) 규칙 등록 경로와 매니페스트 필드(2차).
- (닫음) `remember: "thread"`·`"always"`: M4의 승인 기억은 요청 단위뿐이라 제안하지 않는다(§4.7 6번). 영구 허용은 사용자 규칙이다.
- [미결] 도구가 다른 도구를 부르는 중첩 호출의 진입점(§4.2). `prepare`·`execute`를 부르는 쪽은 core-loop이므로 `LoopService`에 진입점을 둘지, 중첩 호출을 2차로 미룰지 L1.loop.spec과 정한다.
- [미결] 시크릿 lease를 부르는 쪽(L0.exec 대 L1.tools)과 `secretEnv`가 모델 도구 인자로 들어오는 경로(§4.12). 증거를 도구 구현까지 옮기는 길은 F 요청 13으로 닫혔다(`CallContext.approval`). M1 검증 모드 자체는 `env`로 정했다(U-19).
- [미결] [근거: `core-tools/src/approvals/service.ts` `open`의 `known` 분기, `pending.ts` `scanApprovals`] `ask.human.before`는 같은 `requestKey`의 요청이 메모리 표에서 빠진 뒤(`RESOLVED_KEPT` 넘김, §4.7 10번) 다시 열리면, 커밋 키로 저장된 요청을 되찾기 전에 한 번 발화할 수 있다. 커밋 전에 재생 여부를 알 방법이 없다(`scanApprovals`는 가지 전체를 읽는다). 해결안은 저장소에 요청 키 조회를 더하는 것과, 발화를 커밋 뒤로 옮기고 `cancel`을 따로 커밋해 닫는 것이다. 둘 다 M5e E-7을 이 경우까지 지킨다.
- [미결] [근거: `core-tools/src/pipeline.ts` `recordWithoutEffect`] `replace`의 결과 본문은 `outputLimits` 경계화를 거치지 않는다. 기록 커밋이 실패하면 `itemId`는 null이고 결과는 모델에 그대로 간다(§4.2 `recordWithoutEffect`). 큰 본문의 상한을 정해야 한다.
- [미결] [근거: H-1, `core-tools/src/pipeline.ts` `dispatchToolCall`의 `replace` 분기가 `decide`보다 먼저 닫는다] `replace`는 정책 deny인 호출도 훅의 결과로 대신한다. 실행은 되지 않으므로 H-1의 "좁히기만 한다"는 실행 면에서 지켜진다. 그러나 모델은 정책 거부 대신 훅의 본문을 본다. 확장 권한을 정할 때 정책 거부를 `replace`가 덮어도 되는지 다시 본다.
- [미결] [근거: `contracts/src/records/catalog/approval.ts` `ApprovalResolvedPayloadSchema`] 취소 해결(`cancel`)의 사유는 `approval.resolved` 스키마에 싣는 자리가 없어 기록에 남지 않는다. 모델 본문도 고정 문장이다.
- [가정] 사용자가 셸로 친 명령(`runUserShell`)의 훅 묻기는 허용으로 본다(§4.2.1 6번).

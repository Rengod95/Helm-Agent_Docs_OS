import type { CapabilityId, ToolName, ToolRef, ToolSpec } from "@xeon/contracts/capabilities";
import type {
  AgentTool,
  AgentToolUpdateCallback,
  EffectId,
  ImageContent,
  ItemId,
  JsonObject,
  JsonValue,
  ReplayPolicy,
  TextContent,
  ThreadId,
  Usage,
} from "@xeon/contracts/conversation";
import type {
  ApprovalEvidence,
  ExecService,
  ExposureMode,
  OutputLimits,
  Slot,
  ToolClass,
  ToolRisk,
  ToolRunContext,
} from "@xeon/contracts/services";

// core-tools 내부 공용 타입.

/**
 * 도구가 낸 결과. 기록 전이라 `details`가 JSON인지 아직 확인되지 않았다(확인은 finishCall). AgentToolResult는 이 모양에 대입할 수 있다.
 * 읽기 전용이라 마스킹·경계화가 새 값을 만든다.
 */
export interface RawToolResult {
  readonly content: readonly (TextContent | ImageContent)[];
  readonly details?: unknown;
  readonly structuredContent?: JsonValue;
  readonly usage?: Usage;
  readonly isError?: boolean;
  readonly terminate?: boolean;
}

/** 한 호출의 원시 실행 입력. 정책·승인·효과 기록은 바깥(파이프라인)이 맡는다 */
export interface RawCall {
  readonly run: ToolRunContext;
  readonly toolCallId: string;
  readonly params: unknown;
  readonly signal: AbortSignal;
  readonly onUpdate: AgentToolUpdateCallback;
  /**
   * 호출이 비밀(`secretEnv`)을 쓸 때 사람이 승인한 증거(L1.tools.spec §4.12, U-19). 쓰지 않거나 증거를 얻지 못했으면 null.
   * 도구 구현에는 F `CallContext.approval`로 전달한다(`entries.ts` callContext)
   */
  readonly secretApproval: ApprovalEvidence | null;
}

export interface RawOutcome {
  readonly result: RawToolResult;
  /** 실행 중 중단되어 효과가 어디까지 났는지 모르는 결과(능력 오류 aborted 등) */
  readonly interrupted: boolean;
}

type RawExecutor = (call: RawCall) => Promise<RawOutcome>;

/** 잠금 선언 하나(L1.tools.spec §4.2 7b). ToolSpec.locks(F 요청 8)가 F에 들어오면 등록 변환이 채운다 */
export interface LockDecl {
  readonly path: string;
  readonly mode: "shared" | "exclusive";
}

type LockDeclarer = (args: JsonObject) => readonly LockDecl[];

/** 등록 표의 항목 하나: 도구 하나 */
export interface ToolEntry {
  readonly name: ToolName;
  readonly label: string;
  readonly description: string;
  readonly parameters: AgentTool["parameters"];
  readonly outputSchema: AgentTool["outputSchema"];
  readonly executionMode: AgentTool["executionMode"];
  readonly ref: ToolRef;
  readonly capability: { readonly id: CapabilityId; readonly method: string } | undefined;
  readonly mcpServer: string | undefined;
  readonly risk: ToolRisk;
  readonly classes: readonly ToolClass[];
  readonly hints: NonNullable<ToolSpec["hints"]>;
  readonly replay: ReplayPolicy;
  readonly exposure: ExposureMode;
  readonly outputLimits: OutputLimits | "self";
  readonly raw: RawExecutor;
  readonly locks: LockDeclarer | undefined;
}

/**
 * 출력 절단 함수. 구현은 L0 platform-exec의 durable truncate 포크이고 F `ExecService`(`xeon.exec`)의 메서드로 받는다
 * (review.decisions-2 D-08, B-04, L1.tools.spec §3.7). 이 패키지에는 사본을 두지 않는다.
 */
export type OutputTruncator = Pick<ExecService, "truncateHead" | "formatSize">;

/** 도구 호출 하나의 메모리 상태. 의도 표(intent table)를 포함한다 */
export interface CallState {
  readonly threadId: ThreadId;
  readonly toolCallId: string;
  /** 커밋 키에 넣는 toolCallId 부분(commitKeyPart) */
  readonly key: string;
  readonly run: ToolRunContext;
  readonly entry: ToolEntry;
  /** 최종 인자(검증을 마친 값) */
  readonly args: JsonObject;
  /** 커밋된 effect.intent. 이 값이 있어야 실행할 수 있다 */
  intent: { readonly effectId: EffectId; readonly itemId: ItemId } | undefined;
  /** effect.exec를 커밋했는가 */
  execCommitted: boolean;
  /** 실행 시작 시각(Clock) */
  startedAt: number | undefined;
  /** 중단으로 끝났는가(effect.result.status = interrupted) */
  interrupted: boolean;
  /** 사용자가 직접 친 셸 명령(`runUserShell`)인가. 정책 ask는 사용자 본인이 낸 명령이라 허용으로 보고, toolResult item은 기록하지 않는다 */
  readonly userShell: boolean;
  /** 실행 중 쥔 `tools` 풀 슬롯. 실행이 끝나면 놓는다. 자식을 기다리는 도구는 이 슬롯을 내려놓고 기다린다(`suspendWhile`) */
  slot: Slot | undefined;
  /** 이 호출의 정책 승인을 사용자가 방금 허용했으면 그 approvalId. 비밀 사용 증거로 쓴다(U-19) */
  userApprovalId: string | undefined;
  /** 비밀 사용 승인 증거. 비밀을 쓰지 않거나 재실행이면 null */
  secretApproval: ApprovalEvidence | null;
  /** 재실행 시도 번호. 처음 실행은 0 */
  attempt: number;
  /** 진행 갱신 번호(dispatchKey용) */
  updates: number;
  /** 진행 갱신에서 가린 값의 종류별 횟수 */
  readonly maskedHits: Map<string, number>;
  /** 이 호출의 tool 범위 노드를 정착시킨다 */
  release: (() => void) | undefined;
  /** 결과를 커밋했을 때의 toolResult item */
  settledItem: ItemId | undefined;
}

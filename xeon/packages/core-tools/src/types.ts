import type { CapabilityId, ToolName, ToolRef, ToolSpec } from "@xeon/contracts/capabilities";
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
  EffectId,
  ItemId,
  JsonObject,
  ReplayPolicy,
  ThreadId,
} from "@xeon/contracts/conversation";
import type {
  ExposureMode,
  OutputLimits,
  ToolClass,
  ToolRisk,
  ToolRunContext,
} from "@xeon/contracts/services";

// core-tools 내부 공용 타입.

/** 도구 실행 결과. 어댑터의 details는 AgentTool 기본값(unknown)을 따른다 */
type ToolResult = AgentToolResult<unknown>;

/** 한 호출의 원시 실행 입력. 정책·승인·효과 기록은 바깥(파이프라인)이 맡는다 */
export interface RawCall {
  readonly run: ToolRunContext;
  readonly toolCallId: string;
  readonly params: unknown;
  readonly signal: AbortSignal;
  readonly onUpdate: AgentToolUpdateCallback | undefined;
}

export interface RawOutcome {
  readonly result: ToolResult;
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
  readonly prepareArguments: AgentTool["prepareArguments"];
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

/** 출력 절단 결과. durable truncate 포크의 TruncationResult에서 이 패키지가 읽는 필드만 적었다 */
export interface TruncationOutcome {
  readonly content: string;
  readonly truncated: boolean;
  readonly truncatedBy: "lines" | "bytes" | null;
  readonly totalLines: number;
  readonly totalBytes: number;
  readonly outputLines: number;
  readonly outputBytes: number;
}

/**
 * 출력 절단 함수. 구현은 L0 platform-exec의 durable truncate 포크이고 `xeon.exec`로 받는다
 * (review.decisions-2 D-08, L1.tools.spec §3.7). 이 패키지에는 사본을 두지 않는다.
 */
export interface OutputTruncator {
  truncateHead(
    content: string,
    options?: { readonly maxLines?: number; readonly maxBytes?: number },
  ): TruncationOutcome;
  formatSize(bytes: number): string;
}

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

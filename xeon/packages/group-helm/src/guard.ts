import type { CallerId, ToolHints, ToolRisk } from "@fresnel/contracts/capabilities";
import type { ToolCallDecision } from "@fresnel/contracts/extensions";
import type { HelmSettings } from "./settings.ts";
import type { HelmPhase, HelmState } from "./state.ts";

export const WRITE_DENY_REASON =
  "Helm 확산 단계(diverge, explore)에서는 파일을 바꾸거나 명령을 실행하는 도구를 쓸 수 없습니다. 읽기 도구로 자료를 모으세요. 탐구가 끝나거나 /helm stop 으로 멈추면 쓸 수 있습니다.";

/** `tool.call.before` 페이로드에서 Helm이 읽는 도구 메타 */
export interface ToolCallMetaView {
  /** 위험 등급. 없으면 exec로 본다 */
  readonly risk?: ToolRisk;
  readonly hints?: ToolHints;
  /** 호출 주체. 없으면 main이다 */
  readonly caller?: CallerId;
}

/** 순수 함수. risk가 read가 아니면 쓰기다. hints는 등급을 낮추지 않는다 */
export function isWriteCall(meta: Readonly<ToolCallMetaView>): boolean {
  return meta.risk !== "read";
}

/** 순수 함수. 이 호출이 쓰기 거부 대상 대화에서 왔는가: main과 subagent:explorer */
export function isGuardedCaller(caller: CallerId | undefined): boolean {
  return caller === undefined || caller === "main" || caller === "subagent:explorer";
}

/** 메타(risk)가 비어 있던 도구 이름. `/helm status`가 경고에 쓴다. 프로세스 메모리 */
export type MissingMeta = Set<string>;

/**
 * 그룹 전역 표지(프로세스 메모리). 지금 drive가 구동 중인 탐구의 단계다. drive 호출 밖에서는 idle이다.
 * explorer 자식 대화는 자기 대화의 커밋 상태가 idle이라 `ctx.state`로 판정할 수 없으므로 이 값을 쓴다
 */
export interface ExplorationMarker {
  phase: HelmPhase;
}

/**
 * 순수 함수. 이 호출이 본 탐구 단계. `subagent:explorer`는 구동 중인 탐구의 표지를, 그 밖의 호출은
 * 호출한 대화 자신의 커밋 상태를 본다
 */
export function phaseSeenBy(
  caller: CallerId | undefined,
  state: Readonly<Pick<HelmState, "phase">>,
  marker: Readonly<ExplorationMarker>,
): HelmPhase {
  return caller === "subagent:explorer" ? marker.phase : state.phase;
}

/**
 * `tool.call.before` first 핸들러. 탐구 단계가 diverge·explore이고 writeGuard가 참이며 쓰기 호출이고
 * 대상 대화(main, explorer, 또는 caller 없음)에서 왔을 때만 거부한다. 단계는 `phaseSeenBy`로 고른다.
 * 예외는 던지지 않는다(던지면 X가 거부로 바꾼다)
 */
export function guardWrite(
  settings: () => HelmSettings,
  missing: MissingMeta,
  marker: Readonly<ExplorationMarker>,
): (
  call: ToolCallMetaView & { readonly toolName: string },
  ctx: { readonly state: Readonly<HelmState> },
) => ToolCallDecision | undefined {
  return (call, ctx) => {
    if (call.risk === undefined) missing.add(call.toolName);
    if (!settings().writeGuard) return undefined;
    if (!isGuardedCaller(call.caller) || !isWriteCall(call)) return undefined;
    const phase = phaseSeenBy(call.caller, ctx.state, marker);
    if (phase !== "diverge" && phase !== "explore") return undefined;
    return { block: true, reason: WRITE_DENY_REASON };
  };
}

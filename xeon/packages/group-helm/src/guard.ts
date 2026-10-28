import type { CallerId, ToolHints, ToolRisk } from "@xeon/contracts/capabilities";
import type { ToolCallDecision } from "@xeon/contracts/extensions";
import type { HelmSettings } from "./settings.ts";
import type { HelmState } from "./state.ts";

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
 * `tool.call.before` first 핸들러. 커밋된 phase가 diverge·explore이고 writeGuard가 참일 때만 거부한다.
 * 예외는 던지지 않는다(던지면 X가 거부로 바꾼다)
 */
export function guardWrite(
  settings: () => HelmSettings,
  missing: MissingMeta,
): (
  call: ToolCallMetaView & { readonly toolName: string },
  ctx: { readonly state: Readonly<HelmState> },
) => ToolCallDecision | undefined {
  return (call, ctx) => {
    if (call.risk === undefined) missing.add(call.toolName);
    if (!settings().writeGuard) return undefined;
    const { phase } = ctx.state;
    if (phase !== "diverge" && phase !== "explore") return undefined;
    if (!isGuardedCaller(call.caller) || !isWriteCall(call)) return undefined;
    return { block: true, reason: WRITE_DENY_REASON };
  };
}

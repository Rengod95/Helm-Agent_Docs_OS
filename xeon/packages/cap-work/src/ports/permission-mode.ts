import { err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { StoreError } from "@xeon/contracts/records";
import type { PermissionMode, ToolService } from "@xeon/contracts/services";

// L2.work.spec §4.2.1. 권한 모드 상태와 쓰기 차단은 L1.tools 소유다. cap-work는 모드 전환을 요청만 한다.
// 실제 구현은 ToolService.mode·setMode(F, L1A.2)를 감싸고, 이름이 바뀌면 이 파일만 고친다.

export type ModeFailure =
  /** 조직 정책이 그 모드를 막았다 */
  | { readonly kind: "mode_forbidden"; readonly mode: PermissionMode }
  /** 모드 변경을 세션 설정에 커밋하지 못했다 */
  | { readonly kind: "commit_failed"; readonly store: StoreError };

export interface PermissionModePort {
  current(threadId: ThreadId): PermissionMode;
  /** plan 모드로 바꾸고 이전 모드를 돌려준다. 이미 plan이면 아무것도 바꾸지 않고 previousMode는 null이다 */
  enterPlan(
    threadId: ThreadId,
  ): Promise<Result<{ readonly previousMode: PermissionMode | null }, ModeFailure>>;
  /** 지금 plan이면 target 모드로 돌린다. plan이 아니면 아무것도 바꾸지 않는다. source는 L1.tools의 기록 구분이다 */
  restore(
    threadId: ThreadId,
    target: PermissionMode,
    source: "user" | "plan_approval",
  ): Promise<Result<{ readonly mode: PermissionMode }, ModeFailure>>;
}

/** ToolService(xeon.tools)를 PermissionModePort로 감싼다 */
export function toolsPermissionMode(
  tools: Pick<ToolService, "mode" | "setMode">,
): PermissionModePort {
  return {
    current: (threadId) => tools.mode(threadId),
    async enterPlan(threadId) {
      const previous = tools.mode(threadId);
      if (previous === "plan") return ok({ previousMode: null });
      const changed = await tools.setMode(threadId, "plan", "user");
      if (changed.ok) return ok({ previousMode: previous });
      return err(modeFailureOf(changed.error));
    },
    async restore(threadId, target, source) {
      const current = tools.mode(threadId);
      if (current !== "plan") return ok({ mode: current });
      const changed = await tools.setMode(threadId, target, source);
      return changed.ok ? ok({ mode: changed.mode }) : err(modeFailureOf(changed.error));
    },
  };
}

function modeFailureOf(
  error: Extract<Awaited<ReturnType<ToolService["setMode"]>>, { ok: false }>["error"],
): ModeFailure {
  return error.kind === "tools.mode_forbidden"
    ? { kind: "mode_forbidden", mode: error.mode }
    : { kind: "commit_failed", store: error.store };
}

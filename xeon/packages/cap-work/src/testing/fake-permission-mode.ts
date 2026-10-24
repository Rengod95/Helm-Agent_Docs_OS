import { err, ok } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { PermissionMode } from "@xeon/contracts/services";
import type { PermissionModePort } from "../ports/permission-mode.ts";
import { PERMISSION_MODE_KEY } from "../plans/refs.ts";
import type { FakeWriter } from "./fake-writer.ts";

// L1.tools 권한 모드 대역. setMode처럼 세션 범위 `settings.changed` 이벤트를 남기므로 투영기의 모드 추적이 실제와 같이 움직인다.

export interface FakePermissionMode extends PermissionModePort {
  /** 포트로 부른 호출 기록 */
  readonly calls: string[];
  /** 이 모드로의 변경을 조직 정책처럼 막는다 */
  forbid(mode: PermissionMode): void;
  /** 사용자가 모드를 직접 바꾼다(이벤트가 남는다) */
  set(threadId: ThreadId, mode: PermissionMode): void;
  /** 파일 설정에서 온 모드처럼 이벤트 없이 모드를 정한다 */
  setConfigured(threadId: ThreadId, mode: PermissionMode): void;
}

export function createFakePermissionMode(options: {
  readonly writer: FakeWriter;
  readonly initial?: PermissionMode;
}): FakePermissionMode {
  const modes = new Map<ThreadId, PermissionMode>();
  const forbidden = new Set<PermissionMode>();
  const calls: string[] = [];
  let counter = 0;
  const current = (threadId: ThreadId): PermissionMode =>
    modes.get(threadId) ?? options.initial ?? "default";
  const record = (threadId: ThreadId, mode: PermissionMode): void => {
    counter += 1;
    options.writer.write(threadId, `tools:mode:${counter}`, "settings.changed", {
      key: PERMISSION_MODE_KEY,
      scope: "session",
      value: mode,
    });
    modes.set(threadId, mode);
  };
  return {
    calls,
    forbid: (mode) => void forbidden.add(mode),
    set: record,
    setConfigured: (threadId, mode) => void modes.set(threadId, mode),
    current,
    enterPlan(threadId) {
      calls.push(`enterPlan:${threadId}`);
      const previous = current(threadId);
      if (previous === "plan") return Promise.resolve(ok({ previousMode: null }));
      if (forbidden.has("plan")) {
        return Promise.resolve(err({ kind: "mode_forbidden", mode: "plan" }));
      }
      record(threadId, "plan");
      return Promise.resolve(ok({ previousMode: previous }));
    },
    restore(threadId, target, source) {
      calls.push(`restore:${target}:${source}`);
      if (current(threadId) !== "plan") return Promise.resolve(ok({ mode: current(threadId) }));
      if (forbidden.has(target)) {
        return Promise.resolve(err({ kind: "mode_forbidden", mode: target }));
      }
      record(threadId, target);
      return Promise.resolve(ok({ mode: target }));
    },
  };
}

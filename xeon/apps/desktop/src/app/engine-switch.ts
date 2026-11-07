import { err, ok, type Result, type Scheduler } from "@fresnel/contracts";
import type { EngineMirror, ReadonlyStore } from "../state/engine/index.ts";
import { watch } from "../state/shared/index.ts";
import type { UiStore } from "../state/ui/index.ts";
import type { DesktopIpc, EngineTarget } from "../transport/ipc.ts";
import type { CommandError } from "../views/commands.ts";

// 엔진 대상 바꾸기(W-08) 동안의 쓰기 보류. 대상을 바꾸면 셸이 살아 있는 엔진을 정상 종료 순서로 끝내고(`shutdownGraceMs`까지)
// 새 대상으로 다시 띄운다. 그 사이 옛 엔진은 쓰기를 아직 받을 수 있어서, 받은 쓰기가 옛 엔진에만 남고 새 엔진에는 없는 일이 생길 수 있다.
// 그래서 바꾸는 동안 쓰기 명령(`held()`)은 `switching`으로 거절한다. 읽기는 막지 않는다.
// 보류가 풀리는 때: 엔진 상태가 running을 벗어났다가 다시 running이 되거나 failed가 될 때, 호출이 실패했을 때, 안전 한도(grace + 연결 여유)가 지났을 때.

/** 새 엔진이 뜨고 붙는 데 주는 여유(ms). 한도까지 running이 돌아오지 않아도 보류가 영영 남지 않게 한다 */
const CONNECT_MARGIN_MS = 15_000;

export interface EngineSwitch {
  /** 쓰기 명령을 지금 거절해야 하면 true */
  held(): boolean;
  /**
   * 이 앱이 셸에 마지막으로 성공하게 보낸 대상. 이 앱 실행에서 대상을 바꾼 적이 없으면 `null`이다(셸의 대상을 모른다).
   * 셸이 대상을 따로 알려 주지 않으므로 데이터 복원 화면이 이 값으로 원격 대상을 막는다. 셸은 같은 판정을 다시 한다.
   */
  current(): EngineTarget | null;
  /**
   * 대상을 바꾼다. `graceMs`는 `l4.desktop.engine.shutdownGraceMs`다. 이미 같은 대상으로 바꾼 적이 있으면 셸이 아무 일도 하지 않으므로 보류하지 않는다.
   * 이미 바꾸는 중이면 `switching`이다.
   */
  retarget(target: EngineTarget, graceMs: number): Promise<Result<null, CommandError>>;
  dispose(): void;
}

export type EngineSwitchDeps = {
  readonly ipc: Pick<DesktopIpc, "retarget">;
  readonly engine: ReadonlyStore<EngineMirror>;
  readonly ui: UiStore;
  readonly scheduler: Scheduler;
  readonly report: (cause: unknown) => void;
};

function sameTarget(a: EngineTarget, b: EngineTarget): boolean {
  if (a.kind === "local") return b.kind === "local";
  return b.kind === "remote" && a.address === b.address;
}

export function createEngineSwitch(deps: EngineSwitchDeps): EngineSwitch {
  const state: {
    holding: boolean;
    last: EngineTarget | null;
    sawDown: boolean;
    timer: ReturnType<Scheduler["setTimeout"]> | null;
    unwatch: (() => void) | null;
  } = { holding: false, last: null, sawDown: false, timer: null, unwatch: null };

  const isHolding = (): boolean => state.holding;

  const release = (): void => {
    if (!state.holding) return;
    state.holding = false;
    if (state.timer !== null) deps.scheduler.clearTimeout(state.timer);
    state.timer = null;
    state.unwatch?.();
    state.unwatch = null;
    deps.ui.actions.setEngineSwitching(false);
  };

  return {
    held: () => state.holding,
    current: () => state.last,
    async retarget(target, graceMs) {
      if (state.holding) return err({ kind: "switching" });
      if (state.last !== null && sameTarget(state.last, target)) return ok(null);
      state.holding = true;
      state.sawDown = false;
      deps.ui.actions.setEngineSwitching(true);
      // 호출이 돌아오기 전에 엔진 상태가 바뀔 수 있어 호출 전에 구독한다
      state.unwatch = watch(
        deps.engine,
        (mirror) => mirror.engine?.kind ?? null,
        (kind) => {
          if (kind === null) return;
          // 새 엔진이 시작에 실패해 멈췄으면 보류할 이유가 없다. 풀지 않으면 다른 대상으로 바로 다시 바꿀 수 없다
          if (kind === "failed") release();
          else if (kind !== "running") state.sawDown = true;
          else if (state.sawDown) release();
        },
        deps.report,
      );
      const done = await deps.ipc.retarget(target);
      if (!done.ok) {
        release();
        return err({ kind: "failed" });
      }
      state.last = target;
      // 호출 중에 엔진이 이미 다시 올라와 풀렸을 수 있다(타입은 이를 모르므로 함수로 읽는다)
      if (isHolding()) {
        state.timer = deps.scheduler.setTimeout(release, graceMs + CONNECT_MARGIN_MS);
      }
      return ok(null);
    },
    dispose: release,
  };
}

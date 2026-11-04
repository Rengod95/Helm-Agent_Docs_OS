// 다시 시작이 필요한 일을 비우는 자리(U-02). 엔진이 이 앱 실행에서 running을 한 번 본 뒤 running이 아닌 상태를 거쳐
// running으로 돌아오면 목록을 비우고 한 번 알린다. 앱을 켜서 처음 running이 된 것은 돌아온 것이 아니다.
// 폴링하지 않는다. 엔진 거울의 `engine` 값이 바뀔 때만 보고(FS-22 `watch`), 전이는 순수 함수가 정한다.
import type { EngineMirror, ReadonlyStore } from "../state/engine/index.ts";
import { watch } from "../state/shared/index.ts";
import type { UiStore } from "../state/ui/index.ts";
import type { EngineState } from "../transport/ipc.ts";

export type ReturnStep = {
  /** 이 앱 실행에서 running을 본 적이 있는지(다음 걸음에 넘긴다) */
  readonly seenRunning: boolean;
  /** 이 걸음이 돌아온 것인지 */
  readonly returned: boolean;
};

/** 엔진 상태 한 걸음의 전이. `seenRunning`이 거짓이면 running이 되어도 돌아온 것이 아니다(첫 시작) */
export function returnStepOf(
  seenRunning: boolean,
  previous: EngineState | null,
  next: EngineState | null,
): ReturnStep {
  const running = next?.kind === "running";
  return {
    seenRunning: seenRunning || running,
    returned: seenRunning && running && previous !== null && previous.kind !== "running",
  };
}

/** 엔진 거울을 보고 돌아왔을 때 목록을 비우고 `onReturned`를 한 번 부른다. 반환값은 구독 해제 함수다 */
export function watchEngineReturn(deps: {
  readonly engine: ReadonlyStore<Pick<EngineMirror, "engine">>;
  readonly ui: UiStore;
  readonly onReturned: () => void;
  readonly report: (cause: unknown) => void;
}): () => void {
  let seenRunning = deps.engine.getState().engine?.kind === "running";
  return watch(
    deps.engine,
    (s) => s.engine,
    (next, previous) => {
      const step = returnStepOf(seenRunning, previous, next);
      seenRunning = step.seenRunning;
      if (!step.returned) return;
      deps.ui.actions.clearRestartNeeded();
      deps.onReturned();
    },
    deps.report,
  );
}

// 다시 시작이 필요한 일을 비우는 자리(U-02). 이 앱 실행에서 엔진이 떠 있었던 뒤 엔진이 내려갔다가 다시 떠서 연결까지 live가 되면
// 목록을 비우고 한 번 알린다. 앱을 켜서 처음 뜬 것은 돌아온 것이 아니다. 엔진 프로세스가 떠도 연결이 live가 아니면 아직 돌아온 것이 아니다(셸은 프로세스가 뜨자마자 running을 보낸다).
// 폴링하지 않는다. 엔진 거울의 엔진과 연결 값이 바뀔 때만 보고(FS-22 `watch`), 전이는 순수 함수가 정한다.
import type { EngineMirror, Link, ReadonlyStore } from "../state/engine/index.ts";
import { watch } from "../state/shared/index.ts";
import type { UiStore } from "../state/ui/index.ts";
import type { EngineState } from "../transport/ipc.ts";

/** 엔진 프로세스와 연결을 함께 본 단계. down: 엔진이 돌지 않는다, up: 엔진은 떴지만 연결이 아직 live가 아니다, live: 엔진이 돌고 연결도 live다 */
export type ReturnStage = "down" | "up" | "live";

function stageOf(engine: EngineState | null, linkPhase: Link["phase"]): ReturnStage {
  if (engine?.kind !== "running") return "down";
  return linkPhase === "live" ? "live" : "up";
}

export type ReturnState = {
  /** 이 앱 실행에서 엔진이 떠 있었는지(다음 걸음에 넘긴다) */
  readonly seenRunning: boolean;
  /** 떠 있던 엔진이 내려가 다시 돌아오는 중인지. 연결까지 live가 되면 돌아온 것이다 */
  readonly awaiting: boolean;
};

export type ReturnStep = ReturnState & {
  /** 이 걸음이 돌아온 것인지(연결까지 live가 된 걸음) */
  readonly returned: boolean;
};

/** 단계 한 걸음의 전이. 첫 시작은 돌아온 것이 아니다. 떠 있던 엔진이 내려간 뒤 연결까지 live가 되어야 돌아온 것이다 */
export function returnStepOf(state: ReturnState, next: ReturnStage): ReturnStep {
  if (next === "down") {
    return { seenRunning: state.seenRunning, awaiting: state.seenRunning, returned: false };
  }
  if (next === "up") {
    return { seenRunning: true, awaiting: state.awaiting, returned: false };
  }
  return { seenRunning: true, awaiting: false, returned: state.awaiting };
}

/** 엔진 거울을 보고 연결까지 돌아왔을 때 목록을 비우고 `onReturned`를 한 번 부른다. 반환값은 구독 해제 함수다 */
export function watchEngineReturn(deps: {
  readonly engine: ReadonlyStore<Pick<EngineMirror, "engine" | "link">>;
  readonly ui: UiStore;
  readonly onReturned: () => void;
  readonly report: (cause: unknown) => void;
}): () => void {
  const initial = deps.engine.getState();
  const initialStage = stageOf(initial.engine, initial.link.phase);
  let state: ReturnState = { seenRunning: initialStage !== "down", awaiting: false };
  return watch(
    deps.engine,
    (s) => stageOf(s.engine, s.link.phase),
    (next) => {
      const step = returnStepOf(state, next);
      state = { seenRunning: step.seenRunning, awaiting: step.awaiting };
      if (!step.returned) return;
      deps.ui.actions.clearRestartNeeded();
      deps.onReturned();
    },
    deps.report,
  );
}

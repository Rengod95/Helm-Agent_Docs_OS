// 구조 화면의 상태 기계. 표 자체는 wb-v3와 같고, 이 폴더는 표가 아직 없던 상태(읽는 중·오프라인·빈·안전 모드·좁은 폭·웹)만 그린다.
// ready·failure는 ?state= 값이 아니라 시나리오가 지나가는 평상 화면이다.
import type { LayerId, StageId } from "../wb-v3/data";

export const STATES = [
  { id: "safe-mode", label: "안전 모드" },
  { id: "loading", label: "읽는 중" },
  { id: "offline", label: "오프라인" },
  { id: "empty", label: "빈(내장만)" },
  { id: "narrow", label: "좁은 폭 700" },
  { id: "web", label: "웹" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export type Look = StateId | "ready" | "failure";

export const SCENARIOS = [
  { id: "reload-offline", label: "읽기 → 연결 끊김 → 다시 연결" },
  { id: "safe-restart", label: "실패: 자동 꺼짐 → 안전 모드 → 되돌아옴" },
] as const;

export interface Pick {
  row?: LayerId | undefined;
  col?: StageId | undefined;
}

export interface S {
  look: Look;
  /** 읽는 중이 끝나면 갈 곳. null이면 멈춘 상태(?state=loading). */
  then: Look | null;
  /** 읽는 중 머리 아래 한 줄. */
  busy: "safe-on" | "safe-off" | null;
  pick: Pick;
  focus: string | null;
  /** 다시 연결한 뒤에는 시나리오가 또 끊지 않는다. */
  reconnected: boolean;
}

const base: S = {
  look: "ready",
  then: null,
  busy: null,
  pick: { row: "L2" },
  focus: null,
  reconnected: false,
};

export function initial(state: StateId): S {
  switch (state) {
    case "safe-mode":
      return { ...base, look: state, pick: {} };
    case "loading":
    case "empty":
      return { ...base, look: state, pick: {} };
    case "offline":
      return { ...base, look: state };
    case "narrow":
      return { ...base, look: state, pick: { col: "tool" } };
    case "web":
      return { ...base, look: state, pick: {}, focus: "acme-notes" };
  }
}

/** 시나리오의 단계별 화면. &step=n&hold=1이면 그 단계에 멈춘다. 없으면 0번에서 시작해 버튼과 타이머로 간다. */
export const STEPS: Record<string, readonly S[]> = {
  "reload-offline": [
    { ...base, look: "loading", then: "ready" },
    base,
    { ...base, look: "offline" },
    { ...base, look: "loading", then: "ready", reconnected: true },
    { ...base, reconnected: true },
  ],
  "safe-restart": [
    { ...base, look: "failure", pick: {} },
    { ...base, look: "loading", then: "safe-mode", busy: "safe-on", pick: {} },
    { ...base, look: "safe-mode", pick: {} },
    { ...base, look: "loading", then: "failure", busy: "safe-off", pick: {} },
    { ...base, look: "failure", pick: {} },
  ],
};

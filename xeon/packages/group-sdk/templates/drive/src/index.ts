import type { DriveCommand, StepResult } from "@fresnel/contracts/extensions";
import { defineGroup, groupManifest, type GroupModule } from "@fresnel/group-sdk";
import manifestJson from "../.fresnel-plugin/plugin.json" with { type: "json" };
import { settings } from "./settings.ts";
import { initialState, stateSchema, type State } from "./state.ts";

/** 골격의 단계 수. 정책 값이 아니라 재생 시험이 끝나는 자리를 보이려는 값이다 */
const ROUNDS = 3;

/**
 * 단계 명령. 턴의 결과가 돌아왔으면 그 결과로 커밋하고, 끝났으면 주도권을 유지한 채 기다리고, 아니면 턴을 낸다.
 * 재생 규율: 멈춤과 진행은 커밋된 state와 직전 결과로만 정한다. 임대의 남은 예산(input.budget)은 임대마다 달라서 쓰지 않는다.
 * Date.now, Math.random, 직접 I/O를 쓰지 않는다
 */
function stepOf(state: Readonly<State>, last: StepResult | null): DriveCommand<State> {
  if (last?.kind === "ok" && last.of === "turn") {
    const round = state.round + 1;
    const phase = last.value.status === "completed" && round < ROUNDS ? "run" : "done";
    return { do: "commit", state: { ...state, round, phase }, next: { do: "yield" } };
  }
  if (state.phase === "done") return { do: "yield" };
  // requestId는 커밋된 상태에서 정한다. 빼면 X가 임대 id로 만들어 재생 뒤 턴이 새로 난다(ADR-0015 §3.4)
  return {
    do: "turn",
    input: { kind: "user", content: `__TITLE__ 단계 ${state.round}` },
    requestId: `__ID__:round:${state.round}`,
  };
}

const group: GroupModule = defineGroup<State>({
  manifest: groupManifest(manifestJson),
  state: { schema: stateSchema, initial: initialState, version: 1 },
  settings,
  setup(g) {
    // 관찰 자리(tap). 커밋은 턴당 한 번만 하고, 효과는 commit·record·post만 낸다
    g.on("boundary.settle.after", () => {});
    g.drive(({ state, last }) => Promise.resolve(stepOf(state, last)), { limits: { maxTurns: 4 } });
  },
});

export default group;

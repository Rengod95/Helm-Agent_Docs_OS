import { defineGroup, groupManifest, type GroupModule } from "@xeon/group-kit";
import manifestJson from "../.xeon-plugin/plugin.json" with { type: "json" };
import { settings } from "./settings.ts";
import { initialState, stateSchema, type State } from "./state.ts";

/** 골격의 단계 수. 정책 값이 아니라 재생 시험이 끝나는 자리를 보이려는 값이다 */
const ROUNDS = 3;

const group: GroupModule = defineGroup<State>({
  manifest: groupManifest(manifestJson),
  state: { schema: stateSchema, initial: initialState, version: 1 },
  settings,
  setup(g) {
    // 관찰 자리(tap). 커밋은 turn당 한 번만 하고, 효과는 commit·record·post만 낸다
    g.on("boundary.settle.after", () => {});
    g.drive(
      async (loop, st) => {
        // 재생 규율: 멈춤과 진행은 커밋된 st로만 정한다. 임대의 남은 예산(loop.budget)은 임대마다 달라서 쓰지 않는다.
        // Date.now, Math.random, 직접 I/O를 쓰지 않는다
        if (st.phase === "done") return;
        // requestId는 커밋된 상태에서 정한다. 빼면 X가 임대 id로 만들어 재생 뒤 턴이 새로 난다(ADR-0015 §3.4)
        const out = await loop.turn({
          input: { kind: "user", content: `__TITLE__ 단계 ${st.round}` },
          requestId: `__ID__:round:${st.round}`,
        });
        const round = st.round + 1;
        await g.commit({
          ...st,
          round,
          phase: out.status === "completed" && round < ROUNDS ? "run" : "done",
        });
      },
      { limits: { maxTurns: 4 } },
    );
  },
});

export default group;

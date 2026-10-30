import { defineGroup, groupManifest, type GroupModule } from "@xeon/group-kit";
import manifestJson from "../.xeon-plugin/plugin.json" with { type: "json" };
import { settings } from "./settings.ts";
import { initialState, stateSchema, type State } from "./state.ts";

const group: GroupModule = defineGroup<State>({
  manifest: groupManifest(manifestJson),
  state: { schema: stateSchema, initial: initialState, version: 1 },
  settings,
  setup(g) {
    // tap 지점: 관찰만 한다. 반환값은 쓰지 않는다. 턴마다 커밋 한 번과 기록 한 번을 낸다
    g.on("boundary.settle.after", async (p) => {
      const next = { count: g.state().count + 1 };
      await g.commit(next);
      await g.record("grp.__ID__.turn.counted", { type: "turn", id: p.turnId }, next);
    });
  },
});

export default group;

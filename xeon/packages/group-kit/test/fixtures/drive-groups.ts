import { Type } from "typebox";
import { defineGroup, type GroupModule } from "../../src/index.ts";
import { groupManifestOf } from "../support/manifests.ts";

const CounterSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });
const COUNTER = { schema: CounterSchema, initial: { n: 0 }, version: 1 } as const;
const STEPS = 3;

/** EV-09 좋은 예: drive가 상태 문서만 읽고 쓴다. 호출마다 마지막 커밋 상태에서 이어 간다 */
export function goodDriveGroup(): GroupModule {
  return defineGroup<{ readonly n: number }>({
    manifest: groupManifestOf({ name: "good-drive", usesDrive: true }),
    state: COUNTER,
    setup(g) {
      g.drive(async (loop, state) => {
        if (state.n >= STEPS) return;
        await loop.turn({ input: { kind: "user", content: `step ${state.n}` } });
        await g.commit({ n: state.n + 1 });
      });
    },
  });
}

/** EV-09 나쁜 예: drive 밖 클로저 카운터가 진행을 정한다. 재호출하면 처음과 다르게 움직인다 */
export function badDriveGroup(): GroupModule {
  let calls = 0;
  return defineGroup<{ readonly n: number }>({
    manifest: groupManifestOf({ name: "bad-drive", usesDrive: true }),
    state: COUNTER,
    setup(g) {
      g.drive(async (loop) => {
        calls += 1;
        if (calls > STEPS) return;
        await loop.turn({ input: { kind: "user", content: `step ${calls}` } });
        await g.commit({ n: calls });
      });
    },
  });
}

/** 커밋을 하지 않는 drive. 재생으로 확인할 것이 없다 */
export function silentDriveGroup(): GroupModule {
  return defineGroup({
    manifest: groupManifestOf({ name: "silent-drive", usesDrive: true }),
    setup(g) {
      g.drive(async (loop) => {
        await loop.turn({ input: { kind: "user", content: "quiet" } });
      });
    },
  });
}

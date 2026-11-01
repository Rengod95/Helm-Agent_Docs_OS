import type { ExtensionEntry, ScopeApi } from "@xeon/contracts/extensions";
import { Type } from "typebox";
import { defineGroup, type GroupModule } from "../../src/index.ts";
import { realHostAccess, wrap } from "../../src/wrap.ts";
import { groupManifestOf } from "../support/manifests.ts";
import type { CountingReplayHarness } from "../support/replay-harness.ts";

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

const EFFECT_STEPS = 3;
const EFFECT_STATE = { schema: CounterSchema, initial: { n: 0 }, version: 1 } as const;

/**
 * 효과를 내는 drive 그룹. 단계마다 turn, spawn, post, delegate를 한 번씩 내고 상태를 커밋한다.
 * `keys`가 요청 키를 정한다: 좋은 예는 커밋된 상태에서, 나쁜 예는 drive 밖 클로저 카운터에서 만든다.
 * delegate는 harness가 가진 가짜 위임 서비스와 thread를 호출 문맥으로 넣어 부른다
 */
function effectGroup(
  name: string,
  harness: CountingReplayHarness,
  keys: (state: number) => string,
): GroupModule {
  const manifest = groupManifestOf({ name, usesDrive: true, usesPost: true });
  const entry: ExtensionEntry = ({ scope }) => {
    scope(name, { state: EFFECT_STATE }, (api: ScopeApi<{ readonly n: number }>) => {
      const g = wrap(api, { manifest, state: EFFECT_STATE }, (target) => ({
        ...realHostAccess(target),
        agents: () => harness.agents(),
        callContext: () => {
          const threadId = harness.thread();
          return threadId === undefined
            ? undefined
            : { kind: "drive", threadId, signal: new AbortController().signal };
        },
      }));
      g.drive(async (loop, state) => {
        if (state.n >= EFFECT_STEPS) return;
        const key = keys(state.n);
        await loop.turn({ input: { kind: "user", content: key }, requestId: `${key}:turn` });
        await loop.spawn({ agent: "helper", task: "t", requestId: `${key}:spawn` });
        await g.post({ kind: "user", content: key }, { requestId: `${key}:post`, when: "next" });
        await g.delegate({ agent: "helper", task: "t", requestId: `${key}:delegate` });
        await g.commit({ n: state.n + 1 });
      });
    });
  };
  return { manifest, entry, stateUpcasters: [], stateVersion: 1 };
}

/** 요청 키가 커밋된 상태 값에서 나온다. 재생해도 같은 키라 효과가 한 번이다 */
export function onceEffectGroup(harness: CountingReplayHarness): GroupModule {
  return effectGroup("once-effects", harness, (n) => `fx:${n}`);
}

/** 요청 키가 클로저 카운터에서 나온다. 끊고 다시 불리면 새 키라 효과가 두 번 난다. 이벤트열은 같다 */
export function doubledEffectGroup(harness: CountingReplayHarness): GroupModule {
  let calls = 0;
  return effectGroup("doubled-effects", harness, () => {
    calls += 1;
    return `fx:${calls}`;
  });
}

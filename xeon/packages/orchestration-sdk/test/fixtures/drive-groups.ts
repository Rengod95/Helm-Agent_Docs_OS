import type { AskCard, ExtensionEntry, RegistrationApi } from "@fresnel/contracts/extensions";
import { Type } from "typebox";
import { defineOrchestration, type OrchestrationModule } from "../../src/index.ts";
import { realHostAccess, wrap } from "../../src/wrap.ts";
import { orchestrationManifestOf } from "../support/manifests.ts";
import type { CountingReplayHarness } from "../support/replay-harness.ts";
import { turnFinished } from "../support/steps.ts";

const CounterSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });
const COUNTER = { schema: CounterSchema, initial: { n: 0 }, version: 1 } as const;
const STEPS = 3;

/**
 * EV-09 좋은 예: 단계 함수는 커밋된 상태와 직전 결과만 보고 명령을 고른다. 재호출하면 마지막 커밋 상태에서 이어 간다.
 * 턴의 요청 id는 커밋된 상태에서 정한다(엔진이 만든 기본 id는 단계마다 겹칠 수 있다)
 */
export function goodDriveOrchestration(): OrchestrationModule {
  return defineOrchestration<{ readonly n: number }>({
    manifest: orchestrationManifestOf({ name: "good-drive", drives: true }),
    state: COUNTER,
    setup(g) {
      g.drive(async ({ state, last }) => {
        if (turnFinished(last)) {
          return { do: "commit", state: { n: state.n + 1 }, next: { do: "yield" } };
        }
        if (state.n >= STEPS) return { do: "yield" };
        return {
          do: "turn",
          input: { kind: "user", content: `step ${state.n}` },
          requestId: `good:${state.n}`,
        };
      });
    },
  });
}

/** EV-09 나쁜 예: 단계 함수 밖 클로저 카운터가 진행을 정한다. 재호출하면 처음과 다르게 움직인다 */
export function badDriveOrchestration(): OrchestrationModule {
  let calls = 0;
  return defineOrchestration<{ readonly n: number }>({
    manifest: orchestrationManifestOf({ name: "bad-drive", drives: true }),
    state: COUNTER,
    setup(g) {
      g.drive(async ({ last }) => {
        if (turnFinished(last)) {
          return { do: "commit", state: { n: calls }, next: { do: "yield" } };
        }
        calls += 1;
        if (calls > STEPS) return { do: "yield" };
        return {
          do: "turn",
          input: { kind: "user", content: `step ${calls}` },
          requestId: `bad:${calls}`,
        };
      });
    },
  });
}

/** 커밋을 하지 않는 drive. 재생으로 확인할 것이 없다 */
export function silentDriveOrchestration(): OrchestrationModule {
  return defineOrchestration({
    manifest: orchestrationManifestOf({ name: "silent-drive", drives: true }),
    setup(g) {
      g.drive(async ({ last }) => {
        if (turnFinished(last)) return { do: "yield" };
        return { do: "turn", input: { kind: "user", content: "quiet" } };
      });
    },
  });
}

const EFFECT_STEPS = 3;
const EFFECT_STATE = { schema: CounterSchema, initial: { n: 0 }, version: 1 } as const;

/**
 * 효과를 내는 drive 그룹. 단계마다 post, delegate(단계 함수 안에서 직접 부른다), turn, spawn 명령을 한 번씩 내고 커밋한다.
 * `keys`가 post와 delegate의 요청 키를 정한다. 두 효과는 이벤트 열에 남지 않으므로(가짜 큐와 위임 서비스) 키가 바뀌어도
 * 이벤트열은 같고 효과만 두 번 난다. turn과 spawn의 요청 키는 커밋된 상태에서 정한다(이벤트 열에 남는다).
 * delegate는 harness가 가진 가짜 위임 서비스와 thread를 호출 문맥으로 넣어 부른다
 */
function effectGroup(
  name: string,
  harness: CountingReplayHarness,
  keys: (state: number) => string,
): OrchestrationModule {
  const manifest = orchestrationManifestOf({ name, drives: true, usesPost: true });
  const entry: ExtensionEntry = ({ register }) => {
    register(name, { state: EFFECT_STATE }, (api: RegistrationApi<{ readonly n: number }>) => {
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
      g.drive(async ({ state, last }) => {
        if (state.n >= EFFECT_STEPS) return { do: "yield" };
        if (last?.kind === "ok" && last.of === "turn") {
          return { do: "spawn", agent: "helper", task: "t", requestId: `fx:${state.n}:spawn` };
        }
        if (last?.kind === "ok" && last.of === "spawn") {
          return { do: "commit", state: { n: state.n + 1 }, next: { do: "yield" } };
        }
        const key = keys(state.n);
        await g.post({ kind: "user", content: key }, { requestId: `${key}:post`, when: "next" });
        await g.delegate({ agent: "helper", task: "t", requestId: `${key}:delegate` });
        return {
          do: "turn",
          input: { kind: "user", content: key },
          requestId: `fx:${state.n}:turn`,
        };
      });
    });
  };
  return { manifest, entry, stateUpcasters: [], stateVersion: 1 };
}

/** 요청 키가 커밋된 상태 값에서 나온다. 재생해도 같은 키라 효과가 한 번이다 */
export function onceEffectGroup(harness: CountingReplayHarness): OrchestrationModule {
  return effectGroup("once-effects", harness, (n) => `fx:${n}`);
}

/**
 * post와 delegate의 요청 키가 클로저 카운터에서 나온다. 끊고 다시 불리면 새 키라 효과가 두 번 난다.
 * 이벤트열은 같다(두 효과는 이벤트를 남기지 않는다)
 */
export function doubledEffectGroup(harness: CountingReplayHarness): OrchestrationModule {
  let calls = 0;
  return effectGroup("doubled-effects", harness, () => {
    calls += 1;
    return `fx:${calls}`;
  });
}

const ASK_CARD: AskCard = {
  questions: [
    {
      id: "q1",
      header: "Plan",
      text: "Proceed?",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      multiSelect: false,
      allowFreeText: false,
    },
  ],
};

/**
 * 사람 확인을 지나가는 drive 그룹(Y7). 단계마다 `loop.ask`로 묻고, 답이 오면 그 답을 센 수로 커밋한다.
 * ask의 요청 id는 커밋된 상태에서 정하므로 재호출하면 같은 id로 다시 물어 기록된 답을 돌려받는다.
 */
export function askingDriveOrchestration(): OrchestrationModule {
  return defineOrchestration<{ readonly n: number }>({
    manifest: orchestrationManifestOf({ name: "asking-drive", drives: true }),
    state: COUNTER,
    setup(g) {
      g.drive(async ({ state, last }) => {
        if (last?.kind === "ask") {
          return { do: "commit", state: { n: state.n + 1 }, next: { do: "yield" } };
        }
        if (state.n >= STEPS) return { do: "yield" };
        return { do: "ask", card: ASK_CARD, requestId: `ask:${state.n}` };
      });
    },
  });
}

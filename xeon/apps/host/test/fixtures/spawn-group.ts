import {
  defineManifest,
  LoopPortKey,
  type DriveCommand,
  type LoopPort,
  type SpawnOutcome,
} from "@fresnel/contracts/extensions";
import { Type, type Static } from "typebox";
import { hostOf } from "@fresnel/ext-host";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { realTapeClock } from "./tape-host.ts";
import type { AssembleOptions, HostPluginModule } from "../../src/types.ts";

// drive가 loop.spawn으로 자식 N개를 띄우고 결과를 상태에 남기는 시험용 그룹과, 자식마다 보고 하나를 주는 모델 테이프.
// 실제 엔진에서 loop.spawn이 core-agents로 이어지는 길(HOST·L1.loop §4.8)을 시험한다.

export const SPAWN_CHILD_COUNT = 3;

export function childReport(index: number): string {
  return `report from child ${String(index)}`;
}

/** 자식마다 보고 하나. 부모는 모델을 부르지 않는다(자식이 주 모델로 폴백한다) */
export function childModels(
  id: string,
  count: number,
): NonNullable<AssembleOptions["buildModels"]> {
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape(
          id,
          Array.from({ length: count }, (_, index) => ({
            role: "main" as const,
            label: `child ${String(index)} reports`,
            response: {
              type: "message" as const,
              content: [t.text(childReport(index))],
              stopReason: "stop" as const,
            },
          })),
        ),
        { clock: realTapeClock() },
      ),
    ),
  );
}

const SPAWN_GROUP_NAME = "spawn-group";

const StateSchema = Type.Object({ answers: Type.Array(Type.String()) });
type SpawnGroupState = Static<typeof StateSchema>;
const INITIAL_STATE: SpawnGroupState = { answers: [] };

/** `index`번째 자식을 띄우는 명령. 요청 id가 순서를 정하므로 재실행돼도 같은 자식이다 */
function childCommand(index: number): DriveCommand<SpawnGroupState> {
  return {
    do: "spawn",
    agent: "explorer",
    task: `look at ${String(index)}`,
    requestId: `${SPAWN_GROUP_NAME}:child:${String(index)}`,
  };
}

export interface SpawnGroupProbe {
  /** drive가 받은 자식 결과를 순서대로 */
  readonly outcomes: SpawnOutcome[];
  /** 단계 함수가 불린 횟수 */
  calls: number;
  /** 첫 호출을 받은 thread. 자식 thread에도 임대가 부여되므로 이 thread의 호출만 자식을 띄운다 */
  mainThread: string | undefined;
  /** 마지막 자식 결과를 상태에 커밋하는 명령을 돌려줄 때 이행된다 */
  readonly committed: Promise<void>;
}

/** 임대를 받으면 `count`개 자식을 차례로 띄우고 답을 상태에 커밋한다 */
export function spawnGroup(count: number): {
  readonly module: HostPluginModule;
  readonly probe: SpawnGroupProbe;
} {
  const committed = Promise.withResolvers<void>();
  const probe: SpawnGroupProbe = {
    outcomes: [],
    calls: 0,
    mainThread: undefined,
    committed: committed.promise,
  };
  const manifest = defineManifest({
    schemaVersion: 2,
    name: SPAWN_GROUP_NAME,
    version: "0.1.0",
    displayName: "Spawn group",
    description: "Test group whose drive spawns child agents with loop.spawn.",
    defaultEnabled: true,
    entry: "./src/index.ts",
    group: {},
    plugins: [{ layer: "L3", hooks: [], drives: true }],
    trust: { level: "builtin" },
  });
  return {
    probe,
    module: {
      manifest,
      extension: ({ register }) => {
        register(
          SPAWN_GROUP_NAME,
          { state: { schema: StateSchema, initial: INITIAL_STATE, version: 1 } },
          (g) => {
            // 순서가 의미다: 자식은 하나씩 끝나야 테이프가 순서대로 소비된다 (L1.loop.spec §4.8).
            // 자식 결과는 `last`로 받고, 받은 답마다 상태에 커밋해 다음 자식을 답 수로 정한다. 클로저에 진행 상태를 두지 않는다
            g.drive(
              async ({ state, last }) => {
                probe.calls += 1;
                const thread = hostOf(g).callContext()?.threadId;
                probe.mainThread ??= thread;
                if (thread !== probe.mainThread) return { do: "yield" };
                if (last?.kind === "ok" && last.of === "spawn") {
                  probe.outcomes.push(last.value);
                  const answers = [...state.answers, last.value.answer ?? ""];
                  if (answers.length >= count) {
                    committed.resolve();
                    return { do: "commit", state: { answers }, next: { do: "yield" } };
                  }
                  return {
                    do: "commit",
                    state: { answers },
                    next: childCommand(answers.length),
                  };
                }
                if (last !== null || state.answers.length >= count) return { do: "yield" };
                return childCommand(state.answers.length);
              },
              { limits: { maxSpawns: count, maxTurns: 1 } },
            );
          },
        );
      },
    },
  };
}

/** 시험이 실제 엔진의 `fresnel.loop` 포트를 직접 부르려고 붙잡는 확장 */
export function loopPortProbe(captured: { port: LoopPort | undefined }): HostPluginModule {
  return {
    manifest: defineManifest({
      schemaVersion: 2,
      name: "loop-port-probe",
      version: "0.1.0",
      displayName: "Loop port probe",
      description: "Captures fresnel.loop for a test.",
      defaultEnabled: true,
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: [] }],
      trust: { level: "builtin" },
    }),
    extension: ({ register }) => {
      register("loop-port-probe", {}, (g) => {
        captured.port = hostOf(g).port(LoopPortKey);
      });
    },
  };
}

import {
  defineManifest,
  LoopPortKey,
  type LoopPort,
  type SpawnOutcome,
} from "@xeon/contracts/extensions";
import { Type, type Static } from "typebox";
import { hostOf } from "@xeon/ext-host";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
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
const INITIAL_STATE: Static<typeof StateSchema> = { answers: [] };

export interface SpawnGroupProbe {
  /** drive가 받은 자식 결과를 순서대로 */
  readonly outcomes: SpawnOutcome[];
  /** drive 함수가 불린 횟수 */
  calls: number;
  /** 첫 호출을 받은 thread. 자식 thread에도 임대가 부여되므로 이 thread의 호출만 자식을 띄운다 */
  mainThread: string | undefined;
  /** drive가 자식 결과를 상태에 커밋한 뒤 이행된다 */
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
    schemaVersion: 1,
    name: SPAWN_GROUP_NAME,
    version: "0.1.0",
    displayName: "Spawn group",
    description: "Test group whose drive spawns child agents with loop.spawn.",
    defaultEnabled: true,
    layer: "L3",
    kind: "group",
    entry: "./src/index.ts",
    points: [],
    usesDrive: true,
    trust: { level: "builtin" },
  });
  return {
    probe,
    module: {
      manifest,
      extension: ({ scope }) => {
        scope(
          SPAWN_GROUP_NAME,
          { state: { schema: StateSchema, initial: INITIAL_STATE, version: 1 } },
          (g) => {
            g.drive(
              async (loop, state) => {
                probe.calls += 1;
                const thread = hostOf(g).callContext()?.threadId;
                probe.mainThread ??= thread;
                if (thread !== probe.mainThread || state.answers.length >= count) return;
                const answers: string[] = [];
                for (let index = 0; index < count; index += 1) {
                  // 순서가 의미다: 자식은 하나씩 끝나야 테이프가 순서대로 소비된다
                  // oxlint-disable-next-line no-await-in-loop -- 자식을 차례로 띄운다 (L1.loop.spec §4.8)
                  const outcome = await loop.spawn({
                    agent: "explorer",
                    task: `look at ${String(index)}`,
                    requestId: `${SPAWN_GROUP_NAME}:child:${String(index)}`,
                  });
                  probe.outcomes.push(outcome);
                  answers.push(outcome.answer ?? "");
                }
                await g.commit({ answers });
                committed.resolve();
              },
              { limits: { maxSpawns: count, maxTurns: 1 } },
            );
          },
        );
      },
    },
  };
}

/** 시험이 실제 엔진의 `xeon.loop` 포트를 직접 부르려고 붙잡는 확장 */
export function loopPortProbe(captured: { port: LoopPort | undefined }): HostPluginModule {
  return {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "loop-port-probe",
      version: "0.1.0",
      displayName: "Loop port probe",
      description: "Captures xeon.loop for a test.",
      defaultEnabled: true,
      layer: "plugin",
      kind: "plugin",
      entry: "./src/index.ts",
      points: [],
      usesDrive: false,
      trust: { level: "builtin" },
    }),
    extension: ({ scope }) => {
      scope("loop-port-probe", {}, (g) => {
        captured.port = hostOf(g).port(LoopPortKey);
      });
    },
  };
}

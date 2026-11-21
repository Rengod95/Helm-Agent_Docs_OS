import { Type } from "typebox";
import type { IdFactory, StepId } from "@fresnel/contracts/conversation";
import {
  defineManifest,
  type ExtensionEntry,
  type ExtensionManifest,
} from "@fresnel/contracts/extensions";
import type { ExtensionUnit } from "@fresnel/ext-host";

// M1 걸어 다니는 골격의 테스트용 그룹: on(turn_end), post(followUp 한 번), drive(turn 명령 몇 번), scope(켜기·끄기).

export const TEST_ORCHESTRATION_ID = "test-group";
export const TEST_NOTE_KIND = "grp.test-group.note.recorded";

const TEST_ORCHESTRATION_MANIFEST: ExtensionManifest = defineManifest({
  schemaVersion: 2,
  name: TEST_ORCHESTRATION_ID,
  version: "0.1.0",
  entry: "./index.ts",
  defaultEnabled: false,
  plugins: [
    {
      layer: "L3",
      hooks: ["boundary.step.after"],
      usesPost: true,
      drives: true,
      recordKinds: [
        {
          kind: TEST_NOTE_KIND,
          version: 1,
          description: "A note the test group leaves at each step boundary.",
          payload: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      ],
    },
  ],
  orchestration: {},
  trust: { level: "builtin" },
});

export interface TestOrchestrationProbe {
  /** turn_end 핸들러가 본 단계 */
  readonly turnEnds: StepId[];
  /** drive 단계가 돌려준 turn 명령 수 */
  driveCalls: number;
}

export interface TestOrchestrationOptions {
  readonly ids: IdFactory;
  readonly driveTurns?: number;
  readonly postFollowUp?: boolean;
  readonly enabled?: boolean;
}

const StateSchema = Type.Object({ count: Type.Integer({ minimum: 0 }) });

export function createTestOrchestration(options: TestOrchestrationOptions): {
  readonly unit: ExtensionUnit;
  readonly probe: TestOrchestrationProbe;
} {
  const probe: TestOrchestrationProbe = { turnEnds: [], driveCalls: 0 };
  const flags = { posted: false };
  const driveTurns = options.driveTurns ?? 0;
  const entry: ExtensionEntry = ({ manifest, register }) => {
    register(
      manifest.name,
      { state: { schema: StateSchema, initial: { count: 0 }, version: 1 } },
      (g) => {
        g.on("boundary.step.after", async (payload, current, ctx) => {
          probe.turnEnds.push(payload.stepId);
          if (options.postFollowUp === true && !flags.posted) {
            flags.posted = true;
            await g.post(
              { kind: "user", content: "group follow up" },
              { when: "followUp", requestId: `group:${payload.stepId}` },
            );
          }
          return {
            entries: [
              ...current.entries,
              {
                id: options.ids.next("evt"),
                kind: TEST_NOTE_KIND,
                version: 1,
                threadId: ctx.threadId,
                turnId: null,
                stepId: payload.stepId,
                causationId: null,
                correlationId: null,
                payload: { text: `step ${payload.stepIndex}` },
                durable: true,
              },
            ],
          };
        });
        if (driveTurns > 0) {
          g.drive(async ({ state, last }) => {
            // 한 호출은 turn 하나다. turn이 끝나면 상태를 올리고 다음 경계까지 쉰다
            if (last?.kind === "ok" && last.of === "turn") {
              return { do: "commit", state: { count: state.count + 1 }, next: { do: "yield" } };
            }
            if (state.count >= driveTurns) return { do: "yield" };
            probe.driveCalls += 1;
            return {
              do: "turn",
              input: { kind: "user", content: `drive turn ${state.count}` },
            };
          });
        }
      },
    );
  };
  return {
    unit: {
      manifest: TEST_ORCHESTRATION_MANIFEST,
      entry,
      loadIndex: 7,
      builtin: false,
      initialEnabled: options.enabled ?? true,
    },
    probe,
  };
}

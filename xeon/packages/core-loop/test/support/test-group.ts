import { Type } from "typebox";
import type { IdFactory, StepId } from "@xeon/contracts/conversation";
import {
  defineManifest,
  type ExtensionEntry,
  type ExtensionManifest,
} from "@xeon/contracts/extensions";
import type { ExtensionUnit } from "@xeon/ext-host";

// M1 걸어 다니는 골격의 테스트용 그룹: on(turn_end), post(followUp 한 번), drive(loop.turn 몇 번), scope(켜기·끄기).

export const TEST_GROUP_ID = "test-group";
export const TEST_NOTE_KIND = "grp.test-group.note.recorded";

const TEST_GROUP_MANIFEST: ExtensionManifest = defineManifest({
  schemaVersion: 1,
  name: TEST_GROUP_ID,
  version: "0.1.0",
  layer: "L3",
  kind: "group",
  entry: "./index.ts",
  defaultEnabled: false,
  points: ["turn_end"],
  usesPost: true,
  usesDrive: true,
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
  trust: { level: "builtin" },
});

export interface TestGroupProbe {
  /** turn_end 핸들러가 본 단계 */
  readonly turnEnds: StepId[];
  /** drive 함수가 부른 loop.turn 수 */
  driveCalls: number;
}

export interface TestGroupOptions {
  readonly ids: IdFactory;
  readonly driveTurns?: number;
  readonly postFollowUp?: boolean;
  readonly enabled?: boolean;
}

const StateSchema = Type.Object({ count: Type.Integer({ minimum: 0 }) });

export function createTestGroup(options: TestGroupOptions): {
  readonly unit: ExtensionUnit;
  readonly probe: TestGroupProbe;
} {
  const probe: TestGroupProbe = { turnEnds: [], driveCalls: 0 };
  const flags = { posted: false };
  const driveTurns = options.driveTurns ?? 0;
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(
      manifest.name,
      { state: { schema: StateSchema, initial: { count: 0 }, version: 1 } },
      (g) => {
        g.on("turn_end", async (payload, current, ctx) => {
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
          g.drive(async (loop, state) => {
            if (state.count >= driveTurns) return;
            probe.driveCalls += 1;
            await loop.turn({ input: { kind: "user", content: `drive turn ${state.count}` } });
            await g.commit({ count: state.count + 1 });
          });
        }
      },
    );
  };
  return {
    unit: {
      manifest: TEST_GROUP_MANIFEST,
      entry,
      loadIndex: 7,
      builtin: false,
      initialEnabled: options.enabled ?? true,
    },
    probe,
  };
}

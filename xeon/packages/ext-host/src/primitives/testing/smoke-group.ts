import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import {
  defineManifest,
  type ExtensionEntry,
  type ExtensionManifest,
  type ScopeApi,
} from "@xeon/contracts/extensions";
import { Type } from "typebox";
import type { ExtensionUnit } from "../host.ts";

/**
 * M1 스모크 테스트 그룹의 매니페스트. F.extensions.plan의 test/extensions/fixtures/smoke-group.manifest.json과
 * 같은 내용이다(X.primitives.plan P-21). 상태와 drive를 쓰려고 usesPost·usesDrive·recordKinds를 선언한다
 */
export const SMOKE_GROUP_MANIFEST: ExtensionManifest = defineManifest({
  schemaVersion: 1,
  name: "smoke-group",
  version: "0.1.0",
  displayName: "Smoke group",
  description: "M1 walking-skeleton smoke group. Uses on(tool_call, turn_end), post and drive.",
  defaultEnabled: true,
  layer: "L3",
  kind: "group",
  entry: "./src/index.ts",
  points: ["tool_call", "turn_end"],
  usesPost: true,
  usesDrive: true,
  recordKinds: [
    {
      kind: "grp.smoke-group.note.recorded",
      version: 1,
      description: "A note the smoke group leaves for other groups.",
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

export interface SmokeGroupOptions {
  readonly ids: IdFactory;
  /** tool_call에서 거부할 도구 이름. 기본 "danger" */
  readonly denyTool?: string;
  /** drive가 loop.turn을 부를 횟수 상한(상태 count가 이 값이 되면 멈춘다). 기본 1 */
  readonly driveTurns?: number;
  readonly loadIndex?: number;
  /** setup 안에서 더 할 일. 예: storageOf(g)로 확장 전용 테이블을 정의한다(X.operations.plan O-16) */
  readonly extend?: (g: ScopeApi<SmokeState>) => void;
}

interface SmokeState {
  readonly count: number;
}

const SmokeStateSchema = Type.Object({ count: Type.Integer({ minimum: 0 }) });

/** 스모크 그룹이 한 일을 시험이 볼 수 있게 모아 둔다 */
export interface SmokeGroupProbe {
  readonly deniedCalls: string[];
  readonly turnEndThreads: ThreadId[];
}

export function createSmokeGroup(options: SmokeGroupOptions): {
  readonly unit: ExtensionUnit;
  readonly probe: SmokeGroupProbe;
} {
  const denyTool = options.denyTool ?? "danger";
  const driveTurns = options.driveTurns ?? 1;
  const probe: SmokeGroupProbe = { deniedCalls: [], turnEndThreads: [] };

  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(
      manifest.name,
      { state: { schema: SmokeStateSchema, initial: { count: 0 }, version: 1 } },
      (g) => {
        g.on("tool_call", (payload) => {
          if (payload.toolName !== denyTool) return undefined;
          probe.deniedCalls.push(payload.toolCallId);
          return { block: true, reason: "smoke group denies this tool" };
        });
        g.on("turn_end", async (payload, current, ctx) => {
          probe.turnEndThreads.push(ctx.threadId);
          await g.post(
            { kind: "user", content: "smoke follow up" },
            { when: "followUp", requestId: `smoke:${payload.stepId}` },
          );
          const record = {
            groupId: manifest.name,
            kind: "grp.smoke-group.note.recorded",
            version: 1,
            subject: { type: "step", id: payload.stepId },
            payload: { text: `step ${payload.stepIndex}` },
          };
          return {
            entries: [
              ...current.entries,
              {
                id: options.ids.next("evt"),
                kind: "grp.smoke-group.note.recorded",
                version: 1,
                threadId: ctx.threadId,
                turnId: null,
                stepId: payload.stepId,
                causationId: null,
                correlationId: null,
                payload: record,
                durable: true,
              },
            ],
          };
        });
        g.drive(
          async (loop, state) => {
            if (state.count >= driveTurns) return;
            await loop.turn({ input: { kind: "user", content: "smoke drive turn" } });
            await g.commit({ count: state.count + 1 });
          },
          { limits: { maxTurns: 4, maxSpawns: 0 } },
        );
        options.extend?.(g);
      },
    );
  };

  return {
    unit: {
      manifest: SMOKE_GROUP_MANIFEST,
      entry,
      loadIndex: options.loadIndex ?? 0,
      builtin: true,
    },
    probe,
  };
}

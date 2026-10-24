import { defineManifest, type ExtensionEntry, type StateDecl } from "@xeon/contracts/extensions";
import { Type } from "typebox";
import { defineGroup } from "../define-group.ts";
import type { GroupApi, GroupManifest, GroupModule } from "../types.ts";

/**
 * M1 테스트 그룹의 매니페스트(L3.group-kit.plan G-01). F.extensions.plan의
 * fixtures/smoke-group.manifest.json과 같은 이름·지점·선언을 쓴다.
 * M2(G-16)부터 defineGroup으로 만든다.
 */
export const SMOKE_GROUP_MANIFEST: GroupManifest = defineManifest({
  schemaVersion: 1,
  name: "smoke-group",
  version: "0.1.0",
  displayName: "Smoke group",
  description: "M1 walking-skeleton test group. Uses on(tool_call, turn_end), post and drive.",
  defaultEnabled: true,
  layer: "L3",
  kind: "group",
  entry: "./src/testing/smoke-group.ts",
  points: ["tool_call", "turn_end"],
  usesPost: true,
  usesDrive: true,
  trust: { level: "builtin" },
});

export interface SmokeGroupState {
  /** drive가 지금까지 끝낸 loop.turn 횟수. 커밋된 상태에만 둔다(클로저 상태 금지) */
  readonly count: number;
}

export interface SmokeGroupOptions {
  /** tool_call에서 거부할 도구 이름. 기본은 쓰기 도구 write, edit */
  readonly denyTools?: readonly string[];
  /** drive가 부를 loop.turn 횟수. 상태 count가 이 값이 되면 멈춘다. 기본 1 */
  readonly driveTurns?: number;
  /**
   * turn_end에서 followUp을 post하는 최대 횟수. 기본은 제한 없음이다(X 시험이 turn_end마다 post를 본다).
   * 실제 엔진에서는 post가 새 turn을 만들고 그 turn_end가 또 post하므로 끝나지 않는다. 실제 엔진 통합 시험은 값을 정한다
   */
  readonly followUps?: number;
}

/** 시험이 그룹의 동작을 볼 수 있게 핸들러가 남기는 기록 */
export interface SmokeGroupProbe {
  readonly deniedCalls: string[];
  readonly turnEndSteps: string[];
  readonly posts: string[];
}

export interface SmokeGroup {
  readonly manifest: GroupManifest;
  readonly entry: ExtensionEntry;
  /** defineGroup이 만든 모듈. manifest와 entry는 이 모듈의 것이다 */
  readonly module: GroupModule;
  readonly probe: SmokeGroupProbe;
}

const DEFAULT_DENY_TOOLS: readonly string[] = ["write", "edit"];

const SMOKE_STATE: StateDecl<SmokeGroupState> = {
  schema: Type.Object({ count: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
  initial: { count: 0 },
  version: 1,
};

function registerSmoke(
  g: GroupApi<SmokeGroupState>,
  probe: SmokeGroupProbe,
  denyTools: ReadonlySet<string>,
  driveTurns: number,
  followUps: number,
): void {
  g.on("tool_call", (payload) => {
    if (!denyTools.has(payload.toolName)) return undefined;
    probe.deniedCalls.push(payload.toolCallId);
    return { block: true, reason: "smoke group denies write tools" };
  });
  g.on("turn_end", async (payload) => {
    probe.turnEndSteps.push(payload.stepId);
    if (probe.posts.length >= followUps) return;
    const requestId = `smoke:${payload.stepId}`;
    probe.posts.push(requestId);
    await g.post({ kind: "user", content: "smoke follow up" }, { when: "followUp", requestId });
  });
  // drive는 경계마다 마지막 커밋 상태로 다시 불린다. 지난 호출의 클로저 값을 읽지 않는다
  g.drive(
    async (loop, state) => {
      if (state.count >= driveTurns) return;
      await loop.turn({ input: { kind: "user", content: "smoke drive turn" } });
      await g.commit({ count: state.count + 1 });
    },
    { limits: { maxTurns: 4, maxSpawns: 0 } },
  );
}

/** M1 테스트 그룹. on(tool_call, turn_end), post, drive, scope를 한 번씩 쓴다. defineGroup으로 만든다 */
export function smokeGroup(options: SmokeGroupOptions = {}): SmokeGroup {
  const denyTools = new Set(options.denyTools ?? DEFAULT_DENY_TOOLS);
  const driveTurns = options.driveTurns ?? 1;
  const followUps = options.followUps ?? Number.POSITIVE_INFINITY;
  const probe: SmokeGroupProbe = { deniedCalls: [], turnEndSteps: [], posts: [] };
  const module = defineGroup<SmokeGroupState>({
    manifest: SMOKE_GROUP_MANIFEST,
    state: SMOKE_STATE,
    setup(g) {
      registerSmoke(g, probe, denyTools, driveTurns, followUps);
    },
  });
  return { manifest: module.manifest, entry: module.entry, module, probe };
}

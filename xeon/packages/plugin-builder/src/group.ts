import { defineManifest } from "@fresnel/contracts/extensions";
import type { DevkitService } from "@fresnel/contracts/services";
import { defineGroup, type GroupManifest, type GroupModule } from "@fresnel/group-sdk";
import { authoringWriteGuard } from "./guard.ts";
import { authoringDrive } from "./group-drive.ts";
import {
  AuthoringStateSchema,
  INITIAL_AUTHORING_STATE,
  sessionOpen,
  type AuthoringState,
} from "./group-state.ts";
import { authoringTools, AUTHORING_TOOL_NAMES } from "./group-tools.ts";

// L3.authoring.spec §3.1 그룹 `authoring`. 내장 L3 플러그인 그룹이고 기본은 꺼짐이다([결정: 2026-11-01 사용자]).
// 일은 주입받은 `fresnel.devkit` 서비스가 하고, 그룹은 도구, 단계 머신(drive), 쓰기 범위 가드(`tool.call.before`)만 가진다.
// Plugin UI 기여(page, well, card, command)는 T-VIEW 뒤에 더한다.

export const authoringManifest: GroupManifest = defineManifest({
  schemaVersion: 2,
  name: "authoring",
  version: "0.1.0",
  displayName: "Plugin Builder",
  description: "플러그인과 플러그인 그룹을 만드는 도구, 단계 머신, 쓰기 범위 가드",
  entry: "./src/index.ts",
  defaultEnabled: false,
  trust: { level: "builtin" },
  plugins: [
    {
      layer: "L3",
      drives: true,
      usesPost: true,
      hooks: ["tool.call.before", "thread.start"],
      requires: [],
      optional: [],
    },
  ],
  group: {},
});

export interface AuthoringDeps {
  /** 제작 서비스(`fresnel.devkit`). 호스트가 구현해 넘긴다 */
  readonly devkit: DevkitService;
  /** 개발 모드 판정(replay가 개발 모드에서만 돈다, A-5) */
  readonly devMode?: () => boolean;
  /** 같은 검사 오류가 남는 고치기 반복 한도. 기본 3(`l3.authoring.fixLoopLimit`) */
  readonly fixLoopLimit?: () => number;
}

const DEFAULT_FIX_LOOP_LIMIT = 3;

export function createAuthoringGroup(deps: AuthoringDeps): GroupModule {
  return defineGroup<AuthoringState>({
    manifest: authoringManifest,
    state: { schema: AuthoringStateSchema, initial: INITIAL_AUTHORING_STATE, version: 1 },
    setup(g) {
      for (const def of authoringTools({
        g,
        devkit: deps.devkit,
        devMode: deps.devMode ?? (() => false),
        fixLoopLimit: deps.fixLoopLimit ?? (() => DEFAULT_FIX_LOOP_LIMIT),
      }))
        g.registerTool(def);
      // 쓰기 범위 가드(§4.2). 대화가 열려 있는 동안만 켜지고, 이 그룹이 꺼지면 핸들러도 풀린다
      g.on("tool.call.before", (call, ctx) => {
        const { state } = ctx;
        if (!sessionOpen(state) || state.dir === null) return undefined;
        if (AUTHORING_TOOL_NAMES.some((name) => name === call.toolName)) return undefined;
        return authoringWriteGuard(state.dir, call);
      });
      // 대화 복원: 상태 문서는 엔진 재시작 뒤에도 남아 있으므로 열린 대화를 알린다
      g.on("thread.start", async (_payload, ctx) => {
        const { state } = ctx;
        if (!sessionOpen(state)) return;
        await g.post(
          {
            kind: "context",
            customType: "grp.authoring.notice.status",
            content: `[authoring] session ${state.sessionId ?? ""} is open at ${state.phase} (${state.dir ?? ""})`,
            display: true,
          },
          { when: "next", requestId: `authoring:restore:${state.name ?? ""}`.slice(0, 64) },
        );
      });
      g.drive(authoringDrive(g, deps.devkit));
    },
  });
}

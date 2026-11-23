import { defineManifest } from "@fresnel/contracts/extensions";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { DevkitService, ShellFolderPins } from "@fresnel/contracts/services";
import {
  defineOrchestration,
  type OrchestrationManifest,
  type OrchestrationModule,
} from "@fresnel/orchestration-sdk";
import { authoringWriteGuard } from "./guard.ts";
import { authoringDrive } from "./group-drive.ts";
import {
  AUTHORING_STATE_VERSION,
  AuthoringStateSchema,
  authoringStateMigrations,
  INITIAL_AUTHORING_STATE,
  sessionOpen,
  type AuthoringState,
} from "./group-state.ts";
import { authoringTools, AUTHORING_TOOL_NAMES, type AuthoringGuide } from "./group-tools.ts";

// L3.authoring.spec §3.1 그룹 `authoring`. 내장 L3 플러그인 그룹이고 기본은 켜짐이다([결정: 2026-11-13 사용자], 2026-11-01의 기본 꺼짐을 대체). 도구는 모두 지연(`deferred`)이라 문맥 비용이 0이다.
// 일은 주입받은 `fresnel.devkit` 서비스가 하고, 그룹은 도구, 단계 머신(drive), 쓰기 범위 가드(`tool.call.before`)만 가진다.
// Plugin UI 기여(page, well, card, command)는 T-VIEW 뒤에 더한다.

export const authoringManifest: OrchestrationManifest = defineManifest({
  schemaVersion: 2,
  name: "authoring",
  version: "0.1.0",
  displayName: "Plugin Builder",
  purpose: "Builds and fixes plugins through a conversation.",
  description:
    "Guides you from choosing a kind and a name through the scaffold, checks, a test and sending to review, and keeps writes inside the plugin folder while it works.",
  entry: "./src/index.ts",
  defaultEnabled: true,
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
  orchestration: {},
});

export interface AuthoringDeps {
  /** 제작 서비스(`fresnel.devkit`). 호스트가 구현해 넘긴다 */
  readonly devkit: DevkitService;
  /** Fresnel 가이드 읽기(`authoring_guide`). 호스트가 가이드 그룹과 같은 원본 폴더를 읽는 구현을 넘긴다. 없으면 도구는 `guide_unavailable`이다 */
  readonly guide?: AuthoringGuide;
  /** 개발 모드 판정(replay가 개발 모드에서만 돈다, A-5) */
  readonly devMode?: () => boolean;
  /** 같은 검사 오류가 남는 고치기 반복 한도. 기본 3(`l3.authoring.fixLoopLimit`) */
  readonly fixLoopLimit?: () => number;
  /** 대화의 작업 폴더(절대 경로). 상대 `dir`을 푸는 기준이고 없으면 상대 경로로 세션을 열지 않는다 */
  readonly workspaceOf?: (threadId: ThreadId) => string | undefined;
  /**
   * 대화의 셸 작업 폴더를 고정하는 포트(`ShellFolderPins`). 제작 대화가 열려 있는 동안 `bash`가 대상 폴더에서 돌게 한다(§4.2).
   * 없으면 입력에 작업 폴더가 없는 `bash`는 막힌다
   */
  readonly shellPins?: Pick<ShellFolderPins, "pin">;
}

const DEFAULT_FIX_LOOP_LIMIT = 3;

export function createAuthoringOrchestration(deps: AuthoringDeps): OrchestrationModule {
  return defineOrchestration<AuthoringState>({
    manifest: authoringManifest,
    state: {
      schema: AuthoringStateSchema,
      initial: INITIAL_AUTHORING_STATE,
      version: AUTHORING_STATE_VERSION,
    },
    migrations: authoringStateMigrations,
    setup(g) {
      for (const def of authoringTools({
        g,
        devkit: deps.devkit,
        guide: deps.guide,
        devMode: deps.devMode ?? (() => false),
        fixLoopLimit: deps.fixLoopLimit ?? (() => DEFAULT_FIX_LOOP_LIMIT),
        workspaceOf: deps.workspaceOf ?? (() => undefined),
      }))
        g.registerTool(def);
      // 쓰기 범위 가드(§4.2). 대화가 열려 있는 동안만 켜지고, 이 그룹이 꺼지면 핸들러도 풀린다
      g.on("tool.call.before", (call, ctx) => {
        const { state } = ctx;
        const threadId = ctx.threadId;
        const open = sessionOpen(state) && state.dir !== null ? state.dir : null;
        // 셸 작업 폴더 고정은 호출마다 다시 건다: 열려 있으면 대상 폴더로, 닫혔으면 푼다(다음 호출 앞에서 풀리므로 낡은 고정이 남지 않는다)
        deps.shellPins?.pin(threadId, open);
        if (open === null) return undefined;
        if (AUTHORING_TOOL_NAMES.some((name) => name === call.toolName)) return undefined;
        return authoringWriteGuard(open, call, {
          shellPinned: deps.shellPins !== undefined,
        });
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
      // 주도 단계 함수. 기본 켜짐이어도 주도 스택에 오르는 길은 시작 요청이나 맡기기뿐이다. 모델이 `authoring_start` 도구를 부르면 그 도구가
      // `startDrive`를 낸다(drive-isolation.md 2.2). 다른 플러그인(Helm의 `/helm plugin`)은 `handoff`로 맡긴다(2.1, group-drive.ts `handoffStep`).
      // 중재가 없으므로 켜지는 것만으로는 첫 경계에 스택에 오르지 않는다(`wants`도 없다, §1.1).
      // 제작 대화가 열려 있으면 상주하고(`yield`), 닫혀 있고 확인도 없으면 `done`으로 물러난다. 맡겨졌으면 답하고 물러난다.
      g.drive(authoringDrive(g, deps.devkit));
    },
  });
}

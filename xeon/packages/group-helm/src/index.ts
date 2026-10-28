import { defineGroup, type GroupApi, type GroupManifest, type GroupModule } from "@xeon/group-kit";
import { helmDrive } from "./drive.ts";
import { guardWrite } from "./guard.ts";
import { injectLens } from "./inject.ts";
import { checkRestore, onLeaseRejected } from "./lifecycle.ts";
import { drainCommands, createMailbox, helmCommand } from "./mailbox.ts";
import { helmManifest } from "./manifest.ts";
import {
  DEFAULT_HELM_SETTINGS,
  helmSettings,
  helmSettingsOf,
  type HelmSettings,
} from "./settings.ts";
import { observeTool, settle, type TallyStore, type ToolExecutionEndView } from "./signals.ts";
import { helmStateDecl, type HelmState } from "./state.ts";

/** 명령 요청마다 다른 값. 재실행되는 코드 밖(명령 처리기)에서만 만든다 */
function newNonce(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** 그룹 등록. 설정 읽기는 호출 쪽이 넘긴다: 내장 그룹은 g.settings(), 외부 플러그인은 기본값이다 */
function setupHelm(g: GroupApi<HelmState>, settings: () => HelmSettings): void {
  const tallies: TallyStore = new Map();
  const missingMeta = new Set<string>();
  const mailbox = createMailbox(newNonce);
  const observe = observeTool(tallies);
  const settleTurn = settle(g, tallies, settings);
  const guard = guardWrite(settings, missingMeta);
  const inject = injectLens(tallies);
  const restore = checkRestore(g);
  const rejected = onLeaseRejected(g);

  g.registerCommand("helm", helmCommand(mailbox));
  g.on("input.agent.before", async (payload, ctx) => {
    await drainCommands(g, mailbox, ctx.threadId, tallies, missingMeta);
    return inject(payload, { threadId: ctx.threadId, state: g.state() });
  });
  g.on("tool.call.before", (call, ctx) => guard(call, ctx));
  g.on("tool.execution.after", (end, ctx) => {
    const view: ToolExecutionEndView = {
      toolCallId: end.toolCallId,
      toolName: end.toolName,
      isError: end.isError,
      result: end.result,
      ...(end.input === undefined ? {} : { input: end.input }),
    };
    observe(view, ctx);
  });
  g.on("boundary.settle.after", async (payload, ctx) => {
    await drainCommands(g, mailbox, ctx.threadId, tallies, missingMeta);
    await settleTurn(payload, { threadId: ctx.threadId, state: g.state() });
  });
  g.on("session.start", (payload, ctx) => restore(payload, ctx));
  g.on("lifecycle.lease.rejected", (payload, ctx) => rejected(payload, ctx));
  g.drive(helmDrive(g, settings), { limits: settings().driveLimits });
}

/**
 * 기본 플러그인(D-M3-01 c)의 그룹 모듈. 외부 플러그인은 설정 읽기 포트에 닿지 못하므로(X 로더, builtin 전용) 기본 설정으로 동작한다.
 * 신뢰 등급 user의 그룹 설정 네임스페이스는 ext.helm이라 `helmSettings`(l3.helm)를 defineGroup에 붙이지 않는다
 */
export const helmGroup: GroupModule = defineGroup<HelmState>({
  manifest: helmManifest,
  state: helmStateDecl,
  setup(g) {
    setupHelm(g, () => DEFAULT_HELM_SETTINGS);
  },
});

const builtinManifest: GroupManifest = { ...helmManifest, trust: { level: "builtin" } };

/** 내장 신뢰로 올리는 판(컴파일된 사이드카 대체 경로, 테스트). 설정 `l3.helm.*`를 g.settings()로 읽는다 */
export const helmBuiltinGroup: GroupModule = defineGroup<HelmState, typeof helmSettings.defs>({
  manifest: builtinManifest,
  state: helmStateDecl,
  settings: helmSettings,
  setup(g) {
    setupHelm(g, () => helmSettingsOf(g.settings()));
  },
});

/** 외부 로더가 부르는 엔트리(X.loading-trust.spec §4.4.2: named `extension`) */
export const extension: GroupModule["entry"] = helmGroup.entry;

export { helmManifest } from "./manifest.ts";
export {
  DEFAULT_HELM_DRIVE_LIMITS,
  DEFAULT_HELM_SETTINGS,
  helmSettings,
  helmSettingsOf,
  type HelmSettings,
} from "./settings.ts";
export { HELM_RECORD_KINDS } from "./records.ts";
export { HelmStateSchema, INITIAL_HELM_STATE, type HelmState } from "./state.ts";
export { TRANSITIONS, transition } from "./phase.ts";

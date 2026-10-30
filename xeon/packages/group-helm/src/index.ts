import { defineGroup, type GroupApi, type GroupModule } from "@xeon/group-kit";
import { helmDrive } from "./drive.ts";
import { guardWrite } from "./guard.ts";
import { injectLens } from "./inject.ts";
import { checkRestore, onLeaseRejected } from "./lifecycle.ts";
import { helmCommand } from "./command-def.ts";
import { helmManifest } from "./manifest.ts";
import { helmSettings, helmSettingsOf, type HelmSettings } from "./settings.ts";
import { observeTool, settle, type TallyStore, type ToolExecutionEndView } from "./signals.ts";
import { helmStateDecl, type HelmState } from "./state.ts";

/** 그룹 등록. 설정은 g.settings()로 읽고, drive 상한은 임대를 새로 받을 때마다 다시 읽는다 */
function setupHelm(g: GroupApi<HelmState, typeof helmSettings.defs>): void {
  const settings = (): HelmSettings => helmSettingsOf(g.settings());
  const tallies: TallyStore = new Map();
  const missingMeta = new Set<string>();
  const observe = observeTool(tallies);
  const settleTurn = settle(g, tallies, settings);
  const guard = guardWrite(settings, missingMeta);
  const inject = injectLens(tallies);
  const restore = checkRestore(g);
  const rejected = onLeaseRejected(g);

  g.registerCommand("helm", helmCommand(g, tallies, missingMeta));
  g.on("input.agent.before", (payload, ctx) =>
    inject(payload, { threadId: ctx.threadId, state: ctx.state }),
  );
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
  g.on("boundary.settle.after", (payload, ctx) =>
    settleTurn(payload, { threadId: ctx.threadId, state: ctx.state }),
  );
  g.on("session.start", (payload, ctx) => restore(payload, ctx));
  g.on("lifecycle.lease.rejected", (payload, ctx) => rejected(payload, ctx));
  // X는 임대를 받을 때 options.limits를 읽는다. getter라 설정 변경이 다음 임대(다음 탐구)부터 반영된다
  g.drive(helmDrive(g, settings), {
    get limits() {
      return settings().driveLimits;
    },
  });
}

/**
 * 기본 플러그인(D-M3-01 c)의 그룹 모듈. 신뢰 등급 user, 설정 네임스페이스 `ext.helm`이다.
 * 외부 그룹은 X의 `settingValue`로 자기 `ext.helm.*` 키를 읽는다(g.settings())
 */
export const helmGroup: GroupModule = defineGroup<HelmState, typeof helmSettings.defs>({
  manifest: helmManifest,
  state: helmStateDecl,
  settings: helmSettings,
  setup: setupHelm,
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
export { dedupeInquiryFinished, HELM_RECORD_KINDS } from "./records.ts";
export { HelmStateSchema, INITIAL_HELM_STATE, type HelmState } from "./state.ts";
export { TRANSITIONS, transition } from "./phase.ts";

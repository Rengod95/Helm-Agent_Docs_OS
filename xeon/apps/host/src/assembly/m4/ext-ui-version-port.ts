import { join } from "node:path";
import { assertNever, err, ok, parse, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type {
  ExtDiagnostic,
  ExtRollbackParams,
  ExtRollbackResult,
  ExtUiApprovalParams,
  ExtUiApprovalResult,
  ExtUiEntry,
  ExtUiListResult,
  ExtUiPostParams,
  ExtUiPostResult,
  ExtVersionsResult,
} from "@fresnel/contracts/wire";
import type {
  ExtUiRefusal,
  LoadedExtensionInfo,
  RollbackHooks,
  RollbackReloadOutcome,
  UiEntryReport,
  UiIssue,
  VersionHistoryError,
} from "@fresnel/ext-host";
import type { ExtUiVersionFailure, ExtUiVersionPort } from "../../handlers/m4/ext-ui-version.ts";
import { sequentially } from "../../util.ts";
import type { M4PortDeps } from "./deps.ts";
import type { BundledPluginVersion } from "../default-plugins.ts";
import type { ExtUiVersionSource } from "./ext-ui-version-source.ts";

// ExtUiVersion 포트 구현(T-XV, L4.host-service.spec §3.3.3, HS-108). 확장 목록과 화면 목록은 로더가, 버전 기록은 `history`가,
// 끄기·켜기와 상태 비우기는 ExtHost의 등록 토글과 상태 재설정이 한다. 로더가 없으면(기본 그룹이 꺼짐) 확장이 없는 것으로 본다.

/** 화면 목록의 상한. 와이어 `ext.ui.list`의 items 상한과 같다 */
const UI_LIST_LIMIT = 500;
/** 항목 하나의 진단 개수와 문장 길이 상한(와이어 스키마). 제목은 256자다 */
const ISSUES_LIMIT = 200;
const TITLE_LIMIT = 256;
const MESSAGE_LIMIT = 2000;
/** `store.io`의 details.code 상한 */
const CODE_LIMIT = 64;
/** 상태 재설정이 이런 값을 주면 비울 상태가 없다는 뜻이라 실패가 아니다 */
const NOTHING_TO_CLEAR: ReadonlySet<string> = new Set([
  "not_refused",
  "nothing_stored",
  "no_state",
  "unknown_registration",
]);

export function createExtUiVersionPort(deps: Pick<M4PortDeps, "extUi">): ExtUiVersionPort {
  const source = deps.extUi;
  return {
    versions: (name) => versionsOf(source, name),
    rollback: (params) => rollbackOf(source, params),
    // 화면 목록은 대화별 켜짐을 쓰지 않는다. ExtHost가 thread별 켜짐을 내주지 않아 전역 상태로 본다(HS-108 [미결])
    uiList: () => uiListOf(source),
    uiPost: (params) => uiPostOf(source, params),
    uiRequestApproval: (params) => uiApprovalOf(source, params),
  };
}

/** 로더가 없거나 확장 호스트가 없으면 확장이 없는 것으로 본다(`unknown_extension`) */
async function uiPostOf(
  source: ExtUiVersionSource | undefined,
  params: ExtUiPostParams,
): Promise<Result<ExtUiPostResult, ExtUiRefusal>> {
  if (source === undefined) return err({ kind: "unknown_extension", extension: params.extension });
  const threadId = threadOf(params.threadId);
  if (threadId === undefined) return err({ kind: "unknown_thread", threadId: params.threadId });
  const posted = await source.host.ui.post({
    extension: params.extension,
    ui: params.ui,
    threadId,
    name: params.name,
    ...(params.payload === undefined ? {} : { payload: params.payload }),
    ...(params.requestId === undefined ? {} : { requestId: params.requestId }),
  });
  // 같은 키의 두 번째 호출도 받아들인 것이다(처음 호출이 이미 큐에 넣었다)
  return posted.ok ? ok({ accepted: true }) : posted;
}

async function uiApprovalOf(
  source: ExtUiVersionSource | undefined,
  params: ExtUiApprovalParams,
): Promise<Result<ExtUiApprovalResult, ExtUiRefusal>> {
  if (source === undefined) return err({ kind: "unknown_extension", extension: params.extension });
  const threadId = threadOf(params.threadId);
  if (threadId === undefined) return err({ kind: "unknown_thread", threadId: params.threadId });
  return source.host.ui.requestApproval({
    extension: params.extension,
    ui: params.ui,
    threadId,
    method: params.method,
    ...(params.params === undefined ? {} : { params: params.params }),
    ...(params.requestId === undefined ? {} : { requestId: params.requestId }),
  });
}

/** wire 문자열이 대화 id 모양이 아니면 열린 대화일 수 없다 */
function threadOf(raw: string): ThreadId | undefined {
  const parsed = parse(ThreadIdSchema, raw);
  return parsed.ok ? parsed.value : undefined;
}

async function versionsOf(
  source: ExtUiVersionSource | undefined,
  name: string,
): Promise<Result<ExtVersionsResult, ExtUiVersionFailure>> {
  const info = installedOf(source, name);
  if (source === undefined || info === undefined) return err({ kind: "unknown_extension", name });
  // 번들과 프로젝트 위치의 확장은 버전 기록이 없다. 목록은 빈 목록이다
  if (info.source !== "user") return ok({ versions: [] });
  const listing = await source.history.list(name, info.version);
  if (!listing.ok) return err(failureOf(listing.error));
  const bundled = await source.bundle(name);
  return ok({
    versions: listing.value.versions,
    ...(bundled === null ? {} : { bundledVersion: bundled.version }),
  });
}

/**
 * 되돌릴 판이 앱에 든 기본 플러그인 번들의 판이고 보관에 없으면 먼저 기록한다(HS-108, X.loading-trust §4.4.8). 기록의 출처는
 * `bundled`다. 설치본이 이미 그 판이면 되돌릴 곳이 없으므로 `unknown_version`이다. 보관에 같은 판 글자가 있어도 매니페스트
 * 해시가 번들과 다르면 번들 원본으로 다시 쓴다(판 글자만 믿지 않는다). 기록은 같은 판의 자리를 원자적으로 바꾼다
 */
async function recordBundledFirst(
  source: ExtUiVersionSource,
  name: string,
  installed: string,
  bundled: BundledPluginVersion,
): Promise<Result<void, ExtUiVersionFailure>> {
  if (bundled.version === installed) return err({ kind: "unknown_version", version: installed });
  const listing = await source.history.list(name, installed);
  if (!listing.ok) return err(failureOf(listing.error));
  const stored = listing.value.versions.find((entry) => entry.version === bundled.version);
  if (stored !== undefined && stored.manifestHash === source.hash(bundled.manifestText))
    return ok(undefined);
  const recorded = await source.history.record({
    name,
    version: bundled.version,
    source: "bundled",
    extensionDir: bundled.dir,
    manifestText: bundled.manifestText,
    stateSchemaVersion: null,
  });
  return recorded.ok ? ok(undefined) : err(failureOf(recorded.error));
}

async function rollbackOf(
  source: ExtUiVersionSource | undefined,
  params: ExtRollbackParams,
): Promise<Result<ExtRollbackResult, ExtUiVersionFailure>> {
  const info = installedOf(source, params.name);
  if (source === undefined || info === undefined) {
    return err({ kind: "unknown_extension", name: params.name });
  }
  if (info.source !== "user") {
    return err({
      kind: "history_unavailable",
      reason: `${info.source} extension has no version history`,
    });
  }
  const bundled = await source.bundle(params.name);
  if (bundled !== null && bundled.version === params.version) {
    const recordedFirst = await recordBundledFirst(source, params.name, info.version, bundled);
    if (!recordedFirst.ok) return err(recordedFirst.error);
  }
  const tally = { cleared: 0 };
  const rolled = await source.history.rollback({
    name: params.name,
    version: params.version,
    ...(params.clearState === undefined ? {} : { clearState: params.clearState }),
    extensionDir: join(source.extensionsDir, params.name),
    currentVersion: info.version,
    currentStateSchemaVersion: source.stateSchemaVersion(params.name),
    // 로더가 싣고 있는(`active`) 외부 확장은 끄지 않고 새 버전으로 바꾼다(X.loading-trust §4.4.4, §4.4.8). 열린 대화가 있어도 단계 경계에서 적용된다.
    // 실리지 않은 확장(`error`, `disabled`)은 바꿀 코드가 호스트에 없으므로 재시작 뒤에 적용한다
    hotReload: info.state === "active",
    hooks: hooksOf(source, tally),
  });
  if (!rolled.ok) return err(failureOf(rolled.error));
  return ok({
    appliesAt: rolled.value.appliesAt,
    // 끄고 켜는 길은 실제로 비운 scope가 있을 때만, 다시 읽는 길은 다시 읽기가 알려 준 값이다
    stateCleared: info.state === "active" ? rolled.value.stateCleared : tally.cleared > 0,
  });
}

/**
 * 되돌리기 훅. 끄기와 켜기는 확장의 모든 scope에 요청을 건다(적용은 다음 단계 경계다). 상태 비우기는 열린 thread마다 거부된 상태를 비운다.
 * 훅의 실패는 거부로 알린다. 버전 기록 모듈이 `attemptAsync`로 받아 `disable_failed`·`clear_state_failed`·`enable_failed`로 옮긴다.
 */
function hooksOf(source: ExtUiVersionSource, tally: { cleared: number }): RollbackHooks {
  return {
    disable: (target) => {
      toggleScopes(source, target, false);
      return Promise.resolve();
    },
    enable: (target) => {
      toggleScopes(source, target, true);
      return Promise.resolve();
    },
    clearState: async (target) => {
      tally.cleared += await clearStates(source, target);
    },
    reload: (target, options) => reloadOf(source, target, options.clearState),
  };
}

/**
 * 되돌리기가 교체한 파일을 새 버전으로 바꾼다(`ExtensionLoader.reload`). 새 버전이 열리지 못하면 던져 되돌리기가 파일을 되돌리게 한다.
 * 실행 중인 turn 때문에 경계를 기다리면(`nextStepBoundary`) 그 경계의 적용 결과는 기다리지 않는다: 그 실패는 로더 진단(`reload_failed`)에만 남고 옛 버전이 계속 돈다.
 * 상태는 적용이 끝난 호출(`now`)에서만 비웠다고 알린다
 */
async function reloadOf(
  source: ExtUiVersionSource,
  name: string,
  clearState: boolean,
): Promise<RollbackReloadOutcome> {
  const loader = source.loader();
  if (loader === undefined) throw new Error("the extension loader is not running");
  const started = await loader.reload(name, new AbortController().signal, {
    resetRefusedState: clearState,
  });
  if (!started.ok) {
    const failure = started.error;
    throw new Error(
      failure.kind === "rejected"
        ? failure.diagnostics.map((entry) => entry.message).join("; ")
        : `${name} cannot be reloaded (${failure.kind})`,
    );
  }
  if (started.value.appliesAt === "nextStepBoundary") return { stateCleared: false };
  const applied = await started.value.applied;
  if (applied.status === "failed") {
    throw new Error(applied.diagnostics.map((entry) => entry.message).join("; "));
  }
  return { stateCleared: applied.status === "applied" && applied.statesCleared > 0 };
}

/** 이름이 같은 scope마다 켜기나 끄기를 요청한다. 요청만 기록하고 적용은 단계 경계에서 한다 */
function toggleScopes(source: ExtUiVersionSource, name: string, enabled: boolean): void {
  for (const scope of source.host.registrations().filter((item) => item.extension === name)) {
    const handle = source.host.registration(scope.id);
    if (enabled) {
      handle?.enable();
    } else {
      handle?.disable();
    }
  }
}

/**
 * 열린 thread마다 이 확장의 scope 상태를 비운다. ExtHost의 상태 재설정은 저장 상태 오류로 거부된 scope만 받는다(§4.4.8 상태 비우기).
 * 비운 개수를 돌려준다. 비울 수 없는 다른 실패는 던져서 되돌리기가 `clear_state_failed`로 멈추게 한다
 */
async function clearStates(source: ExtUiVersionSource, name: string): Promise<number> {
  const scopeIds = source.host
    .registrations()
    .filter((scope) => scope.extension === name)
    .map((scope) => scope.id);
  const pairs = source
    .heldThreads()
    .flatMap((threadId) => scopeIds.map((scopeId) => ({ threadId, scopeId })));
  let cleared = 0;
  await sequentially(pairs, async ({ threadId, scopeId }) => {
    const reset = await source.host.resetRegistrationState(threadId, scopeId);
    if (reset.ok) {
      cleared += 1;
      return;
    }
    if (NOTHING_TO_CLEAR.has(reset.error.kind)) return;
    throw new Error(`the state of ${scopeId} could not be cleared (${reset.error.kind})`, {
      cause: reset.error,
    });
  });
  return cleared;
}

function failureOf(error: VersionHistoryError): ExtUiVersionFailure {
  switch (error.kind) {
    case "invalid_name":
      return { kind: "unknown_extension", name: error.name };
    case "invalid_version":
    case "not_found":
      return { kind: "unknown_version", version: error.version };
    case "io":
      return { kind: "io", code: codeOf(error.cause) };
    case "state_schema_mismatch":
      return {
        kind: "state_schema_mismatch",
        targetSchemaVersion: error.targetSchemaVersion,
        currentSchemaVersion: error.currentSchemaVersion,
      };
    case "disable_failed":
      return { kind: "rollback_failed", reason: "disable_failed" };
    case "swap_failed":
      return {
        kind: "rollback_failed",
        reason: `swap_failed at ${error.step} (restored ${String(error.restored)}, reenabled ${String(error.reenabled)})`,
      };
    case "clear_state_failed":
      return { kind: "rollback_failed", reason: "clear_state_failed" };
    case "enable_failed":
      return { kind: "rollback_failed", reason: "enable_failed" };
    case "reload_failed":
      return {
        kind: "rollback_failed",
        reason: `reload_failed (files restored ${String(error.restored)}): ${causeMessage(error.cause)}`,
      };
    default:
      return assertNever(error, "VersionHistoryError");
  }
}

function causeMessage(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause)).slice(0, MESSAGE_LIMIT);
}

/** 저장 매체 오류의 OS 코드(`ENOENT` 같은 값). 없으면 `io`다 */
function codeOf(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code: unknown = cause.code;
    if (typeof code === "string" && code.length > 0) return code.slice(0, CODE_LIMIT);
  }
  return "io";
}

function installedOf(
  source: ExtUiVersionSource | undefined,
  name: string,
): LoadedExtensionInfo | undefined {
  return source
    ?.loader()
    ?.list()
    .find((info) => info.name === name);
}

function uiListOf(source: ExtUiVersionSource | undefined): ExtUiListResult {
  const loader = source?.loader();
  if (source === undefined || loader === undefined) return { items: [] };
  const off = offExtensions(source.host, loader.list());
  // 확장 이름, 항목 id 순이다. 상한은 정렬한 뒤에 자르므로 같은 입력이면 같은 목록이다
  const items = loader
    .uiEntries()
    .toSorted((a, b) => compareText(a.extension, b.extension) || compareText(a.id, b.id))
    .slice(0, UI_LIST_LIMIT)
    .map((report) => entryOf(report, off.has(report.extension)));
  return { items };
}

/** 꺼진 확장: 로더 상태가 활성이 아니거나(설정으로 끔, 실패), 등록이 모두 꺼졌다 */
function offExtensions(
  host: ExtUiVersionSource["host"],
  infos: readonly LoadedExtensionInfo[],
): ReadonlySet<string> {
  const scopes = host.registrations();
  const off = infos.filter((info) => {
    if (info.state !== "active") return true;
    const mine = scopes.filter((scope) => scope.extension === info.name);
    return (
      mine.length > 0 &&
      mine.every((scope) => scope.status === "disabled" || scope.status === "disabling")
    );
  });
  return new Set(off.map((info) => info.name));
}

/** 항목 하나를 와이어 모양으로 옮긴다. 확장이 꺼졌으면 항목 상태와 무관하게 `disabled`다 */
function entryOf(report: UiEntryReport, off: boolean): ExtUiEntry {
  return {
    extension: report.extension,
    id: report.id,
    placement: report.placement,
    mode: report.mode,
    title: report.title.slice(0, TITLE_LIMIT),
    state: off ? "disabled" : report.state,
    version: report.version,
    trust: report.trust,
    ...(report.appRoot === undefined ? {} : { appRoot: report.appRoot }),
    ...(report.forKind === undefined ? {} : { forKind: report.forKind }),
    ...(report.tree === undefined ? {} : { tree: report.tree }),
    ...(report.app === undefined ? {} : { app: report.app }),
    ...(report.messages === undefined ? {} : { messages: report.messages }),
    issues: report.issues.slice(0, ISSUES_LIMIT).map(diagnosticOf),
  };
}

/** 검사 진단을 와이어 진단으로 옮긴다. 와이어는 오류와 경고만 있어 정보는 경고로 낸다 */
function diagnosticOf(issue: UiIssue): ExtDiagnostic {
  return {
    severity: issue.severity === "error" ? "error" : "warning",
    code: issue.code,
    message: issue.message.slice(0, MESSAGE_LIMIT),
  };
}

/** 코드 단위 순서. 지역 설정과 무관하게 같은 순서를 낸다 */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

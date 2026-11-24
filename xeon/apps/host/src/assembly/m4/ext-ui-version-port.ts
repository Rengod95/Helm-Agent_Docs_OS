import { attemptAsync, detach, err, ok, parse, type Result } from "@fresnel/contracts";
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
  ExtVersionEntry,
  ExtVersionsResult,
} from "@fresnel/contracts/wire";
import type {
  ExtUiRefusal,
  LoadedExtensionInfo,
  ReloadApplied,
  UiEntryReport,
  UiIssue,
} from "@fresnel/ext-host";
import type { ExtMethodPort } from "../../handlers/m4/ext-method.ts";
import type { ExtUiVersionFailure, ExtUiVersionPort } from "../../handlers/m4/ext-ui-version.ts";
import type { M4PortDeps } from "./deps.ts";
import type { PluginStoreError, PluginVersionInfo } from "../plugins/store.ts";
import type { ExtUiVersionSource } from "./ext-ui-version-source.ts";

// ExtUiVersion 포트 구현(T-XV, L4.host-service.spec §3.3.3, HS-108). 확장 목록과 화면 목록은 로더가 낸다.
// 버전 목록과 되돌리기는 검토본 저장소가 한다(M5c §4.6, `reviewed`): 되돌리기는 `current`를 바꾸고 로더가 검토본을 다시 읽는다.
// 로더가 없으면(기본 그룹이 꺼짐) 실린 확장이 없는 것으로 본다.

/** 화면 목록의 상한. 와이어 `ext.ui.list`의 items 상한과 같다 */
const UI_LIST_LIMIT = 500;
/** 항목 하나의 진단 개수와 문장 길이 상한(와이어 스키마). 제목은 256자다 */
const ISSUES_LIMIT = 200;
const TITLE_LIMIT = 256;
const MESSAGE_LIMIT = 2000;
/** `store.io`의 details.code 상한 */
const CODE_LIMIT = 64;
/** 검토본 해시의 접두사와 와이어 판 글자에 붙이는 해시 자릿수 */
const HASH_PREFIX = "sha256:";
const SHORT_HASH = 8;

export function createExtUiVersionPort(
  deps: Pick<M4PortDeps, "extUi">,
  /** 그 대화가 시험 중인 초안의 내부 이름들. 대화가 시험 실행이 아니면 빈 목록이다 */
  testedDraftsOf: (threadId: ThreadId) => readonly string[] = () => [],
): ExtUiVersionPort {
  const source = deps.extUi;
  return {
    versions: (name) => versionsOf(source, name),
    rollback: (params) => rollbackOf(source, params),
    // 화면 목록은 대화별 켜짐을 쓰지 않는다. ExtHost가 thread별 켜짐을 내주지 않아 전역 상태로 본다(HS-108 [미결])
    uiList: (params) =>
      uiListOf(
        source,
        params.threadId === undefined ? undefined : threadOf(params.threadId),
        testedDraftsOf,
      ),
    uiPost: (params) => uiPostOf(source, params),
    uiRequestApproval: (params) => uiApprovalOf(source, params),
  };
}

/**
 * 확장 메서드 `ext.<확장>.<동사>`의 포트. 재시작 직후 미뤄 둔 확장은 먼저 올린 뒤에 부른다.
 * 올리기 전에는 메서드 표가 비어 화면의 첫 호출이 `not_found`로 거절된다(AGE-77 X-01)
 */
export function createExtMethodPort(
  call: ExtMethodPort["call"],
  source: ExtUiVersionSource | undefined,
): ExtMethodPort {
  return {
    async call(request) {
      if (source !== undefined) await loadDeferred(source, request.extension);
      return await call(request);
    },
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
  await loadDeferred(source, params.extension);
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
  await loadDeferred(source, params.extension);
  return source.host.ui.requestApproval({
    extension: params.extension,
    ui: params.ui,
    threadId,
    method: params.method,
    ...(params.params === undefined ? {} : { params: params.params }),
    ...(params.requestId === undefined ? {} : { requestId: params.requestId }),
  });
}

/** 시작 때 미뤄 둔 확장(`lazy_deferred`)인가. 사용자가 끈 것이 아니라 아직 싣지 않은 것이다 */
function isDeferred(info: LoadedExtensionInfo): boolean {
  return (
    info.state === "disabled" && info.diagnostics.some((item) => item.code === "lazy_deferred")
  );
}

/**
 * 앱 화면이 확장에 말을 걸 때 미뤄 둔 확장을 먼저 싣는다(W-05). 재시작 직후에는 대화가 쓰기 전까지 싣지 않으므로
 * 화면이 먼저 열리면 확장이 없다. 싣지 못해도 여기서는 던지지 않고 뒤 호출이 거절한다
 */
async function loadDeferred(source: ExtUiVersionSource, name: string): Promise<void> {
  const loader = source.loader();
  const info = loader?.list().find((candidate) => candidate.name === name);
  if (loader === undefined || info === undefined || !isDeferred(info)) return;
  await attemptAsync(() => loader.ensureLoaded(name, new AbortController().signal));
}

/** wire 문자열이 대화 id 모양이 아니면 열린 대화일 수 없다 */
function threadOf(raw: string): ThreadId | undefined {
  const parsed = parse(ThreadIdSchema, raw);
  return parsed.ok ? parsed.value : undefined;
}

/** 검토본 판 하나의 와이어 글자. `<매니페스트 버전>+<해시 앞 8자>`라서 같은 버전이 여럿이어도 구분된다 */
function versionTextOf(item: PluginVersionInfo): string {
  return `${item.version}+${item.contentHash.slice(HASH_PREFIX.length, HASH_PREFIX.length + SHORT_HASH)}`;
}

function versionEntryOf(item: PluginVersionInfo): ExtVersionEntry {
  return {
    version: versionTextOf(item),
    installedAt: item.approvedAt,
    source: item.origin === "bundled" ? "bundled" : "user",
    manifestHash: item.contentHash,
    // 상태 스키마 버전은 검토본에 없다(X는 밝히지 않는다). 되돌리기가 스키마를 검사하지 않는 것과 같다
    stateSchemaVersion: null,
    current: item.current,
  };
}

/** 저장소 실패를 버전 포트의 실패로 옮긴다. 이름이 잘못된 것은 확장이 없는 것이다 */
function storeFailureOf(error: PluginStoreError): ExtUiVersionFailure {
  if (error.kind === "invalid_name") return { kind: "unknown_extension", name: error.name };
  if (error.kind === "io") return { kind: "io", code: codeOf(error.cause) };
  return { kind: "io", code: error.kind.slice(0, CODE_LIMIT) };
}

async function versionsOf(
  source: ExtUiVersionSource | undefined,
  name: string,
): Promise<Result<ExtVersionsResult, ExtUiVersionFailure>> {
  if (source === undefined) return err({ kind: "unknown_extension", name });
  const listed = await source.reviewed.store.versions(name);
  if (!listed.ok) return err(storeFailureOf(listed.error));
  // 검토본도 없고 실린 확장도 없으면 이름이 없는 것이다
  if (listed.value.length === 0 && installedOf(source, name) === undefined) {
    return err({ kind: "unknown_extension", name });
  }
  const bundled = await source.bundle(name);
  return ok({
    versions: listed.value.map(versionEntryOf),
    ...(bundled === null ? {} : { bundledVersion: bundled.version }),
  });
}

/** `current`을 이전 검토본으로 되돌린다(없었으면 비운다). 되돌렸는지 돌려준다 */
async function restoreCurrent(
  source: ExtUiVersionSource,
  name: string,
  previous: PluginVersionInfo | null,
): Promise<boolean> {
  const back =
    previous === null
      ? await source.reviewed.store.clearCurrent(name)
      : await source.reviewed.store.setCurrent(name, previous.contentHash);
  return back.ok;
}

/** 되돌리기 기록 한 줄. 검토 항목이 없으므로 `itemId`는 null이고 결정은 `rollback`이다(M5c §4.6.8) */
async function recordRollback(
  source: ExtUiVersionSource,
  name: string,
  target: PluginVersionInfo,
  previous: PluginVersionInfo | null,
): Promise<Result<void, ExtUiVersionFailure>> {
  const appended = await source.reviewed.store.appendLog({
    at: source.reviewed.now(),
    itemId: null,
    name,
    kind: null,
    candidateHash: target.contentHash,
    baseHash: previous?.contentHash ?? null,
    decision: "rollback",
    profileIds: [],
    actor: "user",
    provenance: null,
    originThreadId: null,
  });
  return appended.ok ? ok(undefined) : err(storeFailureOf(appended.error));
}

/** 적용이 끝난 뒤의 되돌리기 한 가지 결과를 처리한다. 성공이면 기록하고 열린 대화를 맞추고, 실패면 현재 검토본을 되돌린다 */
async function settleRollback(
  source: ExtUiVersionSource,
  name: string,
  target: PluginVersionInfo,
  previous: PluginVersionInfo | null,
  outcome: ReloadApplied,
): Promise<Result<{ readonly stateCleared: boolean }, ExtUiVersionFailure>> {
  if (outcome.status === "applied") {
    const logged = await recordRollback(source, name, target, previous);
    if (!logged.ok) {
      const restored = await restoreCurrent(source, name, previous);
      return err({
        kind: "rollback_failed",
        reason: `log_failed (current restored ${String(restored)})`,
      });
    }
    await source.reviewed.refreshPluginSet();
    return ok({ stateCleared: outcome.statesCleared > 0 });
  }
  const restored = await restoreCurrent(source, name, previous);
  const reason =
    outcome.status === "failed"
      ? outcome.diagnostics.map((item) => item.message).join("; ")
      : outcome.status;
  return err({
    kind: "rollback_failed",
    reason: `${reason.slice(0, MESSAGE_LIMIT)} (current restored ${String(restored)})`,
  });
}

/**
 * 검토본 저장소의 `current`를 지정한 판으로 바꾼다(M5c §4.6.8). 새 검토 항목은 만들지 않고 기록에 `rollback`을 남긴다.
 * 실리지 않았거나 꺼진 확장은 다음 적재 때 새 판을 싣는다. 실린 확장은 로더가 검토본을 다시 읽는다. 실패하면 `current`는 옛 것이다.
 */
async function rollbackOf(
  source: ExtUiVersionSource | undefined,
  params: ExtRollbackParams,
): Promise<Result<ExtRollbackResult, ExtUiVersionFailure>> {
  if (source === undefined) return err({ kind: "unknown_extension", name: params.name });
  const listed = await source.reviewed.store.versions(params.name);
  if (!listed.ok) return err(storeFailureOf(listed.error));
  const info = installedOf(source, params.name);
  if (listed.value.length === 0 && info === undefined) {
    return err({ kind: "unknown_extension", name: params.name });
  }
  const target = listed.value.find((item) => versionTextOf(item) === params.version);
  if (target === undefined) return err({ kind: "unknown_version", version: params.version });
  if (target.current) return ok({ appliesAt: "nextStepBoundary", stateCleared: false });

  const previous = listed.value.find((item) => item.current) ?? null;
  const switched = await source.reviewed.store.setCurrent(params.name, target.contentHash);
  if (!switched.ok) return err(storeFailureOf(switched.error));

  const loader = source.loader();
  if (info === undefined || info.state !== "active" || loader === undefined) {
    const logged = await recordRollback(source, params.name, target, previous);
    if (!logged.ok) {
      await restoreCurrent(source, params.name, previous);
      return logged;
    }
    return ok({ appliesAt: "nextStepBoundary", stateCleared: false });
  }

  // 실린 확장은 검토본을 다시 읽는다. 적용은 단계 경계에서 일어나고, 실패하면 옛 판이 계속 돈다
  const started = await loader.reloadFromReviewed(params.name, new AbortController().signal, {
    resetRefusedState: params.clearState === true,
  });
  if (!started.ok) {
    const restored = await restoreCurrent(source, params.name, previous);
    const failure = started.error;
    const reason =
      failure.kind === "rejected"
        ? failure.diagnostics.map((item) => item.message).join("; ")
        : failure.kind;
    return err({
      kind: "rollback_failed",
      reason: `${reason.slice(0, MESSAGE_LIMIT)} (current restored ${String(restored)})`,
    });
  }
  if (started.value.appliesAt === "nextStepBoundary") {
    detach(
      started.value.applied.then((outcome) =>
        settleRollback(source, params.name, target, previous, outcome),
      ),
      (cause) =>
        source.reviewed.log.error("plugin.rollback.settle_failed", {
          name: params.name,
          cause: String(cause),
        }),
    );
    return ok({ appliesAt: "nextStepBoundary", stateCleared: false });
  }
  const settled = await settleRollback(
    source,
    params.name,
    target,
    previous,
    await started.value.applied,
  );
  if (!settled.ok) return settled;
  // 적용이 바로 끝났다. 와이어 `appliesAt`에는 `now`가 없어 `nextStepBoundary`로 알린다(보고 참고)
  return ok({ appliesAt: "nextStepBoundary", stateCleared: settled.value.stateCleared });
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

function uiListOf(
  source: ExtUiVersionSource | undefined,
  threadId: ThreadId | undefined,
  testedDraftsOf: (threadId: ThreadId) => readonly string[],
): ExtUiListResult {
  const loader = source?.loader();
  if (source === undefined || loader === undefined) return { items: [] };
  const infos = loader.list();
  const off = offExtensions(source.host, infos);
  // 승인 전 드래프트는 켤 수 없으므로 머리줄 탭과 앱 목록에 올리지 않는다. 그 드래프트를 시험 중인 대화에서만 보인다(AGE-77 X-04)
  const tested = new Set(threadId === undefined ? [] : testedDraftsOf(threadId));
  const drafts = new Set(infos.filter((info) => info.draft !== undefined).map((info) => info.name));
  // 확장 이름, 항목 id 순이다. 상한은 정렬한 뒤에 자르므로 같은 입력이면 같은 목록이다
  const items = loader
    .uiEntries()
    .filter((report) => !drafts.has(report.extension) || tested.has(report.extension))
    .toSorted((a, b) => compareText(a.extension, b.extension) || compareText(a.id, b.id))
    .slice(0, UI_LIST_LIMIT)
    .map((report) => entryOf(report, off.has(report.extension), drafts.has(report.extension)));
  return { items };
}

/**
 * 꺼진 확장: 로더 상태가 활성이 아니거나(설정으로 끔, 실패), 등록이 모두 꺼졌고 사용자가 전체로 끈 것이 있다.
 * 어느 프로필에도 없어 scope가 닫혀 있을 뿐이면 꺼진 것이 아니다. 설치된 앱은 열린다(AGE-78 질문 3)
 */
function offExtensions(
  host: ExtUiVersionSource["host"],
  infos: readonly LoadedExtensionInfo[],
): ReadonlySet<string> {
  const scopes = host.registrations();
  const off = infos.filter((info) => {
    if (isDeferred(info)) return false;
    if (info.state !== "active") return true;
    const mine = scopes.filter((scope) => scope.extension === info.name);
    return (
      mine.length > 0 &&
      mine.every((scope) => scope.status === "disabled" || scope.status === "disabling") &&
      mine.some((scope) => scope.explicitOff === true)
    );
  });
  return new Set(off.map((info) => info.name));
}

/** 항목 하나를 와이어 모양으로 옮긴다. 확장이 꺼졌으면 항목 상태와 무관하게 `disabled`다 */
function entryOf(report: UiEntryReport, off: boolean, draft: boolean): ExtUiEntry {
  return {
    extension: report.extension,
    id: report.id,
    placement: report.placement,
    mode: report.mode,
    title: report.title.slice(0, TITLE_LIMIT),
    ...(report.icon === undefined ? {} : { icon: report.icon }),
    state: off ? "disabled" : report.state,
    version: report.version,
    trust: report.trust,
    ...(report.appRoot === undefined ? {} : { appRoot: report.appRoot }),
    ...(report.forKind === undefined ? {} : { forKind: report.forKind }),
    ...(draft ? { draft: true } : {}),
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

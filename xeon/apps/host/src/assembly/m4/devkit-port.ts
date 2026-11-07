import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { assertNever, attemptAsync, err, ok, parseJson, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  EXTENSION_NAME_PATTERN,
  isGroupExtension,
  validateManifest,
  type ExtensionManifest,
} from "@fresnel/contracts/extensions";
import type {
  ExtDiagnostic,
  ExtInstallResult,
  ExtLoadFailureReason,
  ExtRemoveResult,
  ExtTestRunParams,
  ExtTestRunResult,
} from "@fresnel/contracts/wire";
import type { LoadDiagnostic } from "@fresnel/ext-host";
import type { DevkitError, LinkInput, ReplayReport } from "@fresnel/contracts/services";
import {
  installExtension,
  previewInstall,
  KIND_CATALOG,
  locateTemplateDirs,
  MANIFEST_PATH,
  packExtension,
  removeExtension,
  scaffoldExtension,
  validateCompositionReport,
  validateExtensionDir,
  type TemplateDirs,
} from "@fresnel/plugin-builder";
import type { DevkitPort } from "../../handlers/m4/devkit.ts";
import {
  markTestRun,
  type ProfileApplyFailure,
  type ProfileTestRunPort,
} from "../../handlers/m4/profile-test-run.ts";
import { hostResourceDir } from "../../state-paths.ts";
import { messageOf } from "../../util.ts";
import type { M4PortDeps } from "./deps.ts";
import type { ExtUiVersionSource } from "./ext-ui-version-source.ts";
import {
  installedReplayRunner,
  replayReportOf,
  type ReplayRunInput,
  type ReplayRunner,
} from "./replay-run.ts";
import { isDevMode } from "./profile-test-run-port.ts";
import {
  createExtTestRecordStore,
  EXT_TEST_FILE_NAME,
  type ExtTestRecordStore,
  type ExtTestStoreFailure,
} from "./test-record-store.ts";

// Devkit 포트 구현(L3.authoring.spec §3.3). 파일 작업은 `@fresnel/plugin-builder`가 하고 이 파일은 호스트 상태(설치된 확장 이름,
// 사용자 확장 위치, 버전 기록, 등록 끄기)와 이어 준다. 사용자 확장 위치가 없으면(`extUi` 없음) 설치와 지우기는 `io`로 거절한다.
// 시험 실행(W-29, `ext.test.run`·`ext.test.list`)도 여기서 한다: replay는 개발 모드에서 실행기로 돌리고, testRun은 Test run 대화를 연다.

export interface DevkitPortOptions {
  /** 템플릿 폴더. 생략하면 환경 변수와 자원 폴더, 소스 저장소 순으로 찾는다. 못 찾으면 null */
  readonly templates?: TemplateDirs | null;
  /** Test run 대화의 프로필 적용과 표지(W-34). 생략하면 testRun은 `io`로 거절한다. 명령 포트와 한 인스턴스여야 표지가 맞는다 */
  readonly profiles?: ProfileTestRunPort;
  /** 설치된 그룹 재생기(`replay-run.ts`). 생략하면 `installedReplayRunner`(`@fresnel/plugin-builder`의 `runInstalledReplay`)를 쓴다. 시험이 가짜를 넘긴다 */
  readonly replay?: ReplayRunner;
  /** 시험 기록 ID 만들기. 생략하면 무작위 ID다(시험이 고정 값을 넣는다) */
  readonly newTestId?: () => string;
}

const DEFAULT_MAX_COMMITS = 200;
const MAX_COMMITS_LIMIT = 1000;

function noLocation(): Result<never, DevkitError> {
  return err({ kind: "io", message: "the user extensions location is not available" });
}

function notInstalled(name: string): Result<never, DevkitError> {
  return err({ kind: "not_found", message: `${name} is not installed` });
}

const EXTENSION_NAME = new RegExp(EXTENSION_NAME_PATTERN);

/** 사용자 확장 위치에 그 이름의 설치본 폴더가 있는가. 이름이 규칙에 맞지 않거나 읽을 수 없으면 없는 것으로 본다(`manifestIdentity`와 같은 규칙) */
async function hasInstalledFolder(extensionsDir: string, name: string): Promise<boolean> {
  if (!EXTENSION_NAME.test(name)) return false;
  return stat(join(extensionsDir, name)).then(
    (found) => found.isDirectory(),
    () => false,
  );
}

/** 실행 중인 확장을 내리고 적용 시점을 돌려준다 */
async function stopExtension(
  source: ExtUiVersionSource,
  name: string,
): Promise<ExtRemoveResult["appliesAt"]> {
  // 로더가 실은 확장은 재시작 없이 내려가 목록에서 바로 빠진다(X.loading-trust §4.4.5)
  if ((await source.loader()?.unload(name)) === true) return "now";
  // 로더가 모르는 확장은 실행 중인 등록의 끄기를 청한다. 단계 경계에서 적용되고, 등록이 없으면 다음 시작부터 빠진다
  const scopes = source.host.registrations().filter((scope) => scope.extension === name);
  for (const scope of scopes) source.host.registration(scope.id)?.disable();
  return scopes.length > 0 ? "nextStepBoundary" : "restart";
}

/**
 * 저장 테이블까지 지운다. 데이터를 먼저 지운다. 폴더를 먼저 지우면 데이터 지우기가 실패했을 때 폴더가 없어
 * 같은 요청을 다시 보낼 수 없다(not_found). 데이터는 지웠는데 폴더 지우기가 실패하면 폴더가 남아 다시 보낼 수 있다.
 */
async function removeWithData(
  source: ExtUiVersionSource,
  name: string,
): Promise<Result<ExtRemoveResult, DevkitError>> {
  const storage = source.storage;
  if (storage === undefined)
    return err({ kind: "io", message: "extension storage is not available" });
  if (!(await hasInstalledFolder(source.extensionsDir, name))) return notInstalled(name);
  const appliesAt = await stopExtension(source, name);
  const dropped = storage.drop(name);
  if (!dropped.ok)
    return err({
      kind: "io",
      message: `could not drop the stored data (${dropped.error.kind}); the extension folder is kept`,
    });
  const removed = await removeExtension(name, { extensionsDir: source.extensionsDir });
  if (!removed.ok) return removed;
  return ok({ name, appliesAt, dataDropped: dropped.value.dropped.length });
}

/** 설치 위치에 있는 지금 설치본의 이름 확인에 쓰는 매니페스트 이름과 버전. 읽을 수 없으면 null */
async function manifestIdentity(
  root: string,
): Promise<{ readonly name: string; readonly version: string; readonly text: string } | null> {
  const text = await readFile(join(root, MANIFEST_PATH), "utf8").then(
    (value) => value,
    () => null,
  );
  if (text === null) return null;
  const json = parseJson(text);
  if (!json.ok) return null;
  const manifest = validateManifest(json.value).manifest;
  return manifest === undefined ? null : { name: manifest.name, version: manifest.version, text };
}

/** 설치 폴더의 매니페스트 전체. 읽지 못하거나 규칙에 맞지 않으면 null (replay가 그룹인지 보려고 쓴다) */
async function installedManifest(root: string): Promise<ExtensionManifest | null> {
  const text = await readFile(join(root, MANIFEST_PATH), "utf8").then(
    (value) => value,
    () => null,
  );
  if (text === null) return null;
  const json = parseJson(text);
  if (!json.ok) return null;
  return validateManifest(json.value).manifest ?? null;
}

/** 시험 기록 저장소의 실패를 포트 오류로 옮긴다. 파일 경로는 싣지 않는다(설정 폴더 위치를 메시지에 내지 않는다) */
function storeFailureOf(failure: ExtTestStoreFailure): DevkitError {
  switch (failure.kind) {
    case "corrupt":
      return {
        kind: "io",
        message: `${EXT_TEST_FILE_NAME} is damaged (${failure.reason}); it is kept as it is`,
      };
    case "io":
      return {
        kind: "io",
        message: `${EXT_TEST_FILE_NAME} could not be read or written (${failure.code})`,
      };
    case "not_found":
      return { kind: "io", message: `the test record ${failure.testId} is no longer kept` };
    default:
      return assertNever(failure, "ExtTestStoreFailure");
  }
}

/** 프로필 적용과 읽기의 실패를 포트 오류로 옮긴다. 값 검사 거절과 없는 프로필은 입력 문제(`not_found`, `invalid_input`), 저장과 쓰기 실패는 `io`다 */
function devkitErrorOfProfile(failure: ProfileApplyFailure): DevkitError {
  switch (failure.kind) {
    case "not_found":
      return { kind: "not_found", message: `profile ${failure.id} is not found` };
    case "setting_rejected":
      return {
        kind: "invalid_input",
        message: `a setting of the profile was refused (${failure.rejected.kind})`,
      };
    case "unknown_extension":
      return { kind: "invalid_input", message: `${failure.name} is not installed` };
    case "thread_required":
      return { kind: "invalid_input", message: `layer ${failure.layer} needs a thread` };
    case "write_failed":
      return { kind: "io", message: `could not write ${failure.key}` };
    case "apply_partial":
      return {
        kind: "io",
        message: `the profile was only partly applied (${String(failure.written.length)} keys stay written)`,
      };
    case "corrupt":
      return { kind: "io", message: "the profiles file is damaged; it is kept as it is" };
    case "io":
      return { kind: "io", message: `the profiles file could not be read (${failure.code})` };
    case "conflict":
      return { kind: "io", message: `the profile ${failure.id} changed while it was read` };
    case "limit":
      return { kind: "io", message: `the profiles file is full (at most ${String(failure.max)})` };
    default:
      return assertNever(failure, "ProfileApplyFailure");
  }
}

function wireDiagnosticOf(entry: LoadDiagnostic): ExtDiagnostic {
  return {
    severity: entry.severity === "warning" || entry.severity === "info" ? "warning" : "error",
    code: entry.code,
    message: entry.message,
    ...(entry.path === undefined ? {} : { file: entry.path }),
  };
}

/** 파일은 복사됐지만 싣지 못한 결과. 재시작해도 같은 파일을 다시 싣는다 */
function notLoaded(
  placed: { readonly name: string; readonly version: string; readonly location: string },
  reason: ExtLoadFailureReason,
  diagnostics: readonly LoadDiagnostic[],
): ExtInstallResult {
  return {
    ...placed,
    appliesAt: "restart",
    loadFailure: { reason, diagnostics: diagnostics.slice(0, 64).map(wireDiagnosticOf) },
  };
}

export function createDevkitPort(deps: M4PortDeps, options: DevkitPortOptions = {}): DevkitPort {
  const templates = (): TemplateDirs | null =>
    options.templates !== undefined
      ? options.templates
      : locateTemplateDirs(process.env, hostResourceDir());
  const installedNames = (): readonly string[] =>
    deps.extUi
      ?.loader()
      ?.list()
      .map((info) => info.name) ?? [];

  // 시험 기록 저장소는 처음 쓸 때 만든다: 포트를 만드는 시점에는 환경이 없을 수 있다(시험이 빈 환경으로 만든다)
  let records: ExtTestRecordStore | undefined;
  const recordStore = (): ExtTestRecordStore => {
    records ??= createExtTestRecordStore({
      path: join(deps.env.configDir, EXT_TEST_FILE_NAME),
      fileLock: deps.env.fileLock,
      signal: deps.env.signal,
    });
    return records;
  };
  const newTestId = options.newTestId ?? (() => `ext-test-${randomUUID()}`);
  const isoNow = (): string => new Date(deps.env.clock.now()).toISOString();
  // 재생은 한 번에 하나다(끝날 때까지 기다리는 동기 호출이라 둘이 겹치면 같은 실행기를 두 번 쓴다). Test run 대화는 제한하지 않는다
  let replaying = false;

  /**
   * `ext.test.run`의 replay. 값과 개발 모드를 본 뒤 한 번에 하나를 잡고(표시는 첫 `await` 앞에 둔다: 겹친 두 번째 호출이 통과하지 않게 한다),
   * 설치된 그룹을 실행기로 재생하고 기록을 끝낸다
   */
  async function replay(params: ExtTestRunParams): Promise<Result<ExtTestRunResult, DevkitError>> {
    const maxCommits = params.options?.maxCommits ?? DEFAULT_MAX_COMMITS;
    if (!Number.isInteger(maxCommits) || maxCommits < 1 || maxCommits > MAX_COMMITS_LIMIT) {
      return err({
        kind: "invalid_input",
        message: `maxCommits must be an integer from 1 to ${String(MAX_COMMITS_LIMIT)}`,
      });
    }
    if (!isDevMode((key) => deps.env.settingValue(key))) {
      return err({ kind: "dev_mode_required", message: "replay runs only in development mode" });
    }
    if (replaying) {
      return err({
        kind: "denied",
        message: "another replay is running; replays run one at a time",
      });
    }
    replaying = true;
    try {
      return await replayInstalled(params.target, maxCommits);
    } finally {
      replaying = false;
    }
  }

  /** 설치된 확장이 재생할 수 있는 그룹인지 본 뒤 실행기로 재생한다. `replay`가 한 번에 하나를 잡은 채 부른다 */
  async function replayInstalled(
    target: string,
    maxCommits: number,
  ): Promise<Result<ExtTestRunResult, DevkitError>> {
    const source = deps.extUi;
    if (source === undefined) return noLocation();
    if (!(await hasInstalledFolder(source.extensionsDir, target))) return notInstalled(target);
    const dir = join(source.extensionsDir, target);
    const manifest = await installedManifest(dir);
    if (manifest === null) {
      return err({ kind: "invalid_input", message: `${target} has no readable manifest` });
    }
    if (!isGroupExtension(manifest)) {
      return err({
        kind: "invalid_input",
        message: `${target} is not a plugin group (its manifest has no group)`,
      });
    }
    const runner = options.replay ?? installedReplayRunner;
    return runReplay(runner, { target, dir, manifest, maxCommits });
  }

  /** 기록을 실행 중으로 남기고 실행기를 기다린다. 실행이 던지면 기록은 `failed`(보고 없음)이고 `io`를 돌려준다 */
  async function runReplay(
    runner: ReplayRunner,
    input: ReplayRunInput,
  ): Promise<Result<ExtTestRunResult, DevkitError>> {
    const store = recordStore();
    const testId = newTestId();
    const begun = await store.begin({
      testId,
      kind: "replay",
      target: input.target,
      state: "running",
      startedAt: isoNow(),
      durationMs: null,
      threadId: null,
      replay: null,
    });
    if (!begun.ok) return err(storeFailureOf(begun.error));
    const started = deps.env.clock.now();
    const ran = await attemptAsync(() => runner.run(input));
    const durationMs = Math.max(0, deps.env.clock.now() - started);
    let report: Result<ReplayReport, DevkitError>;
    if (!ran.ok) {
      report = err({
        kind: "io",
        message: `the replay of ${input.target} threw: ${messageOf(ran.error.cause)}`,
      });
    } else if (!ran.value.ok) {
      report = err(ran.value.error);
    } else {
      report = ok(replayReportOf(ran.value.value));
    }
    const replayed = report.ok ? report.value : null;
    const finished = await store.finish(testId, {
      state: replayed?.ok === true ? "passed" : "failed",
      durationMs,
      replay: replayed,
    });
    if (!finished.ok) return err(storeFailureOf(finished.error));
    if (!report.ok) return err(report.error);
    return ok({ testId, threadId: null });
  }

  /** `ext.test.run`의 testRun. 확장을 실을 수 있는지 보고 Test run 대화를 만들어 그 확장을 켜고 표지를 단 뒤 기록을 남긴다 */
  async function testRunThread(
    params: ExtTestRunParams,
  ): Promise<Result<ExtTestRunResult, DevkitError>> {
    const source = deps.extUi;
    if (source === undefined) return noLocation();
    if (!(await hasInstalledFolder(source.extensionsDir, params.target))) {
      return notInstalled(params.target);
    }
    const profiles = options.profiles;
    if (profiles === undefined) {
      return err({ kind: "io", message: "test runs are not connected in this host build" });
    }
    const profileId = params.options?.profileId;
    if (profileId !== undefined) {
      const found = await profiles.getProfile(profileId);
      if (!found.ok) return err(devkitErrorOfProfile(found.error));
    }
    // 켜짐 요청은 이 확장의 등록에 건다(프로필의 thread 층과 같은 통로다). 실리지 않은 확장은 등록이 없어 거절한다
    const infos = deps.env.registrations().filter((info) => info.extension === params.target);
    if (infos.length === 0) {
      return err({
        kind: "invalid_input",
        message: `${params.target} is not loaded, so it cannot run in a test run thread`,
      });
    }
    const workspace = params.options?.workspace;
    // 대화 이름은 대상 확장 이름이다(사람이 정한 제목이라 자동 제목이 덮지 않는다)
    const created = await deps.threads.create({
      ...(workspace === undefined ? {} : { workspace }),
      title: params.target,
      testRun: true,
    });
    const marked = await markTestRun(
      { threads: deps.threads, profiles, log: deps.log },
      created.threadId,
      profileId,
      "ext.test.run",
    );
    if (!marked.ok) return err(devkitErrorOfProfile(marked.error));
    for (const info of infos) {
      deps.env.toggles.request(info.id, true, "request", created.threadId);
    }
    const testId = newTestId();
    const begun = await recordStore().begin({
      testId,
      kind: "testRun",
      target: params.target,
      state: "running",
      startedAt: isoNow(),
      durationMs: null,
      threadId: created.threadId,
      replay: null,
    });
    if (!begun.ok) {
      await discardThread(created.threadId);
      return err(storeFailureOf(begun.error));
    }
    return ok({ testId, threadId: created.threadId });
  }

  /** 기록을 남기지 못해 만든 대화를 지운다. 지우지 못하면 로그만 남긴다(호출자는 원래 실패를 돌려준다) */
  async function discardThread(threadId: ThreadId): Promise<void> {
    const removed = await deps.threads.remove(threadId);
    if (!removed.ok) {
      deps.log.error("ext.test.run.cleanup_failed", { threadId, kind: removed.error.kind });
    }
  }

  return {
    kinds: () => Promise.resolve(KIND_CATALOG),
    scaffold: (input) => {
      const found = templates();
      if (found === null)
        return Promise.resolve(err({ kind: "io", message: "the extension templates are missing" }));
      return scaffoldExtension(input, { templates: found, installedNames: installedNames() });
    },
    validate: (dir) => validateExtensionDir(dir),
    validateComposition: (params) => ({
      issues: validateCompositionReport(params.composition, params.plugins).issues.flatMap(
        (found) =>
          found.severity === "info"
            ? []
            : [
                {
                  severity: found.severity,
                  code: found.code,
                  path: found.path,
                  message: found.message,
                },
              ],
      ),
    }),
    pack: (input) => packExtension(input),
    installPreview: async (input) => {
      const source = deps.extUi;
      if (source === undefined) return noLocation();
      return previewInstall(input, { extensionsDir: source.extensionsDir });
    },
    install: async (input) => {
      const source = deps.extUi;
      if (source === undefined) return noLocation();
      // 안전 모드와 managed 잠금은 신뢰 검사 앞에서 거절한다. 설치본은 평소 로더와 신뢰 경로로만 읽힌다
      if (source.installGate.safeMode())
        return err({ kind: "safe_mode_active", message: "install is refused in safe mode" });
      const incoming = await manifestIdentity(input.source);
      if (incoming !== null && source.installGate.managedLocked(incoming.name))
        return err({
          kind: "managed_locked",
          message: `${incoming.name} is locked by the managed scope`,
        });
      // 같은 이름의 설치본이 있으면 지우기 전에 버전 기록에 남겨 되돌릴 수 있게 한다(HS-108). 첫 설치는 남기지 않는다
      if (incoming !== null) {
        const location = join(source.extensionsDir, incoming.name);
        const current = await manifestIdentity(location);
        if (current !== null) {
          await source.history.record({
            name: current.name,
            version: current.version,
            // 앱 안 설치는 폴더를 가져오는 일이라 사용자가 둔 설치본이다. Plugin Builder 묶음(`authored`)이라는 표시는 폴더에 없다
            source: "user",
            extensionDir: location,
            manifestText: current.text,
            stateSchemaVersion: source.stateSchemaVersion(current.name),
          });
        }
      }
      const installed = await installExtension(input satisfies LinkInput, {
        extensionsDir: source.extensionsDir,
      });
      if (!installed.ok) return installed;
      // 같은 이름이 실행 중이면 호출자가 `ext.reload`로 단계 경계에서 바꾼다. 새 이름은 로더가 곧바로 싣는다(X.loading-trust §4.4.4)
      const name = installed.value.name;
      const placed = {
        name,
        version: installed.value.version,
        location: installed.value.location,
      };
      const loader = source.loader();
      if (loader === undefined) {
        return ok(notLoaded(placed, "loader_unavailable", []));
      }
      const current = loader.list().find((info) => info.name === name);
      if (current?.state === "active") {
        return ok({ ...placed, appliesAt: "nextStepBoundary", needsReload: true });
      }
      // 실려 있지 못한 옛 기록(거부, 오류, 꺼짐)은 새 설치본으로 다시 싣는다
      if (current !== undefined) await loader.unload(name);
      const loaded = await loader.loadInstalled(name, deps.env.signal);
      if (loaded.ok) return ok({ ...placed, appliesAt: loaded.value.appliesAt });
      const failure = loaded.error;
      switch (failure.kind) {
        case "already_loaded":
          return ok({ ...placed, appliesAt: "nextStepBoundary", needsReload: true });
        case "safe_mode":
          return ok(notLoaded(placed, "safe_mode", []));
        case "not_found":
          return ok(notLoaded(placed, "not_found", failure.diagnostics));
        case "not_active":
          return ok(notLoaded(placed, failure.state, failure.diagnostics));
        default:
          return assertNever(failure, "LoadInstalledFailure");
      }
    },
    removePreview: async (name) => {
      const source = deps.extUi;
      // 사용자 확장 위치가 없으면 지울 저장 테이블도 없는 것으로 본다
      if (source === undefined) return ok({ name, tables: [] });
      if (!(await hasInstalledFolder(source.extensionsDir, name))) return notInstalled(name);
      if (source.storage === undefined) return ok({ name, tables: [] });
      const counted = source.storage.preview(name);
      if (!counted.ok)
        return err({
          kind: "io",
          message: `could not read the stored data (${counted.error.kind})`,
        });
      // 와이어는 64개까지 싣는다. 지우기는 목록과 관계없이 그 확장의 테이블을 모두 지운다
      return ok({ name, tables: counted.value.tables.slice(0, 64) });
    },
    remove: async (name, removeOptions) => {
      const source = deps.extUi;
      if (source === undefined) return noLocation();
      if (removeOptions?.dropData === true) return removeWithData(source, name);
      const removed = await removeExtension(name, { extensionsDir: source.extensionsDir });
      if (!removed.ok) return removed;
      return ok({ name, appliesAt: await stopExtension(source, name) });
    },
    testRun: (params) => (params.kind === "replay" ? replay(params) : testRunThread(params)),
    testList: async () => {
      const listed = await recordStore().list();
      return listed.ok ? ok({ tests: listed.value }) : err(storeFailureOf(listed.error));
    },
  };
}

import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertNever, attemptAsync, err, ok, parseJson, type Result } from "@fresnel/contracts";
import {
  isId,
  toJsonValue,
  type ContextRef,
  type JsonValue,
  type ThreadId,
} from "@fresnel/contracts/conversation";
import {
  type CraftContextPort,
  EXTENSION_NAME_PATTERN,
  isOrchestrationExtension,
  validateManifest,
  type ExtensionManifest,
  type PluginSubmitError,
  type PluginSubmitPort,
  type PluginSubmitRequest,
  type PluginSubmitResult,
} from "@fresnel/contracts/extensions";
import type { DraftInfo, ExtTestRunParams, ExtTestRunResult } from "@fresnel/contracts/wire";
import type {
  CraftContextEntry,
  DevkitError,
  DraftSummary,
  ReplayReport,
  SourceFacts,
} from "@fresnel/contracts/services";
import type { PluginPortFailure } from "../../handlers/m5/plugins.ts";
import {
  detachMember,
  editDependencies,
  editMembers,
  KIND_CATALOG,
  locateTemplateDirs,
  MANIFEST_PATH,
  mergeMembers,
  packExtension,
  readDependencies,
  readMembers,
  scaffoldExtension,
  validateCompositionReport,
  validateExtensionDir,
  type TemplateDirs,
} from "@fresnel/core-authoring";
import type { DevkitPort } from "../../handlers/m4/devkit.ts";
import {
  markTestRun,
  type ProfilePortFailure,
  type ProfileTestRunPort,
} from "../../handlers/m4/profile-test-run.ts";
import { hostResourceDir } from "../../state-paths.ts";
import { hashPluginTree } from "../plugins/content-hash.ts";
import { messageOf } from "../../util.ts";
import type { M4PortDeps } from "./deps.ts";
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
  /**
   * 담당 AI의 제출 포트(`PluginSubmitPortKey`, 플랫폼 모듈 `fresnel.plugin-submit`이 낸다). 호출 때 읽는다.
   * 조립 루트가 확장 호스트에서 찾아 넘긴다. 없으면 제출은 `io`다
   */
  readonly submit?: () => PluginSubmitPort | undefined;
  /** 맥락 참조 읽기(`CraftContextPortKey`, M5c §4.8.8). 호출 때 읽는다. 없으면 `craftContext`는 `io`다 */
  readonly craftContext?: () => CraftContextPort | undefined;
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

/** 제출 포트의 실패를 제작 서비스 오류로 옮긴다. 검사 사유는 `reasons`로 싣는다(매니페스트 경로는 `/` 없이) */
function submitErrorOf(failure: PluginSubmitError): DevkitError {
  switch (failure.kind) {
    case "invalid":
      return {
        kind: "invalid_input",
        message: "the plugin folder is not valid",
        reasons: failure.issues.map((issue) => ({
          code: issue.code,
          ...(issue.path === "" ? {} : { field: issue.path.replace(/^\//, "") }),
          message: issue.message,
        })),
      };
    case "too_large":
      return {
        kind: "invalid_input",
        message: "the plugin folder is too large",
        reasons: [{ code: "too_large" }],
      };
    case "symlink_refused":
      return {
        kind: "invalid_input",
        message: "the plugin folder has a symbolic link",
        reasons: [{ code: "symlink_refused" }],
      };
    default:
      return assertNever(failure, "PluginSubmitError");
  }
}

/** 사용자 확장 위치에 그 이름의 설치본 폴더가 있는가. 이름이 규칙에 맞지 않거나 읽을 수 없으면 없는 것으로 본다(설치 폴더 매니페스트 읽기와 같은 규칙) */
async function hasInstalledFolder(extensionsDir: string, name: string): Promise<boolean> {
  if (!EXTENSION_NAME.test(name)) return false;
  return stat(join(extensionsDir, name)).then(
    (found) => found.isDirectory(),
    () => false,
  );
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

/** 프로필 실패를 포트 오류로 옮긴다. 없는 프로필과 검증 거절은 입력 문제(`not_found`, `invalid_input`), 저장 실패와 손상은 `io`다 */
function devkitErrorOfProfile(failure: ProfilePortFailure): DevkitError {
  switch (failure.kind) {
    case "not_found":
      return { kind: "not_found", message: `profile ${failure.id} is not found` };
    case "invalid":
      return {
        kind: "invalid_input",
        message: `the profile has ${String(failure.issues.filter((issue) => issue.severity === "error").length)} error(s)`,
      };
    case "builtin_protected":
      return { kind: "invalid_input", message: `profile ${failure.id} is built in` };
    case "plugin_not_in_profile":
    case "common_plugin":
      return { kind: "invalid_input", message: `${failure.plugin} is not removable here` };
    case "required_by_core":
      return { kind: "invalid_input", message: `${failure.plugin} is required by the core` };
    case "corrupt":
      return { kind: "io", message: "the profiles file is damaged; it is kept as it is" };
    case "io":
      return { kind: "io", message: `the profiles file could not be read (${failure.code})` };
    case "conflict":
      return { kind: "io", message: `the profile ${failure.id} changed while it was read` };
    case "limit":
      return { kind: "io", message: `the profiles file is full (at most ${String(failure.max)})` };
    // 프로젝트 쪽 실패(기본 프로필을 고를 때 대화 소속을 읽었다). 프로필 입력 문제가 아니라 읽기 문제다
    case "project":
      return {
        kind: "io",
        message: `the project list could not be read (${failure.failure.kind})`,
      };
    default:
      return assertNever(failure, "ProfilePortFailure");
  }
}

/** 플러그인 읽기 실패를 제작 오류로 옮긴다. 모르는 이름은 `not_found`, 나머지는 읽기 문제(`io`)다 */
function devkitErrorOfPlugin(failure: PluginPortFailure): DevkitError {
  return failure.kind === "unknown_plugin"
    ? { kind: "not_found", message: `${failure.name} is not known` }
    : { kind: "io", message: `the plugin could not be read (${failure.kind})` };
}

/** 초안 기록에서 빌더가 쓰는 칸만 옮긴다 */
function draftSummaryOf(info: DraftInfo): DraftSummary {
  return {
    draftId: info.draftId,
    parent: info.parent,
    contentHash: info.contentHash,
    createdAt: info.createdAt,
    originThreadId: info.originThreadId,
    submittedItemId: info.submittedItemId,
  };
}

/** 발견 참조의 근거 묶음(`findings.bundle`과 같은 값). 발견이 아니거나 읽지 못하면 null이다 */
function findingBundleOf(read: M4PortDeps["findingsBundle"], ref: ContextRef): JsonValue | null {
  if (ref.kind !== "finding" || read === undefined) return null;
  const found = read(ref.findingId);
  if (!found.ok) return null;
  return toJsonValue(found.value.bundle) ?? null;
}

/** 실제 경로(심볼릭 링크를 푼 값). 폴더가 없으면 풀지 않은 절대 경로다 */
async function realPathOf(path: string): Promise<string> {
  const real = await realpath(path).then(
    (value) => value,
    () => null,
  );
  return real ?? resolve(path);
}

/** `inner`가 `outer`와 같거나 그 안에 있는가. 이름이 접두로만 같은 형제 폴더(`/a/bc`와 `/a/b`)는 안이 아니다 */
function isInside(outer: string, inner: string): boolean {
  const rel = relative(outer, inner);
  return rel === "" || (rel.split(sep)[0] !== ".." && !isAbsolute(rel));
}

/**
 * 설치본이나 저장소 안의 폴더인가. 구성원 편집은 원본 폴더에서만 한다(M5c §4.9.3). 설치본은 `<설정>/extensions/<이름>`,
 * 검토본·후보·초안은 `<데이터>/plugin-store`(`reviewed/`, `candidates/`, `drafts/<id>/tree`) 아래에 있다
 */
async function storedCopyOf(deps: M4PortDeps, dir: string): Promise<boolean> {
  const target = await realPathOf(dir);
  const roots = [
    deps.env.pluginStoreDir,
    ...(deps.extUi === undefined ? [] : [deps.extUi.extensionsDir]),
  ];
  const resolved = await Promise.all(roots.map((root) => realPathOf(root)));
  return resolved.some((root) => isInside(root, target));
}

/**
 * 구성원·의존 편집의 원본 폴더 규칙. 절대 경로이고 설치본이나 저장소 안의 폴더면 `denied`다.
 * 상대 경로는 여기서 막지 않고 편집 함수가 `invalid_input`으로 거절한다
 */
async function sourceOnlyRefusal(deps: M4PortDeps, dir: string): Promise<DevkitError | undefined> {
  if (!isAbsolute(dir) || !(await storedCopyOf(deps, dir))) return undefined;
  return {
    kind: "denied",
    message:
      "the folder is an installed or stored copy, not a source folder; edit the source folder instead",
  };
}

const CRAFT_CONTEXT_MISSING: DevkitError = {
  kind: "io",
  message: "the craft context is not connected in this host build",
};

const PLUGIN_FACTS_MISSING: DevkitError = {
  kind: "io",
  message: "the plugin facts are not connected in this host build",
};

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
    if (!isOrchestrationExtension(manifest)) {
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
      const found = await profiles.get(profileId);
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
      // 테스트 대화도 고른 프로필을 저장한다(thread.started.profileId). 표지는 그 값을 그대로 적는다
      ...(profileId === undefined ? {} : { profileId }),
    });
    markTestRun(profiles, created.threadId, profileId);
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
    testRun: (params) => (params.kind === "replay" ? replay(params) : testRunThread(params)),
    submit: async (
      input: PluginSubmitRequest,
    ): Promise<Result<PluginSubmitResult, DevkitError>> => {
      const port = options.submit?.();
      if (port === undefined)
        return err({ kind: "io", message: "the plugin review flow is not connected" });
      const made = await port.submit(input);
      return made.ok ? ok(made.value) : err(submitErrorOf(made.error));
    },
    testList: async () => {
      const listed = await recordStore().list();
      return listed.ok ? ok({ tests: listed.value }) : err(storeFailureOf(listed.error));
    },
    // 구성원 편집은 원본 폴더만 고친다. 설치본과 저장소 안의 폴더는 `denied`로 거절하고, 아무것도 쓰지 않는다.
    // 설치도 승인도 `plugin.draft.create`도 부르지 않는다: 고친 폴더는 호출자가 다시 초안으로 만들어 검토를 다시 지난다
    editMembers: async (input) => {
      const refused = await sourceOnlyRefusal(deps, input.dir);
      if (refused !== undefined) return err(refused);
      const edited = await editMembers(input);
      if (edited.ok && input.ops.length > 0) deps.appEdits?.markDir(input.dir);
      return edited;
    },
    readMembers: (dir) => readMembers(dir),
    // 떼기는 원본 폴더를 읽고 새 폴더(`outDir`)에 쓴다. 두 폴더가 설치본이나 저장소 안이면 거절한다(`denied`).
    // 설치도 승인도 초안 만들기도 하지 않는다. 결과의 `outDir`로 화면이 `plugin.draft.create`를 부른다
    detachMember: async (input) => {
      const refused =
        (await sourceOnlyRefusal(deps, input.dir)) ?? (await sourceOnlyRefusal(deps, input.outDir));
      if (refused !== undefined) return err(refused);
      const detached = await detachMember(input, {
        templates: templates(),
        installedNames: installedNames(),
      });
      if (detached.ok) deps.appEdits?.markDir(input.outDir);
      return detached;
    },
    // 합치기는 원본 폴더들을 읽고 새 폴더(`outDir`)에 쓴다. 어느 폴더든 설치본이나 저장소 안이면 거절한다(`denied`).
    // 설치도 승인도 초안 만들기도 하지 않는다. 결과의 `outDir`로 화면이 `plugin.draft.create`를 부른다
    mergeMembers: async (input) => {
      const refusals = await Promise.all(
        [...input.dirs, input.outDir].map((dir) => sourceOnlyRefusal(deps, dir)),
      );
      const refused = refusals.find((found) => found !== undefined);
      if (refused !== undefined) return err(refused);
      const merged = await mergeMembers(input, { installedNames: installedNames() });
      if (merged.ok) deps.appEdits?.markDir(input.outDir);
      return merged;
    },
    // 의존 편집도 구성원 편집과 같은 규칙이다(원본 폴더만, 설치하지 않고 승인하지 않는다)
    editDependencies: async (input) => {
      const refused = await sourceOnlyRefusal(deps, input.dir);
      if (refused !== undefined) return err(refused);
      const edited = await editDependencies(input);
      if (edited.ok && input.ops.length > 0) deps.appEdits?.markDir(input.dir);
      return edited;
    },
    readDependencies: (dir) => readDependencies(dir),
    // 원본 폴더의 자리는 플러그인 서비스가 안다(`get`의 `source`: 없으면 null). 서비스의 `matchesReviewed`는 마지막 훑기의
    // 캐시라서 원본을 고친 뒤에는 낡는다. 그래서 다른지는 지금 폴더의 내용 해시와 검토본 해시(카드)를 대조해 정한다.
    // 번들이고 원본이 없으면 고칠 수 없다(`bundled_not_editable`)
    sourceOf: async (name) => {
      const facts = deps.plugins;
      if (facts === undefined) return err(PLUGIN_FACTS_MISSING);
      const got = await facts.get(name);
      if (!got.ok) return err(devkitErrorOfPlugin(got.error));
      const bundled = got.value.card.origin.kind === "bundled";
      const source = got.value.source;
      if (source === null) {
        return err(
          bundled
            ? {
                kind: "bundled_not_editable",
                message: `${name} is built in and has no source folder`,
              }
            : { kind: "not_found", message: `${name} has no source folder` },
        );
      }
      const now = hashPluginTree(source.path);
      if (!now.ok) {
        return err({
          kind: "io",
          message: `the source folder of ${name} could not be read (${now.error.kind})`,
        });
      }
      const found: SourceFacts = {
        dir: source.path,
        bundled,
        differsFromReviewed: now.value.contentHash !== got.value.card.review.currentHash,
      };
      return ok(found);
    },
    // 맥락 참조는 대화의 `craft.context` 사건에서 읽는다(포트). 발견 참조는 근거 묶음을 싣는다
    // 상주 판정(M5c §4.8.6). 대화를 읽는 것만 하므로 포트가 없어도 답한다
    isCraftChat: (threadId): Promise<Result<boolean, DevkitError>> => {
      if (!isId("thr", threadId)) {
        return Promise.resolve(
          err({ kind: "not_found", message: `${threadId} is not a conversation` }),
        );
      }
      const found = deps.threads.isCraftChat(threadId);
      return Promise.resolve(
        found.ok
          ? ok(found.value)
          : err({
              kind: "io",
              message: `the conversation could not be read (${found.error.kind})`,
            }),
      );
    },
    craftContext: async (threadId) => {
      const port = options.craftContext?.();
      if (port === undefined) return err(CRAFT_CONTEXT_MISSING);
      if (!isId("thr", threadId)) {
        return err({ kind: "not_found", message: `${threadId} is not a conversation` });
      }
      const read = await port.read(threadId);
      if (!read.ok) {
        return err({
          kind: "io",
          message: `the craft context could not be read (${read.error.code})`,
        });
      }
      const refs: CraftContextEntry[] = read.value.map((ref) => ({
        ref,
        bundle: findingBundleOf(deps.findingsBundle, ref),
      }));
      return ok({ threadId, refs });
    },
    draftList: async (name) => {
      const facts = deps.plugins;
      if (facts === undefined) return err(PLUGIN_FACTS_MISSING);
      const listed = await facts.draftList(name);
      if (!listed.ok) return err(devkitErrorOfPlugin(listed.error));
      return ok({ drafts: listed.value.drafts.map(draftSummaryOf) });
    },
  };
}

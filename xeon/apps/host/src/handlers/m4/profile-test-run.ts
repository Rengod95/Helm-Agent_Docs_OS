import { assertNever, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  TestRunControlError,
  TestRunControlResult,
  TestRunPhaseResult,
  TraceTurnResult,
} from "@fresnel/contracts/extensions";
import type { ReadFailure, StoreError } from "@fresnel/contracts/records";
import type { SettingScope } from "@fresnel/contracts/settings";
import {
  wireError,
  type CommonGetResult,
  type CommonPutParams,
  type ProfileCloneParams,
  type ProfileDefaultForResult,
  type ProfileDefaultResetParams,
  type ProfileDefaultResetResult,
  type ProfileDeleteResult,
  type ProfileGetResult,
  type ProfileInput,
  type ProfileIssue,
  type ProfileListResult,
  type ProfilePreviewParams,
  type ProfilePreviewResult,
  type ProfilePutResult,
  type ProfileRemovePluginParams,
  type ProfileRemovePluginResult,
  type Profile,
  type TestRunMarker,
  type Unsubscribe,
  type WireError,
  type WireHandler,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import type {
  ProfileStoreFailure,
  ProfilesChange,
  ProfilesWritten,
} from "../../assembly/m4/profile-store.ts";
import type { PluginEditIssue, PluginEditRequest } from "../../assembly/m4/plugin-edit.ts";
import { settingsFileInvalidDetails } from "../../settings-file-details.ts";
import { wireErrorOfProject, type ProjectPortFailure } from "./project.ts";

// 프로필·Test run·Trace wire(M5c §3.4, §3.6). 처리기는 값 검사와 오류 옮기기만 하고, 저장·검증·계산은 포트 구현
// (`assembly/m4/profile-test-run-port.ts`)이 한다. 알림 `profile.changed`는 포트의 `onProfilesChanged`를 연결 허브(`handlers/events.ts`)가 듣고 전체 연결에 보낸다.

// `types.ts`가 `assembly/m4/index.ts`를 거쳐 이 파일을 import하므로 이 파일은 `types.ts`에 닿는 모듈(`store-error.ts`, `owner.ts`)을 import하지 않는다
// (순환 금지, depcruise no-circular). 저장소 오류를 와이어 오류로 옮기는 함수는 조립이 포트에 넣어 준다.

/** 호스트 조립이 넘기는 와이어 오류 변환. `store-error.ts`의 `wireErrorOfStore`, `owner.ts`의 `threadLocked`다 */
export interface HostErrorMappers {
  ofStore(error: StoreError, where: string): WireError;
  threadLocked(): WireError;
}

/** 프로필 포트의 실패. 저장소 실패와 검증·규칙 위반을 한 합집합으로 둔다 */
export type ProfilePortFailure =
  | ProfileStoreFailure
  | { readonly kind: "builtin_protected"; readonly id: string }
  | { readonly kind: "invalid"; readonly issues: readonly ProfileIssue[] }
  | { readonly kind: "plugin_not_in_profile"; readonly plugin: string }
  | { readonly kind: "common_plugin"; readonly plugin: string }
  /** 코어 필수 단위를 프로필(또는 공통 묶음)에서 빼려 한다(M5c §4.1.17) */
  | { readonly kind: "required_by_core"; readonly plugin: string }
  /** 프로젝트 쪽 실패(`profile.defaultFor`가 대화의 소속을 읽을 때) */
  | { readonly kind: "project"; readonly failure: ProjectPortFailure };

/** 승인의 프로필 반영이 낼 수 있는 실패. `plugin_invalid`는 대상 프로필 가운데 검사에 실패한 것이 있다는 뜻이다(M5c §4.7.3) */
export type PluginEditFailure =
  | ProfilePortFailure
  | { readonly kind: "plugin_invalid"; readonly issues: readonly PluginEditIssue[] };

/** `profile.preview`의 대상. 저장된 프로필이거나 아직 저장하지 않은 입력이다 */
type PreviewSource =
  | { readonly kind: "stored"; readonly id: string }
  | { readonly kind: "draft"; readonly draft: ProfileInput };

export interface ProfilePreviewRequest {
  readonly source: PreviewSource;
  readonly threadId: ThreadId | undefined;
}

/** 처리기가 쓰는 포트 */
export interface ProfileTestRunPort {
  readonly errors: HostErrorMappers;
  list(): Promise<Result<ProfileListResult, ProfilePortFailure>>;
  get(id: string): Promise<Result<Profile, ProfilePortFailure>>;
  put(
    input: ProfileInput,
    baseRev: number | null,
  ): Promise<Result<ProfilePutResult, ProfilePortFailure>>;
  remove(id: string): Promise<Result<ProfileDeleteResult, ProfilePortFailure>>;
  clone(params: ProfileCloneParams): Promise<Result<ProfileGetResult, ProfilePortFailure>>;
  commonGet(): Promise<Result<CommonGetResult, ProfilePortFailure>>;
  commonPut(params: CommonPutParams): Promise<Result<CommonGetResult, ProfilePortFailure>>;
  preview(
    request: ProfilePreviewRequest,
  ): Promise<Result<ProfilePreviewResult, ProfilePortFailure>>;
  defaultFor(
    workspace: string | undefined,
  ): Promise<Result<ProfileDefaultForResult, ProfilePortFailure>>;
  removePlugin(
    params: ProfileRemovePluginParams,
  ): Promise<Result<ProfileRemovePluginResult, ProfilePortFailure>>;
  defaultReset(
    params: ProfileDefaultResetParams,
  ): Promise<Result<ProfileDefaultResetResult, ProfilePortFailure>>;
  /** 승인의 프로필 검사(쓰지 않는다). 대상 프로필 하나라도 오류면 `plugin_invalid`다(M5c §4.7.3) */
  checkPluginEdit(request: PluginEditRequest): Promise<Result<void, PluginEditFailure>>;
  /** 승인의 프로필 쓰기. 검사와 쓰기가 한 잠금 안에서 돈다. 돌려주는 값은 바뀐 프로필 id(공통 묶음은 `common`)다 */
  applyPluginEdit(
    request: PluginEditRequest,
  ): Promise<Result<readonly string[], PluginEditFailure>>;
  /** 이 호스트가 프로필 파일을 바꿀 때마다 부른다(연결 허브가 `profile.changed`로 전한다) */
  onProfilesChanged(listener: (change: ProfilesChange) => void): Unsubscribe;
  /** 같은 순간에 쓴 내용 전체를 준다. 대화별 켜짐 집합의 복사가 응답 전에 맞는다(M5c §4.1.4) */
  onProfilesWritten(listener: (written: ProfilesWritten) => void): Unsubscribe;
  /** wire가 준 문자열 id를 thread id로 읽고 thread가 있는지 본다. 모양이 틀리거나 없으면 undefined */
  lookupThread(raw: string): Result<ThreadId | undefined, ReadFailure>;
  /** 계측 읽기(X-15). 꺼졌으면 `traceEnabled`가 거짓이고, 버퍼 밖이거나 모양이 틀린 turn id면 `retained`가 거짓이다 */
  traceTurn(threadId: ThreadId, rawTurnId: string): TraceTurnResult;
  /** Test run 대화의 표지. Test run이 아니면 undefined */
  testRunMarker(threadId: ThreadId): TestRunMarker | undefined;
  /**
   * Test run 대화를 표지한다. `profileId`는 표지에 적을 값이고 대화에 적용하지 않는다.
   * `runGroupId`는 `testRun.start`의 묶음 id다(없으면 표지에 싣지 않는다)
   */
  registerTestRun(threadId: ThreadId, profileId: string | null, runGroupId?: string): void;
  controlTestRun(
    threadId: ThreadId,
    op: "pause" | "resume" | "step",
  ): Result<TestRunControlResult, TestRunControlError>;
  testRunPhase(threadId: ThreadId): Result<TestRunPhaseResult, TestRunControlError>;
}

export type ProfileTestRunMethods =
  | "profile.list"
  | "profile.get"
  | "profile.put"
  | "profile.delete"
  | "profile.clone"
  | "profile.common.get"
  | "profile.common.put"
  | "profile.preview"
  | "profile.defaultFor"
  | "profile.removePlugin"
  | "profile.default.reset"
  | "trace.turn"
  | "testRun.pause"
  | "testRun.resume"
  | "testRun.step"
  | "testRun.phase";

/** 설정 저장소 쓰기가 실패한 이유. `types.ts`의 `SettingsWriteFailure`와 같은 합집합이다(구조가 같아 그대로 대입된다) */
export type ProfileWriteFailure =
  | { readonly kind: "thread_required"; readonly scope: SettingScope }
  | Extract<StoreError, { readonly kind: "thread_not_found" }>
  | { readonly kind: "not_owner"; readonly threadId: ThreadId }
  | { readonly kind: "workspace_required"; readonly scope: SettingScope }
  | { readonly kind: "untrusted_project"; readonly workspace: string }
  | { readonly kind: "managed_read_only" }
  | {
      readonly kind: "file_invalid";
      readonly path: string;
      readonly line: number | null;
      readonly column: number | null;
    }
  | { readonly kind: "file_unwritable"; readonly path: string; readonly code: string }
  | { readonly kind: "key_reused"; readonly requestKey: string }
  | StoreError;

// ── 오류 ────────────────────────────────────────────────────────────────
// `profile.*`·`testRun.*` kind와 코드(3301~3313)는 계약 `WIRE_ERRORS`가 정한다(F.wire-settings.spec §3.5.2). 이 파일은 실패 값을 kind로 옮기기만 한다.

/** 프로필 실패를 와이어 오류로 옮긴다 */
export function wireErrorOfProfile(failure: ProfilePortFailure): WireError {
  switch (failure.kind) {
    case "not_found":
      return wireError("profile.notFound", { details: { id: failure.id } });
    case "conflict":
      return wireError("profile.conflict", {
        details: { id: failure.id, rev: failure.rev, baseRev: failure.baseRev },
      });
    case "corrupt":
      return wireError("profile.fileCorrupt", {
        details: { reason: failure.reason.slice(0, 200) },
      });
    case "io":
      return wireError("store.io", {
        message: "profiles.json cannot be read or written",
        details: { code: failure.code.slice(0, 64) },
      });
    case "limit":
      return wireError("profile.limit", { details: { max: failure.max } });
    case "builtin_protected":
      return wireError("profile.builtinProtected", { details: { id: failure.id } });
    case "invalid":
      return wireError("profile.invalid", { details: { issues: failure.issues.slice(0, 64) } });
    case "plugin_not_in_profile":
      return wireError("profile.pluginNotInProfile", { details: { name: failure.plugin } });
    case "common_plugin":
      return wireError("profile.commonPlugin", { details: { name: failure.plugin } });
    case "required_by_core":
      return wireError("plugin.requiredByCore", { details: { plugin: failure.plugin } });
    case "project":
      return wireErrorOfProject(failure.failure);
    default:
      return assertNever(failure, "ProfilePortFailure");
  }
}

function wireErrorOfControl(failure: TestRunControlError): WireError {
  switch (failure.kind) {
    case "not_a_test_run":
      return wireError("testRun.notATestRun");
    case "not_paused":
      return wireError("testRun.notPaused");
    case "not_available":
      return wireError("testRun.unavailable");
    default:
      return assertNever(failure.kind, "TestRunControlError");
  }
}

/**
 * Test run 대화에 표지를 단다(W-34). `thread.create`(testRun)와 `ext.test.run`(testRun)이 같이 쓴다.
 * 프로필은 대화에 적용하지 않는다(대화에 프로필 id를 저장하는 일은 아직 없다). 표지는 `profileId`를 그대로 적는다.
 */
export function markTestRun(
  profiles: Pick<ProfileTestRunPort, "registerTestRun">,
  threadId: ThreadId,
  profileId: string | undefined,
  runGroupId?: string,
): void {
  profiles.registerTestRun(threadId, profileId ?? null, runGroupId);
}

/** 설정 쓰기 실패를 와이어 오류로 옮긴다. `where`는 메시지 머리말이다(설정 쓰기 호출자가 정한다) */
export function wireErrorOfWrite(
  key: string,
  failure: ProfileWriteFailure,
  errors: HostErrorMappers,
  where = "settings.write",
): WireError {
  switch (failure.kind) {
    case "untrusted_project":
      return wireError("profile.trustRequired", { details: { workspace: failure.workspace } });
    case "thread_required":
      return wireError("jsonrpc.invalidParams", {
        details: { issues: [{ path: "threadId", message: "threadId is required for this scope" }] },
      });
    case "workspace_required":
      return wireError("settings.scopeNotAllowed", {
        details: { key, scope: failure.scope, reason: "workspaceRequired" },
      });
    case "managed_read_only":
      return wireError("settings.scopeNotAllowed", {
        details: { key, scope: "managed", reason: "managedReadOnly" },
      });
    case "not_owner":
      return errors.threadLocked();
    case "file_invalid":
      return wireError("store.io", {
        message: `${where}: the settings file is not a JSON object`,
        details: settingsFileInvalidDetails(failure),
      });
    case "file_unwritable":
      return wireError("store.io", {
        message: `${where}: the settings file cannot be written`,
        details: { code: failure.code.slice(0, 64) },
      });
    case "key_reused":
      return wireError("internal", { message: `${where}: settings request key reused` });
    case "thread_not_found":
    case "busy":
    case "disk_full":
    case "io":
    case "ownership_lost":
    case "read_only":
    case "row_invalid":
      return errors.ofStore(failure, where);
    default:
      return assertNever(failure, "ProfileWriteFailure");
  }
}

// ── 처리기 ──────────────────────────────────────────────────────────────

/** wire의 thread id 문자열을 읽는다. 모양이 틀리거나 없는 thread는 3001이다 */
function requireThread(port: ProfileTestRunPort, raw: string, where: string): ThreadId {
  const found = port.lookupThread(raw);
  if (!found.ok) throw port.errors.ofStore(found.error, `${where} thread lookup`);
  if (found.value === undefined) throw wireError("thread.notFound", { details: { threadId: raw } });
  return found.value;
}

function okOrThrow<T>(result: Result<T, ProfilePortFailure>): T {
  if (!result.ok) throw wireErrorOfProfile(result.error);
  return result.value;
}

function previewRequestOf(
  port: ProfileTestRunPort,
  params: ProfilePreviewParams,
): ProfilePreviewRequest {
  const threadId =
    params.threadId === undefined
      ? undefined
      : requireThread(port, params.threadId, "profile.preview");
  if ("draft" in params) return { source: { kind: "draft", draft: params.draft }, threadId };
  return { source: { kind: "stored", id: params.id }, threadId };
}

function controlHandler(
  port: ProfileTestRunPort,
  op: "pause" | "resume" | "step",
): WireHandler<"testRun.pause" | "testRun.resume" | "testRun.step"> {
  return (params) => {
    const threadId = requireThread(port, params.threadId, `testRun.${op}`);
    const done = port.controlTestRun(threadId, op);
    if (!done.ok) return Promise.reject(wireErrorOfControl(done.error));
    return Promise.resolve(done.value);
  };
}

export function createProfileTestRunHandlers(
  port: ProfileTestRunPort,
): Pick<WireHandlers, ProfileTestRunMethods> {
  return {
    "profile.list": async () => okOrThrow(await port.list()),
    "profile.get": async (params) => ({ profile: okOrThrow(await port.get(params.id)) }),
    "profile.put": async (params) => okOrThrow(await port.put(params.profile, params.baseRev)),
    "profile.delete": async (params) => okOrThrow(await port.remove(params.id)),
    "profile.clone": async (params) => okOrThrow(await port.clone(params)),
    "profile.common.get": async () => okOrThrow(await port.commonGet()),
    "profile.common.put": async (params) => okOrThrow(await port.commonPut(params)),
    "profile.preview": async (params) =>
      okOrThrow(await port.preview(previewRequestOf(port, params))),
    "profile.defaultFor": async (params) => {
      const workspace = params.workspace;
      return okOrThrow(await port.defaultFor(workspace));
    },
    "profile.removePlugin": async (params) => okOrThrow(await port.removePlugin(params)),
    "profile.default.reset": async (params) => okOrThrow(await port.defaultReset(params)),
    "trace.turn": (params) => {
      const threadId = requireThread(port, params.threadId, "trace.turn");
      return Promise.resolve(port.traceTurn(threadId, params.turnId));
    },
    "testRun.pause": controlHandler(port, "pause"),
    "testRun.resume": controlHandler(port, "resume"),
    "testRun.step": controlHandler(port, "step"),
    "testRun.phase": (params) => {
      const threadId = requireThread(port, params.threadId, "testRun.phase");
      const phase = port.testRunPhase(threadId);
      if (!phase.ok) return Promise.reject(wireErrorOfControl(phase.error));
      return Promise.resolve(phase.value);
    },
  };
}

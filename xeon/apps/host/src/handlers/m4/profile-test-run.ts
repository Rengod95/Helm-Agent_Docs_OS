import { assertNever, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  TestRunControlError,
  TestRunControlResult,
  TestRunPhaseResult,
  TraceTurnResult,
} from "@fresnel/contracts/extensions";
import type { ReadFailure, StoreError } from "@fresnel/contracts/records";
import type { SettingScope, WriteCheck } from "@fresnel/contracts/settings";
import {
  wireError,
  type WireError,
  type Profile,
  type ProfileApplyResult,
  type ProfileInput,
  type ProfileLayer,
  type ProfileListResult,
  type ProfilePreviewResult,
  type TestRunMarker,
  type Unsubscribe,
  type WireHandler,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import type { ProfileStoreFailure, ProfilesChange } from "../../assembly/m4/profile-store.ts";

// 프로필·Test run·Trace wire(`spec-deltas/t-wb.md`). 처리기는 값 검사와 오류 옮기기만 하고, 저장·적용·되돌리기는 포트 구현
// (`assembly/m4/profile-test-run-port.ts`)이 한다. 알림 `profile.changed`는 포트의 `onProfilesChanged`를 연결 허브(`handlers/events.ts`)가 듣고 전체 연결에 보낸다.

// `types.ts`가 `assembly/m4/index.ts`를 거쳐 이 파일을 import하므로 이 파일은 `types.ts`에 닿는 모듈(`store-error.ts`, `owner.ts`)을 import하지 않는다
// (순환 금지, depcruise no-circular). 저장소 오류를 와이어 오류로 옮기는 두 함수는 조립이 포트에 넣어 준다.

/** 호스트 조립이 넘기는 와이어 오류 변환. `store-error.ts`의 `wireErrorOfStore`, `owner.ts`의 `threadLocked`다 */
export interface HostErrorMappers {
  ofStore(error: StoreError, where: string): WireError;
  threadLocked(): WireError;
}

/** 설정 저장소 쓰기가 실패한 이유. `types.ts`의 `SettingsWriteFailure`와 같은 합집합이다(구조가 같아 그대로 대입된다) */
export type ProfileWriteFailure =
  | { readonly kind: "thread_required"; readonly scope: SettingScope }
  | Extract<StoreError, { readonly kind: "thread_not_found" }>
  | { readonly kind: "not_owner"; readonly threadId: ThreadId }
  | { readonly kind: "workspace_required"; readonly scope: SettingScope }
  | { readonly kind: "untrusted_project"; readonly workspace: string }
  | { readonly kind: "managed_read_only" }
  | { readonly kind: "file_invalid"; readonly path: string }
  | { readonly kind: "file_unwritable"; readonly path: string; readonly code: string }
  | { readonly kind: "key_reused"; readonly requestKey: string }
  | StoreError;

/** 쓰기 검사나 쓰기가 막은 키 하나 */
export type ProfileApplyFailure =
  | ProfileStoreFailure
  /** 설정 검사(카탈로그, 범위, 값)가 거절했다. 아무것도 쓰지 않았다 */
  | { readonly kind: "setting_rejected"; readonly rejected: Extract<WriteCheck, { ok: false }> }
  /** 쓰는 중 실패했고 이미 쓴 키는 모두 되돌렸다 */
  | {
      readonly kind: "write_failed";
      readonly key: string;
      readonly failure: ProfileWriteFailure;
    }
  /** `layer`가 thread나 project인데 `threadId`가 없다 */
  | { readonly kind: "thread_required"; readonly layer: ProfileLayer }
  /** thread 층에서 켜거나 끌 확장이 설치되어 있지 않다 */
  | { readonly kind: "unknown_extension"; readonly name: string }
  /** 되돌리기까지 실패했다. `written`은 아직 쓰인 채 남은 키 */
  | {
      readonly kind: "apply_partial";
      readonly written: readonly string[];
      readonly failed: string;
    };

export interface ProfileApplyRequest {
  readonly id: string;
  readonly layer: ProfileLayer;
  readonly threadId: ThreadId | undefined;
}

/** 처리기가 쓰는 포트 */
export interface ProfileTestRunPort {
  readonly errors: HostErrorMappers;
  listProfiles(): Promise<Result<ProfileListResult, ProfileStoreFailure>>;
  getProfile(id: string): Promise<Result<Profile, ProfileStoreFailure>>;
  putProfile(
    input: ProfileInput,
    baseRev: number | null,
  ): Promise<Result<Profile, ProfileStoreFailure>>;
  deleteProfile(id: string): Promise<Result<{ readonly rev: number }, ProfileStoreFailure>>;
  /** 원자적: 하나라도 실패하면 이미 쓴 키를 이전 값으로 되돌린다 */
  applyProfile(
    request: ProfileApplyRequest,
  ): Promise<Result<ProfileApplyResult, ProfileApplyFailure>>;
  /** 아무것도 쓰지 않고 적용 결과를 계산한다 */
  previewProfile(
    request: ProfileApplyRequest,
  ): Promise<Result<ProfilePreviewResult, ProfileApplyFailure>>;
  /** 이 호스트가 프로필 파일을 바꿀 때마다 부른다(연결 허브가 `profile.changed`로 전한다) */
  onProfilesChanged(listener: (change: ProfilesChange) => void): Unsubscribe;
  /** wire가 준 문자열 id를 thread id로 읽고 thread가 있는지 본다. 모양이 틀리거나 없으면 undefined */
  lookupThread(raw: string): Result<ThreadId | undefined, ReadFailure>;
  /** 계측 읽기(X-15). 꺼졌으면 `traceEnabled`가 거짓이고, 버퍼 밖이거나 모양이 틀린 turn id면 `retained`가 거짓이다 */
  traceTurn(threadId: ThreadId, rawTurnId: string): TraceTurnResult;
  /** Test run 대화의 표지. Test run이 아니면 undefined */
  testRunMarker(threadId: ThreadId): TestRunMarker | undefined;
  /** `thread.create { testRun }`이 만든 대화를 Test run으로 적는다 */
  registerTestRun(threadId: ThreadId, profileId: string | null): void;
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
  | "profile.apply"
  | "profile.preview"
  | "trace.turn"
  | "testRun.pause"
  | "testRun.resume"
  | "testRun.step"
  | "testRun.phase";

// ── 오류 ────────────────────────────────────────────────────────────────
// `profile.*`·`testRun.*` kind와 코드(3301~3313)는 계약 `WIRE_ERRORS`가 정한다(F.wire-settings.spec §3.5.2). 이 파일은 실패 값을 kind로 옮기기만 한다.

function invalidParam(path: string, message: string): WireError {
  return wireError("jsonrpc.invalidParams", { details: { issues: [{ path, message }] } });
}

function wireErrorOfProfileStore(failure: ProfileStoreFailure): WireError {
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
    default:
      return assertNever(failure, "ProfileStoreFailure");
  }
}

/** 설정 쓰기 실패를 와이어 오류로 옮긴다. `where`는 메시지와 저장소 오류 머리말이다(프로필 적용은 `profile.apply`, 순서 쓰기는 메서드 이름) */
export function wireErrorOfWrite(
  key: string,
  failure: ProfileWriteFailure,
  errors: HostErrorMappers,
  where = "profile.apply",
): WireError {
  switch (failure.kind) {
    case "untrusted_project":
      return wireError("profile.trustRequired", { details: { workspace: failure.workspace } });
    case "thread_required":
      return invalidParam("threadId", "threadId is required for this layer");
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
        details: { code: "settings_file_invalid" },
      });
    case "file_unwritable":
      return wireError("store.io", {
        message: `${where}: the settings file cannot be written`,
        details: { code: failure.code.slice(0, 64) },
      });
    case "key_reused":
      return wireError("internal", { message: `${where}: settings request key reused` });
    case "busy":
    case "disk_full":
    case "io":
    case "ownership_lost":
    case "read_only":
    case "thread_not_found":
    case "row_invalid":
      return errors.ofStore(failure, where);
    default:
      return assertNever(failure, "ProfileWriteFailure");
  }
}

/** 적용 실패를 와이어 오류로 옮긴다. `ProfileStoreFailure`는 같은 옮김을 쓴다 */
export function wireErrorOfApply(
  failure: ProfileApplyFailure,
  errors: HostErrorMappers,
): WireError {
  switch (failure.kind) {
    case "setting_rejected": {
      const details: Record<string, unknown> = { ...failure.rejected.details };
      const issues = details["issues"];
      if (Array.isArray(issues)) details["issues"] = issues.slice(0, 20);
      return wireError(failure.rejected.kind, { details });
    }
    case "write_failed":
      return wireErrorOfWrite(failure.key, failure.failure, errors);
    case "thread_required":
      return invalidParam("threadId", `threadId is required for layer ${failure.layer}`);
    case "unknown_extension":
      return wireError("settings.unknownKey", { details: { key: `ext.${failure.name}.enabled` } });
    case "apply_partial":
      return wireError("profile.applyPartial", {
        details: { written: failure.written.slice(0, 256), failed: failure.failed },
      });
    case "corrupt":
    case "io":
    case "not_found":
    case "conflict":
    case "limit":
      return wireErrorOfProfileStore(failure);
    default:
      return assertNever(failure, "ProfileApplyFailure");
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

// ── 처리기 ──────────────────────────────────────────────────────────────

/** wire의 thread id 문자열을 읽는다. 모양이 틀리거나 없는 thread는 3001이다 */
function requireThread(port: ProfileTestRunPort, raw: string, where: string): ThreadId {
  const found = port.lookupThread(raw);
  if (!found.ok) throw port.errors.ofStore(found.error, `${where} thread lookup`);
  if (found.value === undefined) throw wireError("thread.notFound", { details: { threadId: raw } });
  return found.value;
}

function applyRequestOf(
  port: ProfileTestRunPort,
  params: { readonly id: string; readonly threadId?: string; readonly layer?: ProfileLayer },
  where: string,
): ProfileApplyRequest {
  // 생략한 층은 사용자 층이다(T-REG §7 4번 [제안])
  const layer = params.layer ?? "user";
  const threadId =
    params.threadId === undefined ? undefined : requireThread(port, params.threadId, where);
  if (layer !== "user" && threadId === undefined) {
    throw invalidParam("threadId", `threadId is required for layer ${layer}`);
  }
  return { id: params.id, layer, threadId };
}

function failWith<T>(result: Result<T, ProfileStoreFailure>): T {
  if (!result.ok) throw wireErrorOfProfileStore(result.error);
  return result.value;
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
    "profile.list": async () => failWith(await port.listProfiles()),
    "profile.get": async (params) => ({ profile: failWith(await port.getProfile(params.id)) }),
    "profile.put": async (params) => ({
      profile: failWith(await port.putProfile(params.profile, params.baseRev)),
    }),
    "profile.delete": async (params) => failWith(await port.deleteProfile(params.id)),
    "profile.apply": async (params) => {
      const request = applyRequestOf(port, params, "profile.apply");
      const applied = await port.applyProfile(request);
      if (!applied.ok) throw wireErrorOfApply(applied.error, port.errors);
      return applied.value;
    },
    "profile.preview": async (params) => {
      const request = applyRequestOf(port, params, "profile.preview");
      const previewed = await port.previewProfile(request);
      if (!previewed.ok) throw wireErrorOfApply(previewed.error, port.errors);
      return previewed.value;
    },
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

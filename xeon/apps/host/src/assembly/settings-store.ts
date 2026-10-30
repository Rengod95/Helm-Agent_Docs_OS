import { createHash } from "node:crypto";
import { access, constants, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertNever,
  attemptAsync,
  err,
  ok,
  parseJson,
  type Logger,
  type Result,
} from "@xeon/contracts";
import { toJsonValue, type IdFactory, type ThreadId } from "@xeon/contracts/conversation";
import type { SessionService } from "@xeon/contracts/records";
import type { ScopeStack, SettingKey, SettingScope } from "@xeon/contracts/settings";
import type {
  SettingsFileScope,
  SettingsWritableFileScope,
  Unsubscribe,
} from "@xeon/contracts/wire";
import type { FileLock, FileLockError } from "@xeon/platform-os";
import type {
  SettingsFileFailure,
  SettingsFileRead,
  SettingsStorePort,
  SettingsWriteFailure,
} from "../types.ts";
import type { SettingsEngine } from "./settings-engine.ts";
import { replaceFileAtomically, type ProjectTrust } from "./trust.ts";

// L4.host-service.spec §3.3.2 SettingsStorePort. 설정 파일 범위의 쓰기와 project·local 파일 읽기는 호스트 소유다
// (L1.persistence.spec §6.2 마지막 [제안]). user는 `<config>/settings.json`, project·local은 신뢰한 작업 폴더의
// `.xeon/settings.json`·`.xeon/settings.local.json`, session은 `settings.changed` 커밋이다. 조립 루트 코드(DR-14 예외 2).
// 파일을 바꾸는 읽고-고치고-쓰기는 모두 L0.os의 파일 잠금(`<path>.lock`) 안에서 한다(M3-REQ-82, HS-98): 호스트 둘이 같은 파일을
// 동시에 고쳐도 앞 쓰기를 덮지 않는다. 읽기만 하는 쪽은 잠금을 쓰지 않는다(쓰기가 임시 파일을 바꿔 넣으므로 옛 파일이나 새 파일 하나를 본다).

export interface SettingsStoreDeps {
  readonly engine: SettingsEngine;
  readonly session: SessionService;
  /** 사용자 설정 파일을 둘 디렉터리(L0.os의 `dirs.config`). `loadUserFile`이 경로를 정하지 않았을 때 쓴다 */
  readonly configDir: string;
  readonly trust: ProjectTrust;
  /** 프로세스 사이 파일 잠금(`OsServiceHandle.fileLock`). 설정 파일 쓰기가 이 안에서 일어난다 */
  readonly fileLock: FileLock;
  readonly ids: IdFactory;
  readonly logger: Logger;
  readonly signal: AbortSignal;
  /** 이 프로세스가 thread의 쓰기 소유를 쥐었는가 */
  readonly holds: (threadId: ThreadId) => boolean;
}

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type FileRead =
  | { readonly kind: "ok"; readonly values: ReadonlyMap<string, unknown> }
  | { readonly kind: "invalid" }
  | { readonly kind: "unreadable"; readonly code: string };

/** 설정 파일을 읽는다. 없으면 빈 맵이다. JSON 객체가 아니면 invalid다 */
async function readSettingsFile(path: string): Promise<FileRead> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (caught) {
    const code = errorCode(caught);
    return code === "ENOENT" ? { kind: "ok", values: new Map() } : { kind: "unreadable", code };
  }
  const decoded = parseJson(text);
  if (!decoded.ok || !isRecord(decoded.value)) return { kind: "invalid" };
  return { kind: "ok", values: new Map(Object.entries(decoded.value)) };
}

/** 읽은 파일의 값. 읽지 못했으면 이유만 남기고 그 범위는 비운다(값은 싣지 않는다, F wire §4.8) */
function valuesOf(read: FileRead, path: string, logger: Logger): ReadonlyMap<string, unknown> {
  if (read.kind === "ok") return read.values;
  logger.warn("settings.workspace_file_unusable", { path, reason: read.kind });
  return new Map();
}

/** 파일 원문을 읽는다. 없으면 null이다 */
async function readText(path: string): Promise<Result<string | null, SettingsWriteFailure>> {
  const read = await attemptAsync(() => readFile(path, "utf8"));
  if (read.ok) return ok(read.value);
  const code = errorCode(read.error.cause);
  return code === "ENOENT" ? ok(null) : err({ kind: "io", code });
}

function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function lockFailureCode(error: FileLockError): string {
  switch (error.kind) {
    case "timeout":
      return "LOCK_TIMEOUT";
    case "cancelled":
      return "LOCK_CANCELLED";
    case "io":
      return error.code;
    default:
      return assertNever(error, "FileLockError");
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 두 값 맵에서 달라진 키(추가, 삭제, 값 변경). 정렬해서 돌려준다 */
function changedKeys(
  before: ReadonlyMap<string, unknown>,
  after: ReadonlyMap<string, unknown>,
): readonly string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((key) => !sameValue(before.get(key), after.get(key))).toSorted();
}

export function createSettingsStore(deps: SettingsStoreDeps): SettingsStorePort {
  const { engine, session, trust, logger } = deps;
  const counter = { tmp: 0 };

  /** 쓰기가 끝났음을 알린다. 구독은 엔진이 받으므로 확장(cap-web의 탐침 기억 등)과 wire 알림이 같은 신호를 듣는다 */
  function changed(scope: SettingScope, key: SettingKey, threadId: ThreadId | undefined): void {
    engine.notifyChanged({
      keys: [key],
      scopes: [scope],
      threadId: scope === "session" && threadId !== undefined ? threadId : null,
    });
  }

  function userPath(): string {
    return engine.userPath() ?? join(deps.configDir, "settings.json");
  }

  /**
   * 파일 잠금 안에서 `work`를 돌린다. 잠금 파일(`<path>.lock`)이 들어갈 디렉터리는 먼저 만든다(0700).
   * 잠금을 얻지 못하면(시한, 중단, 입출력) `file_unwritable`이다
   */
  async function locked<T, E>(
    path: string,
    work: () => Promise<Result<T, E>>,
  ): Promise<Result<T, E | SettingsWriteFailure>> {
    const dir = await attemptAsync(() => mkdir(dirname(path), { recursive: true, mode: 0o700 }));
    if (!dir.ok) return err({ kind: "file_unwritable", path, code: errorCode(dir.error.cause) });
    const done = await deps.fileLock.withLock(path, work, { signal: deps.signal });
    if (!done.ok) return err({ kind: "file_unwritable", path, code: lockFailureCode(done.error) });
    return done.value;
  }

  /** 파일을 임시 파일로 쓰고 이름을 바꿔 교체한다. 잠금 안에서 부른다 */
  async function replaceText(
    path: string,
    text: string,
  ): Promise<Result<void, SettingsWriteFailure>> {
    counter.tmp += 1;
    const written = await attemptAsync(() =>
      replaceFileAtomically(path, text, `${String(process.pid)}-s${String(counter.tmp)}`),
    );
    if (!written.ok) {
      return err({ kind: "file_unwritable", path, code: errorCode(written.error.cause) });
    }
    return ok(undefined);
  }

  /** 파일의 키 하나를 바꾸거나(value가 undefined가 아니면) 지운다. 모르는 키는 그대로 보존한다(F wire §4.8) */
  function writeKey(
    path: string,
    key: string,
    value: unknown,
  ): Promise<Result<ReadonlyMap<string, unknown>, SettingsWriteFailure>> {
    return locked(path, async () => {
      const current = await readSettingsFile(path);
      if (current.kind === "invalid") return err({ kind: "file_invalid", path } as const);
      if (current.kind === "unreadable") {
        return err({ kind: "file_unwritable", path, code: current.code } as const);
      }
      const next = new Map(current.values);
      if (value === undefined) next.delete(key);
      else next.set(key, value);
      const text = `${JSON.stringify(Object.fromEntries(next), null, 2)}\n`;
      const replaced = await replaceText(path, text);
      if (!replaced.ok) return replaced;
      return ok(next);
    });
  }

  function workspaceOf(threadId: ThreadId): Result<string | undefined, SettingsWriteFailure> {
    const found = session.query.thread(threadId);
    if (!found.ok) return found;
    if (found.value === undefined) return err({ kind: "thread_not_found", threadId });
    return ok(found.value.workspace ?? undefined);
  }

  /** project·local 쓰기가 가는 곳: 신뢰한 작업 폴더. 결정이 없던 폴더("notRequired")에는 쓰지 않는다 */
  async function projectTarget(
    scope: "project" | "local",
    threadId: ThreadId | undefined,
  ): Promise<Result<{ workspace: string; path: string }, SettingsWriteFailure>> {
    if (threadId === undefined) return err({ kind: "thread_required", scope });
    const workspace = workspaceOf(threadId);
    if (!workspace.ok) return workspace;
    if (workspace.value === undefined) return err({ kind: "workspace_required", scope });
    const verdict = await trust.resolve(workspace.value, deps.signal);
    // 자원이 없어 판정하지 않은 폴더("notRequired")는 파일을 쓰는 순간 신뢰가 필요한 폴더가 된다.
    // 그런 폴더에는 사람이 정한 결정(저장 파일, 기본 정책 always)이 있을 때만 쓴다. 결정 없이 쓰면 다음 시작에 파일이 무시된다
    const decided =
      verdict.via !== "notRequired" || (await trust.explicitVerdict(workspace.value)) === "allow";
    if (!verdict.trusted || !decided) {
      return err({ kind: "untrusted_project", workspace: workspace.value });
    }
    const file = scope === "project" ? "settings.json" : "settings.local.json";
    return ok({ workspace: workspace.value, path: join(workspace.value, ".xeon", file) });
  }

  async function reloadWorkspace(workspace: string): Promise<void> {
    const projectPath = join(workspace, ".xeon", "settings.json");
    const localPath = join(workspace, ".xeon", "settings.local.json");
    const [project, local] = await Promise.all([
      readSettingsFile(projectPath),
      readSettingsFile(localPath),
    ]);
    engine.setWorkspaceFiles(workspace, {
      project: valuesOf(project, projectPath, logger),
      projectPath,
      local: valuesOf(local, localPath, logger),
      localPath,
    });
  }

  async function writeScope(
    scope: SettingScope,
    key: string,
    value: unknown,
    threadId: ThreadId | undefined,
  ): Promise<Result<void, SettingsWriteFailure>> {
    switch (scope) {
      case "managed":
        return err({ kind: "managed_read_only" });
      case "user": {
        const written = await writeKey(userPath(), key, value);
        if (!written.ok) return written;
        engine.setUserValue(key, value);
        return ok(undefined);
      }
      case "session": {
        if (threadId === undefined) return err({ kind: "thread_required", scope });
        const exists = session.query.thread(threadId);
        if (!exists.ok) return exists;
        if (exists.value === undefined) return err({ kind: "thread_not_found", threadId });
        if (!deps.holds(threadId)) return err({ kind: "not_owner", threadId });
        // 지우기(reset)는 null을 커밋한다(L1.persistence.spec §6.2). requestKey는 호출마다 새 값이다
        const requestKey = deps.ids.next("evt");
        if (value === undefined) return session.sessionSettings.reset(threadId, key, requestKey);
        const json = toJsonValue(value);
        if (json === undefined) return err({ kind: "io", code: "settings_value_not_json" });
        return session.sessionSettings.set(threadId, key, json, requestKey);
      }
      case "project":
      case "local": {
        const target = await projectTarget(scope, threadId);
        if (!target.ok) return target;
        const written = await writeKey(target.value.path, key, value);
        if (!written.ok) return written;
        await reloadWorkspace(target.value.workspace);
        return ok(undefined);
      }
      default:
        return assertNever(scope, "SettingScope");
    }
  }

  /** 파일 범위의 위치. 읽기용이다: 작업 폴더를 정할 수 없으면 경로가 null이고, 신뢰하지 않은 폴더는 읽기 전용이다 */
  async function readTarget(
    scope: SettingsFileScope,
    threadId: ThreadId | undefined,
  ): Promise<Result<{ path: string | null; readOnly: boolean }, SettingsWriteFailure>> {
    switch (scope) {
      case "managed":
        // 관리 정책 파일의 위치가 OS별로 정해지지 않았다(F wire §3.9). 읽는 쪽이 없으니 파일도 없는 것으로 본다
        return ok({ path: null, readOnly: true });
      case "user":
        return ok({ path: userPath(), readOnly: false });
      case "project":
      case "local": {
        if (threadId === undefined) return ok({ path: null, readOnly: true });
        const workspace = workspaceOf(threadId);
        if (!workspace.ok) return workspace;
        if (workspace.value === undefined) return ok({ path: null, readOnly: true });
        const file = scope === "project" ? "settings.json" : "settings.local.json";
        const trusted = await projectTarget(scope, threadId);
        return ok({ path: join(workspace.value, ".xeon", file), readOnly: !trusted.ok });
      }
      default:
        return assertNever(scope, "SettingsFileScope");
    }
  }

  /** 사용자 파일을 JSON 객체로 읽어 메모리 층에 반영한다. 파일 전체를 바꾸는 쓰기 뒤에 부른다 */
  function adoptUserText(text: string): readonly string[] {
    const decoded = parseJson(text);
    if (!decoded.ok || !isRecord(decoded.value)) {
      // 쓰기 전에 호출자가 JSON 객체임을 확인했다. 여기 오면 파일과 메모리가 어긋나므로 기록만 남긴다
      logger.warn("settings.user_text_not_object", {});
      return [];
    }
    const next = new Map(Object.entries(decoded.value));
    const keys = changedKeys(engine.userValues(), next);
    engine.replaceUserValues(next);
    return keys;
  }

  return {
    layers(threadId): ScopeStack {
      return engine.layers(threadId);
    },

    async prepare(threadId): Promise<void> {
      const workspace = workspaceOf(threadId);
      if (!workspace.ok || workspace.value === undefined) return;
      if (engine.hasWorkspaceFiles(workspace.value)) return;
      const trusted = await trust.isTrusted(workspace.value, deps.signal);
      // 신뢰하지 않으면 층을 두지 않는다. 결정이 바뀌면 다음 prepare가 다시 판정한다
      if (!trusted) return;
      await reloadWorkspace(workspace.value);
    },

    async write(scope, key, value, threadId) {
      const written = await writeScope(scope, key, value, threadId);
      if (written.ok) changed(scope, key, threadId);
      return written;
    },

    async reset(scope, key, threadId) {
      const written = await writeScope(scope, key, undefined, threadId);
      if (written.ok) changed(scope, key, threadId);
      return written;
    },

    async readFile(scope, threadId): Promise<Result<SettingsFileRead, SettingsWriteFailure>> {
      const target = await readTarget(scope, threadId);
      if (!target.ok) return target;
      const { path } = target.value;
      if (path === null) {
        return ok({ path: null, exists: false, readOnly: true, text: "", sha256: null });
      }
      const text = await readText(path);
      if (!text.ok) return text;
      if (text.value === null) {
        return ok({ path, exists: false, readOnly: target.value.readOnly, text: "", sha256: null });
      }
      const writable = await attemptAsync(() => access(path, constants.W_OK));
      return ok({
        path,
        exists: true,
        readOnly: target.value.readOnly || !writable.ok,
        text: text.value,
        sha256: sha256Of(text.value),
      });
    },

    async writeFile(
      scope: SettingsWritableFileScope,
      text: string,
      baseSha256: string | null,
      threadId: ThreadId | undefined,
    ): Promise<Result<{ path: string; sha256: string }, SettingsFileFailure>> {
      const target =
        scope === "user"
          ? ok({ workspace: undefined, path: userPath() })
          : await projectTarget(scope, threadId);
      if (!target.ok) return target;
      const { path, workspace } = target.value;
      const written = await locked(path, async (): Promise<Result<string, SettingsFileFailure>> => {
        const current = await readText(path);
        if (!current.ok) return current;
        // 읽은 뒤 다른 쓰기가 있었으면 덮지 않는다. 파일이 없었으면 기준 해시는 null이다
        if ((current.value === null ? null : sha256Of(current.value)) !== baseSha256) {
          return err({ kind: "conflict", scope });
        }
        const replaced = await replaceText(path, text);
        if (!replaced.ok) return replaced;
        return ok(sha256Of(text));
      });
      if (!written.ok) return written;
      if (scope === "user") {
        engine.notifyChanged({ keys: adoptUserText(text), scopes: ["user"], threadId: null });
      } else if (workspace !== undefined) {
        await reloadWorkspace(workspace);
        engine.notifyChanged({ keys: [], scopes: [scope], threadId: null });
      }
      return ok({ path, sha256: written.value });
    },

    async refreshUserFile(): Promise<void> {
      const path = userPath();
      const read = await readSettingsFile(path);
      if (read.kind !== "ok") {
        // 사람이 고치던 중간 상태일 수 있다. 앞 값을 지키고 다음 변경을 기다린다
        logger.warn("settings.user_reload_skipped", { path, reason: read.kind });
        return;
      }
      const keys = changedKeys(engine.userValues(), read.values);
      if (keys.length === 0) return;
      engine.replaceUserValues(read.values);
      engine.notifyChanged({ keys, scopes: ["user"], threadId: null });
    },

    onChange(listener): Unsubscribe {
      return engine.onChange(listener);
    },
  };
}

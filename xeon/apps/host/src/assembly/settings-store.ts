import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
import type { ScopeStack, SettingScope } from "@xeon/contracts/settings";
import type { Unsubscribe } from "@xeon/contracts/wire";
import type { SettingsStorePort, SettingsWriteFailure } from "../types.ts";
import type { SettingsEngine } from "./settings-engine.ts";
import { replaceFileAtomically, type ProjectTrust } from "./trust.ts";

// L4.host-service.spec §3.3.2 SettingsStorePort. 설정 파일 범위의 쓰기와 project·local 파일 읽기는 호스트 소유다
// (L1.persistence.spec §6.2 마지막 [제안]). user는 `<config>/settings.json`, project·local은 신뢰한 작업 폴더의
// `.xeon/settings.json`·`.xeon/settings.local.json`, session은 `settings.changed` 커밋이다. 조립 루트 코드(DR-14 예외 2).

export interface SettingsStoreDeps {
  readonly engine: SettingsEngine;
  readonly session: SessionService;
  /** 사용자 설정 파일을 둘 디렉터리(L0.os의 `dirs.config`). `loadUserFile`이 경로를 정하지 않았을 때 쓴다 */
  readonly configDir: string;
  readonly trust: ProjectTrust;
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

export function createSettingsStore(deps: SettingsStoreDeps): SettingsStorePort {
  const { engine, session, trust, logger } = deps;
  const listeners = new Set<() => void>();
  /** 같은 파일에 대한 읽기-수정-쓰기를 차례로 한다 */
  const queues = new Map<string, Promise<unknown>>();
  const counter = { tmp: 0 };

  function changed(): void {
    for (const listener of Array.from(listeners)) listener();
  }

  function userPath(): string {
    return engine.userPath() ?? join(deps.configDir, "settings.json");
  }

  function serialized<T>(path: string, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(path) ?? Promise.resolve();
    const run = previous.then(work);
    queues.set(
      path,
      attemptAsync(() => run),
    );
    return run;
  }

  /** 파일의 키 하나를 바꾸거나(value가 undefined가 아니면) 지운다. 모르는 키는 그대로 보존한다(F wire §4.8) */
  function writeKey(
    path: string,
    key: string,
    value: unknown,
  ): Promise<Result<ReadonlyMap<string, unknown>, SettingsWriteFailure>> {
    return serialized(path, async () => {
      const current = await readSettingsFile(path);
      if (current.kind === "invalid") return err({ kind: "file_invalid", path } as const);
      if (current.kind === "unreadable") {
        return err({ kind: "file_unwritable", path, code: current.code } as const);
      }
      const next = new Map(current.values);
      if (value === undefined) next.delete(key);
      else next.set(key, value);
      counter.tmp += 1;
      const written = await attemptAsync(() =>
        replaceFileAtomically(
          path,
          `${JSON.stringify(Object.fromEntries(next), null, 2)}\n`,
          `${String(process.pid)}-s${String(counter.tmp)}`,
        ),
      );
      if (!written.ok) {
        return err({
          kind: "file_unwritable",
          path,
          code: errorCode(written.error.cause),
        } as const);
      }
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
      if (written.ok) changed();
      return written;
    },

    async reset(scope, key, threadId) {
      const written = await writeScope(scope, key, undefined, threadId);
      if (written.ok) changed();
      return written;
    },

    onChange(listener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

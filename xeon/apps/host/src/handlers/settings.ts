import { assertNever } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  checkSettingWrite,
  resolveSetting,
  toSettingDefWire,
  type EffectiveSetting,
  type SettingDef,
  type SettingScope,
} from "@xeon/contracts/settings";
import { wireError, type WireError, type WireHandler } from "@xeon/contracts/wire";
import { wireErrorOfStore } from "../store-error.ts";
import type { Engine, SettingsWriteFailure } from "../types.ts";
import { threadLocked } from "./owner.ts";

// L4.host-service.spec §3.4. settings.get(M1)과 settings.set, settings.reset, settings.list(M2, HOST.2).
// 값 검사는 F의 checkSettingWrite가 한다. 오류 details에는 값을 싣지 않는다(F wire §4.9 비밀 값 비표시 규칙 4).

/** 모르는 thread는 3001이다. threadId가 없으면 검사하지 않는다 */
function requireThreadIfGiven(engine: Engine, threadId: ThreadId | undefined, where: string): void {
  if (threadId === undefined) return;
  const exists = engine.ports.threads.exists(threadId);
  if (!exists.ok) throw wireErrorOfStore(exists.error, `${where} thread lookup`);
  if (!exists.value) throw wireError("thread.notFound", { details: { threadId } });
}

export function createSettingsGetHandler(engine: Engine): WireHandler<"settings.get"> {
  const { ports, catalog } = engine;
  return async (params) => {
    const { threadId } = params;
    requireThreadIfGiven(engine, threadId, "settings.get");
    if (threadId !== undefined) await ports.settings.prepare(threadId);
    const keys = params.keys ?? [...catalog.keys()].toSorted();
    const layers = ports.settings.layers(threadId);
    const settings: EffectiveSetting[] = [];
    for (const key of keys) {
      const def = catalog.get(key);
      if (def === undefined) {
        throw wireError("settings.unknownKey", { details: { key } });
      }
      const resolved = resolveSetting(def, layers);
      for (const issue of resolved.issues) {
        // 값은 싣지 않는다(비밀 값 비표시 규칙). 건너뛴 범위와 이유만 남긴다
        ports.log.info("settings.value_skipped", {
          key,
          scope: issue.scope,
          message: issue.message,
        });
      }
      settings.push(resolved.setting);
    }
    return { settings };
  };
}

function scopeNotAllowed(def: SettingDef, scope: SettingScope, reason: string): WireError {
  return wireError("settings.scopeNotAllowed", {
    details: { key: def.key, scope, allowedScopes: [...def.allowedScopes], reason },
  });
}

/** 설정 쓰기 실패를 와이어 오류로 옮긴다 */
function writeFailure(
  failure: SettingsWriteFailure,
  def: SettingDef,
  scope: SettingScope,
): WireError {
  switch (failure.kind) {
    case "thread_required":
      return failure.scope === "session"
        ? wireError("jsonrpc.invalidParams", {
            details: {
              issues: [{ path: "threadId", message: "threadId is required for the session scope" }],
            },
          })
        : scopeNotAllowed(def, scope, "workspaceRequired");
    case "workspace_required":
      return scopeNotAllowed(def, scope, "workspaceRequired");
    case "untrusted_project":
      return scopeNotAllowed(def, scope, "untrustedProject");
    case "managed_read_only":
      return scopeNotAllowed(def, scope, "managedReadOnly");
    case "not_owner":
      return threadLocked(null);
    case "file_invalid":
      return wireError("store.io", {
        message: "settings.write: the settings file is not a JSON object",
        details: { code: "settings_file_invalid" },
      });
    case "file_unwritable":
      return wireError("store.io", {
        message: "settings.write: the settings file cannot be written",
        details: { code: failure.code.slice(0, 64) },
      });
    case "busy":
    case "disk_full":
    case "io":
    case "ownership_lost":
    case "read_only":
    case "thread_not_found":
    case "row_invalid":
      return wireErrorOfStore(failure, "settings.write");
    default:
      return assertNever(failure, "SettingsWriteFailure");
  }
}

function effectiveOf(
  engine: Engine,
  def: SettingDef,
  threadId: ThreadId | undefined,
): EffectiveSetting {
  return resolveSetting(def, engine.ports.settings.layers(threadId)).setting;
}

export function createSettingsSetHandler(engine: Engine): WireHandler<"settings.set"> {
  const { ports, catalog } = engine;
  return async (params) => {
    const { threadId, key, scope } = params;
    requireThreadIfGiven(engine, threadId, "settings.set");
    if (threadId !== undefined) await ports.settings.prepare(threadId);
    const checked = checkSettingWrite(
      catalog,
      ports.settings.layers(threadId),
      key,
      scope,
      params.value,
    );
    if (!checked.ok) {
      const details: Record<string, unknown> = { ...checked.details };
      const issues = details["issues"];
      if (Array.isArray(issues)) details["issues"] = issues.slice(0, 20);
      throw wireError(checked.kind, { details });
    }
    const def = catalog.get(key);
    if (def === undefined) throw wireError("settings.unknownKey", { details: { key } });
    const written = await ports.settings.write(scope, key, checked.value, threadId);
    if (!written.ok) throw writeFailure(written.error, def, scope);
    return { setting: effectiveOf(engine, def, threadId) };
  };
}

export function createSettingsResetHandler(engine: Engine): WireHandler<"settings.reset"> {
  const { ports, catalog } = engine;
  return async (params) => {
    const { threadId, key, scope } = params;
    requireThreadIfGiven(engine, threadId, "settings.reset");
    if (threadId !== undefined) await ports.settings.prepare(threadId);
    const def = catalog.get(key);
    if (def === undefined) throw wireError("settings.unknownKey", { details: { key } });
    if (!def.allowedScopes.includes(scope)) throw scopeNotAllowed(def, scope, "scopeNotAllowed");
    if (scope !== "managed") {
      const managed = ports.settings.layers(threadId).find((layer) => layer.scope === "managed");
      if (managed?.values.has(key) === true) {
        throw wireError("settings.locked", { details: { key, lockedBy: "managed" } });
      }
    }
    const cleared = await ports.settings.reset(scope, key, threadId);
    if (!cleared.ok) throw writeFailure(cleared.error, def, scope);
    return { setting: effectiveOf(engine, def, threadId) };
  };
}

/** 카탈로그를 SettingDefWire로 바꿔 키 순으로 돌려준다. 폐기된 키는 `includeDeprecated`일 때만 싣는다 */
export function createSettingsListHandler(engine: Engine): WireHandler<"settings.list"> {
  const { catalog } = engine;
  return (params) => {
    const prefix = params.prefix ?? "";
    const defs = [...catalog.values()]
      .filter((def) => def.key.startsWith(prefix))
      .filter((def) => params.includeDeprecated === true || def.deprecated === undefined)
      .toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((def) => toSettingDefWire(def));
    return Promise.resolve({ defs });
  };
}

import { assertNever, type Bug } from "@xeon/contracts";
import { parseModelRef } from "@xeon/contracts/services";
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
import { keyReusedBug, wireErrorOfStore } from "../store-error.ts";
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
): WireError | Bug {
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
    case "key_reused":
      return keyReusedBug(failure, "settings.write");
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

/** 모델 id를 값으로 갖는 설정 키: 기본 모델과 역할별 모델 */
const MODEL_REF_KEY = /^l1\.models\.(?:default|routing\.[a-z]+)$/;
const MODEL_HINT_MAX = 5;

/**
 * 모델 참조(`provider/modelId[:수준]`) 설정이 카탈로그에 없는 모델을 가리키면 쓰기를 거절한다. 틀린 id(`claude-sonnet-5.5`)가 저장돼
 * 첫 turn에서야 실패하는 일을 막는다. 같은 provider의 등록된 모델 몇 개를 보여 준다(HS-78 [결정: M2 Mac 실기]).
 * 값이 문자열이 아니거나(null로 지움) 참조 형식이 틀리면 건드리지 않는다: 형식은 `checkSettingWrite`가 이미 판정했다.
 */
function requireKnownModel(engine: Engine, key: string, value: unknown): void {
  if (!MODEL_REF_KEY.test(key) || typeof value !== "string") return;
  const parsed = parseModelRef(value);
  if (!parsed.ok) return;
  const { provider, modelId } = parsed.value;
  const known = engine.ports.models.modelIds(provider);
  if (known.includes(modelId)) return;
  const hint =
    known.length === 0
      ? `provider ${provider}에 등록된 모델이 없다`
      : `${provider}의 모델: ${known.slice(0, MODEL_HINT_MAX).join(", ")}${known.length > MODEL_HINT_MAX ? " 등" : ""}`;
  throw wireError("settings.invalidValue", {
    details: {
      key,
      issues: [
        {
          path: "value",
          message: `알 수 없는 모델 ${provider}/${modelId} (${hint})`.slice(0, 512),
        },
      ],
    },
  });
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
    requireKnownModel(engine, key, checked.value);
    const written = await ports.settings.write(scope, key, checked.value, threadId);
    if (!written.ok) throw writeFailure(written.error, def, scope);
    // 사용자 범위의 provider 키 연결은 사람의 허용이다: 그 비밀에 모델 provider 사용 하나를 더한다(HS-45)
    if (key === "l1.models.providers" && scope === "user") await ports.secrets.linkModelProviders();
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

/**
 * 카탈로그를 SettingDefWire로 바꿔 키 순으로 돌려준다. 폐기된 키는 `includeDeprecated`일 때, 읽는 코드가 아직 없는 `reserved` 키는
 * `includeReserved`일 때만 싣는다(F wire §3.8.2 `stage`). 설정 화면이 아무 일도 하지 않는 항목을 보이지 않게 한다
 */
export function createSettingsListHandler(engine: Engine): WireHandler<"settings.list"> {
  const { catalog } = engine;
  return (params) => {
    const prefix = params.prefix ?? "";
    const defs = [...catalog.values()]
      .filter((def) => def.key.startsWith(prefix))
      .filter((def) => params.includeDeprecated === true || def.deprecated === undefined)
      .filter((def) => params.includeReserved === true || def.stage !== "reserved")
      .toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((def) => toSettingDefWire(def));
    return Promise.resolve({ defs });
  };
}

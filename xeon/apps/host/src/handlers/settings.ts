import { assertNever, parseJson, type Bug } from "@xeon/contracts";
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
import {
  SETTINGS_FILE_TEXT_MAX,
  wireError,
  type SettingsFileScope,
  type WireError,
  type WireHandler,
} from "@xeon/contracts/wire";
import { keyReusedBug, wireErrorOfStore } from "../store-error.ts";
import { settingProblemOf } from "../settings-problems.ts";
import type { Engine, SettingsFileFailure, SettingsWriteFailure } from "../types.ts";
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
      settings.push(withProblem(engine, resolved.setting));
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

/**
 * 유효 값에 호스트만 아는 문제 표시를 붙인다(HS-80). 문제가 없으면 `problem` 필드를 아예 싣지 않는다.
 * 모델 id 검사는 settings.set의 HS-78과 같은 카탈로그 조회를 쓴다.
 */
function withProblem(engine: Engine, setting: EffectiveSetting): EffectiveSetting {
  const problem = settingProblemOf(setting.key, setting.value, (provider) =>
    engine.ports.models.modelIds(provider),
  );
  return problem === undefined ? setting : { ...setting, problem };
}

function effectiveOf(
  engine: Engine,
  def: SettingDef,
  threadId: ThreadId | undefined,
): EffectiveSetting {
  return withProblem(engine, resolveSetting(def, engine.ports.settings.layers(threadId)).setting);
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

// ── settings.readFile, settings.writeFile (M3-REQ-15, HS-98) ─────────────────

type FileIssue = { readonly path: string; readonly message: string };

const FILE_ISSUES_MAX = 20;
const UNKNOWN_KEYS_MAX = 256;
const UNKNOWN_KEY_LENGTH_MAX = 128;

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 원문의 최상위 키 가운데 카탈로그에 없는 것. 파일에는 그대로 보존한다(F wire §4.8). 원문이 JSON 객체가 아니면 빈 목록이다 */
function unknownKeysOf(text: string, engine: Engine): string[] {
  if (text.trim() === "") return [];
  const decoded = parseJson(text);
  if (!decoded.ok || !isJsonObject(decoded.value)) return [];
  return Object.keys(decoded.value)
    .filter((key) => !engine.catalog.has(key) && key.length <= UNKNOWN_KEY_LENGTH_MAX)
    .toSorted()
    .slice(0, UNKNOWN_KEYS_MAX);
}

function fileInvalid(scope: SettingsFileScope, issues: readonly FileIssue[]): WireError {
  return wireError("settings.fileInvalid", {
    details: { scope, issues: issues.slice(0, FILE_ISSUES_MAX) },
  });
}

/**
 * 파일 원문을 그 범위의 스키마로 검사한다(F wire §3.3.1). JSON 객체여야 하고, 카탈로그에 있는 키는 값 검사를 통과해야 한다.
 * 카탈로그에 없는 키는 보존하는 키라 통과한다. 읽는 코드가 없는 `reserved` 키와 그 범위가 허용하지 않는 키는 `settings.set`이
 * 막는 것이지 파일의 스키마가 막는 것이 아니라서(`settingsJsonSchema`) 통과한다. 비밀 키의 값은 이슈에 싣지 않는다.
 */
function checkFileText(
  engine: Engine,
  scope: SettingsFileScope,
  text: string,
): readonly FileIssue[] {
  const decoded = text.trim() === "" ? { ok: true as const, value: {} } : parseJson(text);
  if (!decoded.ok || !isJsonObject(decoded.value)) {
    return [{ path: "", message: "the settings file must be a JSON object" }];
  }
  const issues: FileIssue[] = [];
  for (const [key, value] of Object.entries(decoded.value)) {
    const def = engine.catalog.get(key);
    if (def === undefined || def.stage === "reserved" || !def.allowedScopes.includes(scope))
      continue;
    const checked = checkSettingWrite(engine.catalog, [], key, scope, value);
    if (checked.ok) continue;
    if (checked.kind === "settings.secretValue") {
      issues.push({ path: key, message: "a secret key takes a secret:// reference or null" });
      continue;
    }
    const found = checked.details["issues"];
    if (Array.isArray(found) && found.length > 0) {
      for (const issue of found) {
        if (!isJsonObject(issue)) continue;
        const detail = issue["path"];
        const message = issue["message"];
        issues.push({
          path: `${key}${typeof detail === "string" ? detail : ""}`.slice(0, 512),
          message: typeof message === "string" ? message.slice(0, 512) : "invalid value",
        });
      }
    } else {
      issues.push({ path: key, message: "invalid value" });
    }
  }
  return issues;
}

/** 파일 쓰기·읽기 실패를 와이어 오류로 옮긴다 */
function fileFailure(failure: SettingsFileFailure, scope: SettingsFileScope): WireError | Bug {
  switch (failure.kind) {
    case "conflict":
      return wireError("settings.fileConflict", { details: { scope } });
    case "thread_required":
      return wireError("jsonrpc.invalidParams", {
        details: {
          issues: [
            { path: "threadId", message: "threadId is required for the project and local scopes" },
          ],
        },
      });
    case "workspace_required":
      return fileInvalid(scope, [{ path: "scope", message: "the thread has no workspace" }]);
    case "untrusted_project":
      return fileInvalid(scope, [{ path: "scope", message: "the project is not trusted" }]);
    case "managed_read_only":
      return fileInvalid(scope, [{ path: "scope", message: "the managed file is read only" }]);
    case "not_owner":
      return threadLocked(null);
    case "file_invalid":
      return wireError("store.io", {
        message: "settings.writeFile: the settings file is not a JSON object",
        details: { code: "settings_file_invalid" },
      });
    case "file_unwritable":
      return wireError("store.io", {
        message: "settings.writeFile: the settings file cannot be written",
        details: { code: failure.code.slice(0, 64) },
      });
    case "key_reused":
      return keyReusedBug(failure, "settings.writeFile");
    case "busy":
    case "disk_full":
    case "io":
    case "ownership_lost":
    case "read_only":
    case "thread_not_found":
    case "row_invalid":
      return wireErrorOfStore(failure, "settings.writeFile");
    default:
      return assertNever(failure, "SettingsFileFailure");
  }
}

export function createSettingsReadFileHandler(engine: Engine): WireHandler<"settings.readFile"> {
  const { ports } = engine;
  return async (params) => {
    requireThreadIfGiven(engine, params.threadId, "settings.readFile");
    const read = await ports.settings.readFile(params.scope, params.threadId);
    if (!read.ok) throw fileFailure(read.error, params.scope);
    const file = read.value;
    // 편집기가 열지 않는 크기다(F wire SETTINGS_FILE_TEXT_MAX). 응답 스키마도 이 길이를 넘기지 못한다
    if (file.text.length > SETTINGS_FILE_TEXT_MAX) {
      throw fileInvalid(params.scope, [
        { path: "", message: "the settings file is too large to edit" },
      ]);
    }
    return {
      scope: params.scope,
      path: file.path,
      exists: file.exists,
      readOnly: file.readOnly,
      text: file.text,
      sha256: file.sha256,
      unknownKeys: unknownKeysOf(file.text, engine),
    };
  };
}

export function createSettingsWriteFileHandler(engine: Engine): WireHandler<"settings.writeFile"> {
  const { ports } = engine;
  return async (params) => {
    requireThreadIfGiven(engine, params.threadId, "settings.writeFile");
    if (params.threadId !== undefined) await ports.settings.prepare(params.threadId);
    const issues = checkFileText(engine, params.scope, params.text);
    if (issues.length > 0) throw fileInvalid(params.scope, issues);
    const written = await ports.settings.writeFile(
      params.scope,
      params.text,
      params.baseSha256,
      params.threadId,
    );
    if (!written.ok) throw fileFailure(written.error, params.scope);
    return {
      path: written.value.path,
      sha256: written.value.sha256,
      unknownKeys: unknownKeysOf(params.text, engine),
    };
  };
}

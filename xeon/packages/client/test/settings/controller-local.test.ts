import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EffectiveSetting, SettingDefWire, SettingKey } from "@fresnel/contracts/settings";
import type { CloseInfo, HostConnection } from "@fresnel/contracts/wire";
import { activeLocale, setActiveLocale, type Locale } from "../../src/i18n/index.ts";
import {
  createSettingsController,
  settingsViewOf,
  type FieldError,
  type LocalSettingsPort,
  type LocalWrite,
  type SettingsController,
  type SettingsHostPort,
} from "../../src/settings/index.ts";
import { effectiveOf, fakeConnection, wireDef, type ConnectionTable } from "./fixtures.ts";

// 두 원천 합치기(L4.settings-ui §4.1.3)의 컨트롤러 시험. 엔진은 가짜 연결, 로컬 저장소는 가짜 포트로 둔다.
// 정의 합집합, 원천별 라우팅, 같은 키의 `duplicateKey`, 엔진이 없을 때의 편집 가능 여부를 본다. 값은 `toEqual`로 비교한다.

const CLOSE_KEY = "l4.desktop.window.closeBehavior";
const RESTART_KEY = "l4.desktop.engine.restartLimit";
const MODEL_KEY = "l1.models.default";
const NOTE = "엔진과 연결되면 바꿀 수 있어요";

/** 데스크톱 로컬 정의. 두 번째 항목은 `closeBehavior`와 같은 모양의 숫자다 */
const CLOSE: SettingDefWire = wireDef({
  key: CLOSE_KEY,
  type: { type: "string" },
  range: { enum: ["quit", "tray"] },
  default: "quit",
  layer: "L4",
  allowedScopes: ["managed", "user"],
  ui: { tab: "appearance", widget: "select", order: 10, label: "창 닫기 동작" },
});
const RESTART: SettingDefWire = wireDef({
  key: RESTART_KEY,
  type: { type: "integer" },
  range: { min: 0, max: 10 },
  default: 3,
  layer: "L4",
  allowedScopes: ["managed", "user"],
  ui: { tab: "execution", widget: "number", order: 20, label: "자동 재기동 횟수" },
});
const MODEL: SettingDefWire = wireDef({
  key: MODEL_KEY,
  type: { type: "string" },
  default: "anthropic/claude",
  ui: { tab: "models", widget: "text", order: 1, label: "기본 모델" },
});

/** 로컬 저장소 가짜. 쓴 내용을 `writes`에 쌓고, 다음 쓰기의 결과를 `refuse`로 바꾼다 */
interface FakeLocal {
  readonly port: LocalSettingsPort;
  readonly writes: {
    readonly method: "set" | "reset";
    readonly key: string;
    readonly value?: unknown;
  }[];
  refuse(result: LocalWrite | "throw" | null): void;
  emit(setting: EffectiveSetting): void;
}

function fakeLocal(defs: readonly SettingDefWire[]): FakeLocal {
  const values = new Map<string, unknown>(defs.map((def) => [def.key, def.default]));
  const written = new Set<string>();
  const listeners = new Set<(setting: EffectiveSetting) => void>();
  const writes: { method: "set" | "reset"; key: string; value?: unknown }[] = [];
  let refusal: LocalWrite | "throw" | null = null;
  const settingOf = (key: SettingKey): EffectiveSetting =>
    effectiveOf(key, values.get(key) ?? null, {
      source: written.has(key) ? { scope: "user" } : { scope: "default" },
      runtimeChange: "live",
    });
  async function answer(key: SettingKey, value?: unknown): Promise<LocalWrite> {
    if (refusal === "throw") throw new Error("disk full");
    if (refusal !== null) return refusal;
    written.add(key);
    values.set(key, value ?? defs.find((def) => def.key === key)?.default);
    return { ok: true, setting: settingOf(key) };
  }
  const port: LocalSettingsPort = {
    defs: () => defs,
    get: (key) => (defs.some((def) => def.key === key) ? settingOf(key) : undefined),
    set: (key, value) => {
      writes.push({ method: "set", key, value });
      return answer(key, value);
    },
    reset: (key) => {
      writes.push({ method: "reset", key });
      return answer(key);
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    port,
    writes,
    refuse(result) {
      refusal = result;
    },
    emit(setting) {
      for (const listener of listeners) listener(setting);
    },
  };
}

interface Rig {
  readonly controller: SettingsController;
  readonly local: FakeLocal;
  readonly calls: () => readonly string[];
}

/** 엔진 연결(없으면 null)과 로컬 정의로 컨트롤러 하나를 만든다 */
function rig(options: {
  readonly engine?: readonly SettingDefWire[];
  readonly local?: readonly SettingDefWire[];
  readonly offline?: boolean;
  readonly closed?: Promise<CloseInfo>;
  readonly table?: ConnectionTable;
}): Rig {
  const engine = options.engine ?? [MODEL];
  const local = fakeLocal(options.local ?? [CLOSE, RESTART]);
  const defaults: ConnectionTable = {
    "settings.list": () => Promise.resolve({ defs: [...engine] }),
    "settings.get": () =>
      Promise.resolve({
        settings: engine.map((def) =>
          effectiveOf(def.key, def.default ?? null, { source: { scope: "default" } }),
        ),
      }),
    "settings.set": (params) =>
      Promise.resolve({
        setting: effectiveOf(params.key, params.value, { source: { scope: params.scope } }),
      }),
  };
  const fake = fakeConnection({ ...defaults, ...options.table });
  const link: HostConnection | null =
    options.offline === true
      ? null
      : options.closed === undefined
        ? fake.connection
        : { ...fake.connection, closed: options.closed };
  const port: SettingsHostPort = {
    connection: link,
    localStore: local.port,
    currentThreadId: () => null,
    requestHostRestart: () => Promise.resolve(),
  };
  return {
    controller: createSettingsController(port),
    local,
    calls: () => fake.calls.map((call) => call.method),
  };
}

/** 대기 중인 응답과 알림 뒤 읽기를 모두 흘려보낸다 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fieldOf(controller: SettingsController, key: SettingKey) {
  return settingsViewOf(controller.getState())
    .tabs.flatMap((tab) => tab.fields)
    .find((field) => field.key === key);
}

let saved: Locale = "ko";
beforeEach(() => {
  saved = activeLocale();
  setActiveLocale("ko");
});
afterEach(() => {
  setActiveLocale(saved);
});

describe("the two sources become one catalog", () => {
  test("engine and desktop definitions form one list, and each key keeps its origin", async () => {
    const host = rig({});
    await host.controller.load();
    const state = host.controller.getState();
    expect([...state.defs.keys()].toSorted()).toEqual([MODEL_KEY, RESTART_KEY, CLOSE_KEY]);
    expect(state.origins.get(CLOSE_KEY)).toBe("desktop");
    expect(state.origins.get(RESTART_KEY)).toBe("desktop");
    expect(state.origins.get(MODEL_KEY)).toBe("engine");
    expect(state.duplicateKeys).toEqual([]);
    expect(fieldOf(host.controller, CLOSE_KEY)).toMatchObject({
      origin: "desktop",
      value: "quit",
      editable: true,
      offlineNote: null,
    });
    expect(fieldOf(host.controller, MODEL_KEY)).toMatchObject({ origin: "engine", editable: true });
  });

  test("a key both sides list takes the desktop definition and reports duplicateKey", async () => {
    const engineSide = wireDef({
      key: CLOSE_KEY,
      type: { type: "string" },
      range: { enum: ["quit", "tray"] },
      default: "quit",
      ui: { tab: "appearance", widget: "select", order: 10, label: "엔진 쪽 문구" },
    });
    const host = rig({ engine: [engineSide, MODEL] });
    await host.controller.load();
    const state = host.controller.getState();
    expect(state.defs.get(CLOSE_KEY)?.ui?.label).toBe("창 닫기 동작");
    expect(state.origins.get(CLOSE_KEY)).toBe("desktop");
    expect(state.duplicateKeys).toEqual([CLOSE_KEY]);
    expect(settingsViewOf(state).diagnostics).toContainEqual({
      code: "duplicateKey",
      key: CLOSE_KEY,
    });
    expect(fieldOf(host.controller, CLOSE_KEY)?.label).toBe("창 닫기 동작");
  });

  test("a value the store announces reaches the state without reading anything again", async () => {
    const host = rig({});
    await host.controller.load();
    const before = host.calls().length;
    host.local.emit(effectiveOf(CLOSE_KEY, "tray", { source: { scope: "user" } }));
    expect(host.controller.getState().values.get(CLOSE_KEY)?.value).toBe("tray");
    expect(host.calls().length).toBe(before);
  });
});

describe("origin routing", () => {
  test("a desktop change goes to the local store and never to settings.set", async () => {
    const host = rig({});
    await host.controller.load();
    host.controller.edit(CLOSE_KEY, "tray");
    await host.controller.commit(CLOSE_KEY);
    expect(host.local.writes).toEqual([{ method: "set", key: CLOSE_KEY, value: "tray" }]);
    expect(host.calls()).not.toContain("settings.set");
    const state = host.controller.getState();
    expect(state.values.get(CLOSE_KEY)?.value).toBe("tray");
    expect(state.drafts.has(CLOSE_KEY)).toBe(false);
    expect(state.saving.size).toBe(0);
  });

  test("an engine change goes to settings.set and never to the local store", async () => {
    const host = rig({});
    await host.controller.load();
    host.controller.edit(MODEL_KEY, "openai/gpt");
    await host.controller.commit(MODEL_KEY);
    expect(host.local.writes).toEqual([]);
    expect(host.calls().at(-1)).toBe("settings.set");
    expect(host.controller.getState().values.get(MODEL_KEY)?.value).toBe("openai/gpt");
  });

  test("a reset of a desktop item asks the local store and applies its answer", async () => {
    const host = rig({});
    await host.controller.load();
    host.controller.edit(RESTART_KEY, 5);
    await host.controller.commit(RESTART_KEY);
    await host.controller.reset(RESTART_KEY, "user");
    expect(host.local.writes.at(-1)).toEqual({ method: "reset", key: RESTART_KEY });
    expect(host.calls()).not.toContain("settings.reset");
    expect(host.controller.getState().values.get(RESTART_KEY)).toEqual(
      effectiveOf(RESTART_KEY, 3, { source: { scope: "user" }, runtimeChange: "live" }),
    );
  });

  test("a desktop item keeps the scope rules: managed and project are refused without a call", async () => {
    const host = rig({});
    await host.controller.load();
    await host.controller.reset(CLOSE_KEY, "project");
    expect(host.local.writes).toEqual([]);
    expect(host.controller.getState().errors.get(CLOSE_KEY)).toEqual({
      kind: "scopeNotAllowed",
      message: "프로젝트 범위에는 저장할 수 없어요",
      allowed: ["user"],
    });
  });
});

describe("offline editability", () => {
  test("with no engine the desktop items load and save, and engine items are read-only with the sentence", async () => {
    const host = rig({ offline: true });
    await host.controller.load();
    expect(host.controller.getState().status).toBe("ready");
    expect(host.controller.getState().engineOffline).toBe(true);
    expect(fieldOf(host.controller, CLOSE_KEY)).toMatchObject({
      editable: true,
      offlineNote: null,
    });
    expect(fieldOf(host.controller, MODEL_KEY)).toBeUndefined();

    host.controller.edit(CLOSE_KEY, "tray");
    await host.controller.commit(CLOSE_KEY);
    expect(host.local.writes).toEqual([{ method: "set", key: CLOSE_KEY, value: "tray" }]);
    expect(host.controller.getState().values.get(CLOSE_KEY)?.value).toBe("tray");
  });

  test("when the connection closes after loading, engine items turn read-only and desktop items still save", async () => {
    const gate = Promise.withResolvers<CloseInfo>();
    const host = rig({ closed: gate.promise });
    await host.controller.load();
    expect(fieldOf(host.controller, MODEL_KEY)).toMatchObject({
      editable: true,
      offlineNote: null,
    });

    gate.resolve({ reason: "eof" });
    await flush();
    expect(host.controller.getState().engineOffline).toBe(true);
    expect(fieldOf(host.controller, MODEL_KEY)).toMatchObject({
      origin: "engine",
      editable: false,
      offlineNote: NOTE,
    });
    expect(fieldOf(host.controller, CLOSE_KEY)).toMatchObject({
      editable: true,
      offlineNote: null,
    });

    // 엔진 항목은 화면에서 막히지만, 컨트롤러가 직접 불려도 보내지 않고 연결 끊김으로 막는다
    host.controller.edit(MODEL_KEY, "openai/gpt");
    await host.controller.commit(MODEL_KEY);
    expect(host.controller.getState().errors.get(MODEL_KEY)).toEqual({
      kind: "transient",
      message: "엔진과 연결이 끊겼어요. 다시 연결되면 저장해 주세요",
    });
    expect(host.calls()).not.toContain("settings.set");

    host.controller.edit(CLOSE_KEY, "tray");
    await host.controller.commit(CLOSE_KEY);
    expect(host.local.writes).toEqual([{ method: "set", key: CLOSE_KEY, value: "tray" }]);
  });
});

describe("local write failures", () => {
  test("an invalid value from the store becomes the same invalidValue error as an engine one", async () => {
    const host = rig({});
    await host.controller.load();
    host.local.refuse({ ok: false, kind: "settings.invalidValue", details: {} });
    host.controller.edit(CLOSE_KEY, "tray");
    await host.controller.commit(CLOSE_KEY);
    expect(host.controller.getState().errors.get(CLOSE_KEY)).toEqual({
      kind: "invalidValue",
      message: "목록에 있는 값만 고를 수 있어요",
      issues: [],
    });
    expect(host.controller.getState().drafts.get(CLOSE_KEY)?.value).toBe("tray");
  });

  test("an unknown key from the store is unknownKey, and nothing reads the catalog again", async () => {
    const host = rig({});
    await host.controller.load();
    host.local.refuse({ ok: false, kind: "settings.unknownKey", details: {} });
    host.controller.edit(CLOSE_KEY, "tray");
    await host.controller.commit(CLOSE_KEY);
    expect(host.controller.getState().errors.get(CLOSE_KEY)).toEqual({
      kind: "unknownKey",
      message: "이 설정을 찾을 수 없어요. 목록을 새로 불러왔어요",
    });
    expect(host.calls().filter((method) => method === "settings.list")).toHaveLength(1);
  });

  test("a file write failure and a thrown write are both the storage sentence", async () => {
    const host = rig({});
    await host.controller.load();
    host.local.refuse({ ok: false, kind: "storage", details: {} });
    host.controller.edit(CLOSE_KEY, "tray");
    await host.controller.commit(CLOSE_KEY);
    const expected: FieldError = { kind: "internal", message: "저장하지 못했어요", traceId: null };
    expect(host.controller.getState().errors.get(CLOSE_KEY)).toEqual(expected);

    host.local.refuse("throw");
    host.controller.edit(CLOSE_KEY, "quit");
    await host.controller.commit(CLOSE_KEY);
    expect(host.controller.getState().errors.get(CLOSE_KEY)).toEqual(expected);
  });
});

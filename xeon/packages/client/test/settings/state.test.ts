import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type { EffectiveSetting, SettingDefWire, SettingScope } from "@fresnel/contracts/settings";
import { activeLocale, setActiveLocale, type Locale } from "../../src/i18n/index.ts";
import {
  initialSettingsState,
  reduceSettings,
  settingsViewOf,
  type FieldError,
  type SettingsAction,
  type SettingsState,
} from "../../src/settings/index.ts";
import { effectiveOf, wireDef } from "./fixtures.ts";

// 설정 화면 상태 전이(state.ts)의 시험. 전이는 순수 함수라 호스트 없이 값으로 확인한다.

function threadOf(name: string): ThreadId {
  const parsed = parse(ThreadIdSchema, `thr_01HZX0000000000000000000${name}`);
  if (!parsed.ok) throw new Error("test thread id must parse");
  return parsed.value;
}

const BUDGET = "l1.models.budget";
const DEFAULT_MODEL = "l1.models.default";
const ENABLED = "l1.models.enabled";
const LEVEL = "l1.models.level";
const API_KEY = "l1.providers.apiKey";

const budgetDef = wireDef({
  key: BUDGET,
  type: { type: "integer" },
  range: { min: 1, max: 20 },
  ui: { tab: "models", widget: "number", order: 1, label: "판정 최대 횟수" },
});
const modelDef = wireDef({
  key: DEFAULT_MODEL,
  type: { type: "string" },
  ui: { tab: "models", widget: "text", order: 2, label: "기본 모델" },
});
const enabledDef = wireDef({
  key: ENABLED,
  type: { type: "boolean" },
  ui: { tab: "models", widget: "toggle", order: 3, label: "켜기" },
});
const levelDef = wireDef({
  key: LEVEL,
  type: { type: "string" },
  range: { enum: ["low", "high"] },
  ui: { tab: "models", widget: "select", order: 4, label: "추론 레벨" },
});
const apiKeyDef = wireDef({
  key: API_KEY,
  type: { type: "string" },
  secret: true,
  ui: { tab: "providers", widget: "secret", order: 1, label: "API 키" },
});

function settingOf(def: SettingDefWire, value: unknown): EffectiveSetting {
  return effectiveOf(def.key, value, { runtimeChange: def.runtimeChange });
}

/** 정의와 값을 읽은 상태. 시험마다 같은 출발점이다 */
function loaded(...defs: readonly SettingDefWire[]): SettingsState {
  const withDefs = reduceSettings(initialSettingsState, {
    type: "catalogLoaded",
    origin: "engine",
    defs,
  });
  return reduceSettings(withDefs, {
    type: "valuesLoaded",
    settings: defs.map((def) => settingOf(def, def.default ?? null)),
  });
}

function run(state: SettingsState, ...actions: readonly SettingsAction[]): SettingsState {
  return actions.reduce(reduceSettings, state);
}

const base = (): SettingsState => loaded(budgetDef, modelDef, enabledDef, levelDef, apiKeyDef);

const LINK_LOST: FieldError = {
  kind: "transient",
  message: "엔진과 연결이 끊겼어요. 다시 연결되면 저장해 주세요",
};

let saved: Locale = "ko";
beforeEach(() => {
  saved = activeLocale();
  setActiveLocale("ko");
});
afterEach(() => {
  setActiveLocale(saved);
});

describe("loading", () => {
  test("catalogLoaded keeps the first definition of a repeated key", () => {
    const second = wireDef({
      ...budgetDef,
      ui: { tab: "models", widget: "number", order: 9, label: "나중" },
    });
    const state = reduceSettings(initialSettingsState, {
      type: "catalogLoaded",
      origin: "engine",
      defs: [budgetDef, second],
    });
    expect(state.defs.get(BUDGET)).toEqual(budgetDef);
    expect(state.defs.size).toBe(1);
  });

  test("valuesLoaded stores the effective values and marks the state ready", () => {
    const setting = settingOf(budgetDef, 7);
    const state = run(
      initialSettingsState,
      { type: "loadStarted" },
      { type: "valuesLoaded", settings: [setting] },
    );
    expect(state.status).toBe("ready");
    expect(state.loadError).toBeNull();
    expect(state.values.get(BUDGET)).toEqual(setting);
  });

  test("loadFailed records the error and failed status; a later valuesLoaded clears both", () => {
    const failed = run(initialSettingsState, { type: "loadFailed", error: LINK_LOST });
    expect(failed.status).toBe("failed");
    expect(failed.loadError).toEqual(LINK_LOST);
    const recovered = run(failed, { type: "valuesLoaded", settings: [] });
    expect(recovered.status).toBe("ready");
    expect(recovered.loadError).toBeNull();
  });
});

describe("drafts and client checks", () => {
  test("a number typed as text becomes a number draft with no issues", () => {
    const state = run(base(), { type: "draftEdited", key: BUDGET, raw: "7" });
    expect(state.drafts.get(BUDGET)).toEqual({ value: 7, issues: [] });
  });

  test("a value out of range is kept as a draft with the range issue", () => {
    const state = run(base(), { type: "draftEdited", key: BUDGET, raw: 25 });
    expect(state.drafts.get(BUDGET)).toEqual({
      value: 25,
      issues: [{ path: "", message: "1에서 20 사이로 적어 주세요" }],
    });
  });

  test("an empty number input is kept as an issue, not converted to zero", () => {
    const state = run(base(), { type: "draftEdited", key: BUDGET, raw: "  " });
    expect(state.drafts.get(BUDGET)).toEqual({
      value: "  ",
      issues: [{ path: "", message: "형식이 맞지 않아요" }],
    });
  });

  test("a new edit clears the previous error for that key", () => {
    const withError = run(base(), { type: "writeBlocked", key: BUDGET, error: LINK_LOST });
    expect(withError.errors.get(BUDGET)).toEqual(LINK_LOST);
    const edited = run(withError, { type: "draftEdited", key: BUDGET, raw: 3 });
    expect(edited.errors.has(BUDGET)).toBe(false);
    expect(edited.drafts.get(BUDGET)).toEqual({ value: 3, issues: [] });
  });

  test("a plain value typed into a secret field is dropped and never kept in the state", () => {
    const state = run(base(), { type: "draftEdited", key: API_KEY, raw: "sk-plain-value-000" });
    expect(state.drafts.has(API_KEY)).toBe(false);
    expect(state.errors.get(API_KEY)).toEqual({
      kind: "invalidValue",
      message: "형식이 맞지 않아요",
      issues: [{ path: "", message: "형식이 맞지 않아요" }],
    });
    expect(JSON.stringify(state)).not.toContain("sk-plain-value-000");
  });

  test("a secret reference is kept as the draft value", () => {
    const state = run(base(), {
      type: "draftEdited",
      key: API_KEY,
      raw: "secret://exa-api-key",
    });
    expect(state.drafts.get(API_KEY)).toEqual({ value: "secret://exa-api-key", issues: [] });
  });

  test("an edit to a read-only field changes nothing", () => {
    const mismatched = wireDef({
      key: "l1.models.mismatch",
      type: { type: "string" },
      ui: { tab: "models", widget: "toggle", order: 5, label: "잘못된 위젯" },
    });
    const state = loaded(mismatched);
    expect(run(state, { type: "draftEdited", key: mismatched.key, raw: "x" })).toBe(state);
  });

  test("an edit to a key without a definition changes nothing", () => {
    const state = base();
    expect(run(state, { type: "draftEdited", key: "l1.models.unknown", raw: 1 })).toBe(state);
  });

  test("draftDiscarded clears the draft, the error, and the changed-elsewhere flag", () => {
    const dirty = run(
      base(),
      { type: "draftEdited", key: BUDGET, raw: 3 },
      { type: "writeBlocked", key: BUDGET, error: LINK_LOST },
      { type: "invalidated", keys: [BUDGET] },
    );
    expect(dirty.remoteChanged.has(BUDGET)).toBe(true);
    const discarded = run(dirty, { type: "draftDiscarded", key: BUDGET });
    expect(discarded.drafts.has(BUDGET)).toBe(false);
    expect(discarded.errors.has(BUDGET)).toBe(false);
    expect(discarded.remoteChanged.size).toBe(0);
  });
});

describe("scope selection", () => {
  test("a writable scope is selected for the key", () => {
    const state = run(base(), { type: "scopeSelected", key: BUDGET, scope: "project" });
    expect(state.scopes.get(BUDGET)).toBe("project");
  });

  test("managed is never selectable, so the state is unchanged", () => {
    const state = base();
    const managed: SettingScope = "managed";
    const next = run(state, { type: "scopeSelected", key: BUDGET, scope: managed });
    expect(next).toBe(state);
  });

  test("launch is not selectable while no thread is open", () => {
    const state = base();
    expect(run(state, { type: "scopeSelected", key: BUDGET, scope: "launch" })).toBe(state);
    const withThread = run(state, { type: "threadChanged", threadId: threadOf("AA") });
    expect(
      run(withThread, { type: "scopeSelected", key: BUDGET, scope: "launch" }).scopes.get(BUDGET),
    ).toBe("launch");
  });
});

describe("writes", () => {
  test("writeStarted records the request number, marks saving, and clears the error", () => {
    const state = run(
      base(),
      { type: "writeBlocked", key: BUDGET, error: LINK_LOST },
      { type: "writeStarted", key: BUDGET, seq: 1 },
    );
    expect(state.requestSeq.get(BUDGET)).toBe(1);
    expect([...state.saving]).toEqual([BUDGET]);
    expect(state.errors.has(BUDGET)).toBe(false);
  });

  test("writeSucceeded applies the saved value, clears the sent draft, the saving mark, and the flag", () => {
    const state = run(
      base(),
      { type: "draftEdited", key: BUDGET, raw: "5" },
      { type: "writeStarted", key: BUDGET, seq: 1 },
      { type: "writeSucceeded", key: BUDGET, seq: 1, setting: settingOf(budgetDef, 5), sent: 5 },
    );
    expect(state.values.get(BUDGET)?.value).toBe(5);
    expect(state.drafts.has(BUDGET)).toBe(false);
    expect(state.saving.size).toBe(0);
    expect(state.errors.size).toBe(0);
    expect(state.remoteChanged.size).toBe(0);
  });

  test("writeSucceeded keeps a draft that was edited while the write was in flight", () => {
    const state = run(
      base(),
      { type: "draftEdited", key: BUDGET, raw: 5 },
      { type: "writeStarted", key: BUDGET, seq: 1 },
      { type: "draftEdited", key: BUDGET, raw: 6 },
      { type: "writeSucceeded", key: BUDGET, seq: 1, setting: settingOf(budgetDef, 5), sent: 5 },
    );
    expect(state.values.get(BUDGET)?.value).toBe(5);
    expect(state.drafts.get(BUDGET)).toEqual({ value: 6, issues: [] });
    expect(state.saving.size).toBe(0);
  });

  test("a response for an older request number is ignored", () => {
    const pending = run(
      base(),
      { type: "writeStarted", key: BUDGET, seq: 1 },
      { type: "writeStarted", key: BUDGET, seq: 2 },
    );
    const late = reduceSettings(pending, {
      type: "writeSucceeded",
      key: BUDGET,
      seq: 1,
      setting: settingOf(budgetDef, 9),
      sent: 9,
    });
    expect(late).toBe(pending);
    expect(late.values.get(BUDGET)?.value).toBe(budgetDef.default ?? null);
  });

  test("writeFailed with a plain error keeps the draft and records the error", () => {
    const state = run(
      base(),
      { type: "draftEdited", key: BUDGET, raw: 4 },
      { type: "writeStarted", key: BUDGET, seq: 1 },
      { type: "writeFailed", key: BUDGET, seq: 1, error: LINK_LOST },
    );
    expect(state.drafts.get(BUDGET)).toEqual({ value: 4, issues: [] });
    expect(state.errors.get(BUDGET)).toEqual(LINK_LOST);
    expect(state.saving.size).toBe(0);
  });

  test("writeFailed with secretValue discards the draft", () => {
    const secretError: FieldError = {
      kind: "secretValue",
      message: "시크릿 값은 여기에 넣을 수 없어요. 시크릿 탭에서 등록한 뒤 참조를 골라 주세요",
    };
    const state = run(
      base(),
      { type: "draftEdited", key: API_KEY, raw: "secret://exa-api-key" },
      { type: "writeStarted", key: API_KEY, seq: 1 },
      { type: "writeFailed", key: API_KEY, seq: 1, error: secretError },
    );
    expect(state.drafts.has(API_KEY)).toBe(false);
    expect(state.errors.get(API_KEY)).toEqual(secretError);
  });

  test("a failed write from an older request number leaves the state unchanged", () => {
    const pending = run(base(), { type: "writeStarted", key: BUDGET, seq: 2 });
    expect(
      reduceSettings(pending, { type: "writeFailed", key: BUDGET, seq: 1, error: LINK_LOST }),
    ).toBe(pending);
  });

  test("resetSucceeded applies the value and clears the flag but keeps the draft", () => {
    const state = run(
      base(),
      { type: "draftEdited", key: BUDGET, raw: 3 },
      { type: "invalidated", keys: [BUDGET] },
      { type: "writeStarted", key: BUDGET, seq: 1 },
      { type: "resetSucceeded", key: BUDGET, seq: 1, setting: settingOf(budgetDef, 10) },
    );
    expect(state.values.get(BUDGET)?.value).toBe(10);
    expect(state.drafts.get(BUDGET)).toEqual({ value: 3, issues: [] });
    expect(state.remoteChanged.size).toBe(0);
    expect(state.saving.size).toBe(0);
  });
});

describe("changes from elsewhere", () => {
  test("empty keys mark every key that has a draft and leave clean keys alone", () => {
    const state = run(
      base(),
      { type: "draftEdited", key: BUDGET, raw: 3 },
      { type: "draftEdited", key: DEFAULT_MODEL, raw: "m" },
      { type: "invalidated", keys: [] },
    );
    expect([...state.remoteChanged].toSorted()).toEqual([BUDGET, DEFAULT_MODEL].toSorted());
    expect(state.drafts.get(BUDGET)).toEqual({ value: 3, issues: [] });
  });

  test("keys with no draft change nothing, so the same state comes back", () => {
    const state = base();
    expect(run(state, { type: "invalidated", keys: [ENABLED] })).toBe(state);
  });

  test("a key with a draft is marked once; a second notice returns the same state", () => {
    const marked = run(
      base(),
      { type: "draftEdited", key: BUDGET, raw: 3 },
      { type: "invalidated", keys: [BUDGET] },
    );
    expect(run(marked, { type: "invalidated", keys: [BUDGET] })).toBe(marked);
  });

  test("a value read again keeps a draft and does not set the flag by itself", () => {
    const state = run(
      base(),
      { type: "draftEdited", key: BUDGET, raw: 3 },
      { type: "valuesLoaded", settings: [settingOf(budgetDef, 12)] },
    );
    expect(state.values.get(BUDGET)?.value).toBe(12);
    expect(state.drafts.get(BUDGET)).toEqual({ value: 3, issues: [] });
    expect(state.remoteChanged.size).toBe(0);
  });
});

describe("thread and restart", () => {
  test("threadChanged to the same thread returns the same state", () => {
    const state = run(base(), { type: "threadChanged", threadId: threadOf("AA") });
    expect(run(state, { type: "threadChanged", threadId: threadOf("AA") })).toBe(state);
    expect(state.threadId).toBe(threadOf("AA"));
  });

  test("restartFailed records the error and restartRequested clears it", () => {
    const failed = run(base(), { type: "restartFailed", error: LINK_LOST });
    expect(failed.restartError).toEqual(LINK_LOST);
    expect(run(failed, { type: "restartRequested" }).restartError).toBeNull();
  });
});

describe("view overlay", () => {
  test("settingsViewOf shows the draft value, the dirty mark, the error, and the selected scope", () => {
    const state = run(
      base(),
      { type: "draftEdited", key: BUDGET, raw: 25 },
      { type: "scopeSelected", key: BUDGET, scope: "project" },
    );
    const field = settingsViewOf(state)
      .tabs.find((tab) => tab.id === "models")
      ?.fields.find((entry) => entry.key === BUDGET);
    expect(field).toMatchObject({
      value: 25,
      dirty: true,
      issues: [{ path: "", message: "1에서 20 사이로 적어 주세요" }],
      saving: false,
      error: null,
      remoteChanged: false,
      selectedScope: "project",
    });
  });

  test("settingsViewOf marks a saving field and a changed-elsewhere field", () => {
    const state = run(
      base(),
      { type: "draftEdited", key: BUDGET, raw: 3 },
      { type: "invalidated", keys: [BUDGET] },
      { type: "writeStarted", key: BUDGET, seq: 1 },
    );
    const field = settingsViewOf(state)
      .tabs.find((tab) => tab.id === "models")
      ?.fields.find((entry) => entry.key === BUDGET);
    expect(field).toMatchObject({ saving: true, remoteChanged: true, value: 3 });
  });

  test("settingsViewOf gives the same result for the same state", () => {
    const state = run(base(), { type: "draftEdited", key: LEVEL, raw: "high" });
    expect(settingsViewOf(state)).toEqual(settingsViewOf(state));
  });

  test("a field without a draft shows the effective value and no edit marks", () => {
    const field = settingsViewOf(base())
      .tabs.find((tab) => tab.id === "models")
      ?.fields.find((entry) => entry.key === ENABLED);
    expect(field).toMatchObject({
      dirty: false,
      issues: [],
      saving: false,
      error: null,
      remoteChanged: false,
    });
  });
});

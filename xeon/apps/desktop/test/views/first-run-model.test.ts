import { describe, expect, test } from "bun:test";
import type { ProviderEntry, SetupSnapshot } from "@fresnel/client/settings";
import { toolsWebViewOf } from "@fresnel/client";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import type {
  WebProviderStatus,
  WebProvidersResult,
  WebSettingsWire,
} from "@fresnel/contracts/wire";
import type { GroupsSnapshot, SearchSnapshot } from "../../src/views/commands.ts";
import {
  firstRunModelOf,
  groupOnOf,
  groupRowsOf,
  keyViewOf,
  STEP_ORDER,
  stepIdAt,
  unknownStepsOf,
} from "../../src/views/pages/first-run/first-run-model.ts";

// 첫 실행 화면의 순수 모델. 단계 순서, 완료와 다음 단계, 기본 그룹(기본 켬, review 끔, 안전 모드 값), 모델 키 칸을 값으로 본다.

const TOOLS_OK: SetupSnapshot = {
  providers: [],
  defaultModel: null,
  secrets: [],
  toolsReady: true,
  binaries: null,
};

const ANTHROPIC: ProviderEntry = {
  id: "anthropic",
  enabled: true,
  apiKeyRef: "secret://anthropic-api-key",
  baseUrl: null,
};

/** 키를 등록하고 기본 모델을 정한 설치. 검색과 그룹은 따로 정한다 */
const KEYED: SetupSnapshot = {
  providers: [ANTHROPIC],
  defaultModel: "anthropic/claude-sonnet-5-5",
  secrets: [{ name: "anthropic-api-key", registered: true }],
  toolsReady: true,
  binaries: null,
};

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error("test name must parse");
  return parsed.value;
}

const GROUPS_DEFAULT: GroupsSnapshot = {
  enabled: { helm: null, learning: null },
  safeMode: false,
};

const WEB_SETTINGS: WebSettingsWire = {
  searchProvider: "auto",
  searchOrder: [],
  searchParallel: 1,
  browseProvider: "auto",
  browseOrder: [],
  robots: "never",
};

function webRow(id: string, status: WebProviderStatus["status"]): WebProviderStatus {
  return {
    id,
    capability: "web.search",
    origin: "plugin",
    displayName: id,
    auth: "bearer",
    status,
    pricingAsOf: null,
    pricingStale: false,
    firstUseNoticed: true,
    autoRank: null,
  };
}

const EXA_OK = webRow("plugin:web-exa", { kind: "ok" });
const EXA_NO_KEY = webRow("plugin:web-exa", { kind: "unavailable", reason: "no-key" });
const BRAVE_OK = webRow("plugin:web-brave", { kind: "ok" });

function searchOf(rows: readonly WebProviderStatus[], dismissed: boolean): SearchSnapshot {
  const result: WebProvidersResult = { providers: [...rows], settings: WEB_SETTINGS };
  return { web: toolsWebViewOf(result), dismissed };
}

describe("first-run steps", () => {
  test("the steps keep the screen order: tools, key, model, web search, then default groups", () => {
    const model = firstRunModelOf({ setup: TOOLS_OK, search: null, groups: null });
    expect(model.steps.map((step) => step.id)).toEqual([
      "tools",
      "key",
      "model",
      "search",
      "groups",
    ]);
    expect(STEP_ORDER).toEqual(["tools", "key", "model", "search", "groups"]);
  });

  test("a fresh install waits on the key first, and only the optional steps can be skipped", () => {
    const model = firstRunModelOf({
      setup: TOOLS_OK,
      search: searchOf([], false),
      groups: GROUPS_DEFAULT,
    });
    expect(
      model.steps.map((step) => ({ id: step.id, done: step.done, optional: step.optional })),
    ).toEqual([
      { id: "tools", done: true, optional: false },
      { id: "key", done: false, optional: false },
      { id: "model", done: false, optional: false },
      { id: "search", done: false, optional: true },
      { id: "groups", done: true, optional: true },
    ]);
    expect(model.next).toEqual("key");
    expect(model.readyToChat).toBe(false);
  });

  test("the default model is locked until a key is registered and connected", () => {
    const withoutKey = firstRunModelOf({ setup: TOOLS_OK, search: null, groups: null });
    expect(withoutKey.steps.find((step) => step.id === "model")?.locked).toBe(true);
    const withKey = firstRunModelOf({ setup: KEYED, search: null, groups: null });
    expect(withKey.steps.find((step) => step.id === "model")?.locked).toBe(false);
  });

  test("with a key and a model the chat is ready, and the next step is the unfinished search", () => {
    const model = firstRunModelOf({
      setup: KEYED,
      search: searchOf([], false),
      groups: GROUPS_DEFAULT,
    });
    expect(model.readyToChat).toBe(true);
    expect(model.next).toEqual("search");
    expect(model.defaultModel).toEqual("anthropic/claude-sonnet-5-5");
  });

  test("a step whose check was not read is unknown and next skips it", () => {
    const model = firstRunModelOf({
      setup: { ...TOOLS_OK, toolsReady: null },
      search: null,
      groups: null,
    });
    expect(model.steps.find((step) => step.id === "tools")).toEqual({
      id: "tools",
      done: false,
      unknown: true,
      optional: false,
      locked: false,
    });
    expect(model.next).toEqual("key");
  });

  test("an unread web search is unknown and does not block next", () => {
    const model = firstRunModelOf({ setup: KEYED, search: null, groups: GROUPS_DEFAULT });
    expect(model.searchState).toEqual("unknown");
    expect(model.steps.find((step) => step.id === "search")?.unknown).toBe(true);
    expect(model.next).toEqual(null);
    expect(model.readyToChat).toBe(true);
  });

  test("the search step is ready when every recommendation is ready, and dismissed counts as done", () => {
    const ready = firstRunModelOf({
      setup: KEYED,
      search: searchOf([EXA_OK, BRAVE_OK], false),
      groups: GROUPS_DEFAULT,
    });
    expect(ready.searchState).toEqual("ready");
    expect(ready.steps.find((step) => step.id === "search")?.done).toBe(true);

    const dismissed = firstRunModelOf({
      setup: KEYED,
      search: searchOf([EXA_NO_KEY, BRAVE_OK], true),
      groups: GROUPS_DEFAULT,
    });
    expect(dismissed.searchState).toEqual("dismissed");
    expect(dismissed.steps.find((step) => step.id === "search")?.done).toBe(true);

    const pending = firstRunModelOf({
      setup: KEYED,
      search: searchOf([EXA_NO_KEY, BRAVE_OK], false),
      groups: GROUPS_DEFAULT,
    });
    expect(pending.searchState).toEqual("pending");
    expect(pending.steps.find((step) => step.id === "search")?.done).toBe(false);
  });
});

describe("first-run default groups", () => {
  test("both default groups are on when no value was saved, and review is off and not switchable", () => {
    expect(groupRowsOf(GROUPS_DEFAULT)).toEqual([
      { id: "helm", on: true, switchable: true },
      { id: "learning", on: true, switchable: true },
      { id: "review", on: false, switchable: false },
    ]);
    expect(groupOnOf(null)).toBe(true);
  });

  test("a saved value overrides the default for its group only", () => {
    const groups: GroupsSnapshot = { enabled: { helm: false, learning: null }, safeMode: false };
    expect(groupRowsOf(groups)).toEqual([
      { id: "helm", on: false, switchable: true },
      { id: "learning", on: true, switchable: true },
      { id: "review", on: false, switchable: false },
    ]);
  });

  test("the group step is done only while both default groups are on", () => {
    const helmOff = firstRunModelOf({
      setup: KEYED,
      search: null,
      groups: { enabled: { helm: false, learning: null }, safeMode: false },
    });
    expect(helmOff.steps.find((step) => step.id === "groups")?.done).toBe(false);
    const allOn = firstRunModelOf({ setup: KEYED, search: null, groups: GROUPS_DEFAULT });
    expect(allOn.steps.find((step) => step.id === "groups")?.done).toBe(true);
  });

  test("the safe mode flag reaches the model so the screen can show its one-line notice", () => {
    const model = firstRunModelOf({
      setup: KEYED,
      search: null,
      groups: { enabled: { helm: null, learning: null }, safeMode: true },
    });
    expect(model.groups?.safeMode).toBe(true);
  });

  test("groups that were not read leave the step unknown", () => {
    const model = firstRunModelOf({ setup: KEYED, search: null, groups: null });
    expect(model.steps.find((step) => step.id === "groups")).toEqual({
      id: "groups",
      done: false,
      unknown: true,
      optional: true,
      locked: false,
    });
  });
});

describe("first-run key and step helpers", () => {
  test("a fresh install shows the anthropic secret name as not registered and not linked", () => {
    expect(keyViewOf(TOOLS_OK, "anthropic")).toEqual({
      secretName: nameOf("anthropic-api-key"),
      registered: false,
      linked: false,
    });
  });

  test("a registered secret that the provider uses is registered and linked", () => {
    expect(keyViewOf(KEYED, "anthropic")).toEqual({
      secretName: nameOf("anthropic-api-key"),
      registered: true,
      linked: true,
    });
  });

  test("a provider name that breaks the rule has no secret name", () => {
    expect(keyViewOf(KEYED, "Bad Name")).toEqual({
      secretName: null,
      registered: false,
      linked: false,
    });
  });

  test("a step number maps to its step id, and an out-of-range number maps to null", () => {
    expect(stepIdAt(0)).toEqual("tools");
    expect(stepIdAt(4)).toEqual("groups");
    expect(stepIdAt(5)).toEqual(null);
  });

  test("before anything is read every step is unknown", () => {
    expect(unknownStepsOf().map((step) => [step.id, step.unknown])).toEqual([
      ["tools", true],
      ["key", true],
      ["model", true],
      ["search", true],
      ["groups", true],
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import { MODELS_SETTING_DEFS } from "@xeon/core-models";
import {
  toSettingDefWire,
  type EffectiveSetting,
  type SettingDefWire,
} from "@xeon/contracts/settings";
import {
  TAB_ORDER,
  TAB_SPECS,
  buildSettingsView,
  settingsViewKeys,
  type FieldVM,
  type SettingsView,
  type ViewDiagnostic,
} from "../../src/settings/index.ts";
import { effectiveOf, wireDef } from "./fixtures.ts";

function valuesOf(...settings: readonly EffectiveSetting[]): ReadonlyMap<string, EffectiveSetting> {
  return new Map(settings.map((setting) => [setting.key, setting]));
}

function viewOf(
  defs: readonly SettingDefWire[],
  values: ReadonlyMap<string, EffectiveSetting>,
  hasThread = true,
): SettingsView {
  return buildSettingsView({ defs, values, hasThread });
}

function fieldOf(view: SettingsView, key: string): FieldVM | undefined {
  for (const tab of view.tabs) {
    const found = tab.fields.find((field) => field.key === key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function keysOf(view: SettingsView, tabId: string): readonly string[] {
  const tab = view.tabs.find((entry) => entry.id === tabId);
  return tab?.fields.map((field) => field.key) ?? [];
}

const toggleModels = (
  key: string,
  order: number,
  value: boolean,
): { def: SettingDefWire; setting: EffectiveSetting } => ({
  def: wireDef({
    key,
    type: { type: "boolean" },
    ui: { tab: "models", widget: "toggle", order, label: key },
  }),
  setting: effectiveOf(key, value),
});

describe("tabs and placement", () => {
  test("13 tabs in table order even with no definitions, each with its empty text", () => {
    const view = viewOf([], new Map());
    expect(view.tabs.map((tab) => tab.id)).toEqual([...TAB_ORDER]);
    expect(view.tabs).toHaveLength(13);
    expect(view.tabs.every((tab) => tab.fields.length === 0)).toBe(true);
    expect(view.tabs.find((tab) => tab.id === "models")?.emptyText).toBe(
      TAB_SPECS.models.emptyText,
    );
    expect(view.restartBanner).toBeNull();
  });

  test("the gauge slot sits only on budgets and providers", () => {
    const view = viewOf([], new Map());
    const gauges = view.tabs.filter((tab) => tab.gauge !== null).map((tab) => tab.id);
    expect(gauges).toEqual(["budgets", "providers"]);
    expect(view.tabs.find((tab) => tab.id === "budgets")?.gauge).toEqual({
      tab: "budgets",
      status: "unavailable",
      text: "사용량 정보는 아직 볼 수 없어요",
    });
  });

  test("items sort by ui.order, then by key, and stay in their own tab", () => {
    const beta = toggleModels("l1.models.beta", 1, true);
    const alpha = toggleModels("l1.models.alpha", 1, false);
    const gamma = toggleModels("l1.models.gamma", 0, true);
    const loop = wireDef({
      key: "l1.loop.maxSteps",
      type: { type: "boolean" },
      ui: { tab: "budgets", widget: "toggle", order: 5, label: "loop" },
    });
    const view = viewOf(
      [beta.def, alpha.def, gamma.def, loop],
      valuesOf(beta.setting, alpha.setting, gamma.setting, effectiveOf("l1.loop.maxSteps", true)),
    );
    expect(keysOf(view, "models")).toEqual([
      "l1.models.gamma",
      "l1.models.alpha",
      "l1.models.beta",
    ]);
    expect(keysOf(view, "budgets")).toEqual(["l1.loop.maxSteps"]);
  });

  test("a definition without ui goes to fileOnly with its value JSON schema, not into a tab", () => {
    const plain = wireDef({
      key: "l1.models.plain",
      type: { type: "integer" },
      range: { min: 0, max: 9 },
    });
    const view = viewOf([plain], valuesOf(effectiveOf("l1.models.plain", 3)));
    expect(view.fileOnly.map((entry) => entry.key)).toEqual(["l1.models.plain"]);
    expect(view.fileOnly[0]?.value).toBe(3);
    expect(view.fileOnly[0]?.jsonSchema).toMatchObject({ type: "integer", minimum: 0, maximum: 9 });
    expect(view.tabs.every((tab) => tab.fields.length === 0)).toBe(true);
  });

  test("an unknown tab goes to fileOnly and reports unknownTab", () => {
    const future = wireDef({
      key: "l1.models.future",
      type: { type: "boolean" },
      // @ts-expect-error -- 새 F 부 버전이 보낸 탭 값을 흉내 낸다. 타입에는 없는 값이다
      ui: { tab: "future", widget: "toggle", order: 1, label: "미래" },
    });
    const view = viewOf([future], valuesOf(effectiveOf("l1.models.future", true)));
    expect(view.fileOnly.map((entry) => entry.key)).toEqual(["l1.models.future"]);
    expect(view.diagnostics).toContainEqual({
      code: "unknownTab",
      key: "l1.models.future",
      tab: "future",
    });
  });

  test("reserved definitions never get a tab field and report no missing value", () => {
    const reserved = wireDef({
      key: "l1.models.reserved",
      type: { type: "boolean" },
      stage: "reserved",
      ui: { tab: "models", widget: "toggle", order: 1, label: "예약" },
    });
    const view = viewOf([reserved], new Map());
    expect(keysOf(view, "models")).toEqual([]);
    expect(view.fileOnly.map((entry) => entry.key)).toEqual(["l1.models.reserved"]);
    expect(view.diagnostics).toEqual([]);
  });
});

describe("deprecated definitions", () => {
  const oldKey = wireDef({
    key: "l1.models.oldReview",
    type: { type: "string" },
    deprecated: { since: "0.2.0", replacedBy: "l1.models.routing.review" },
    ui: { tab: "models", widget: "text", order: 1, label: "옛 검토 모델" },
  });

  test("hidden when the value comes from the default or is absent", () => {
    expect(viewOf([oldKey], new Map()).tabs.every((tab) => tab.fields.length === 0)).toBe(true);
    const fromDefault = valuesOf(
      effectiveOf("l1.models.oldReview", null, { source: { scope: "default" } }),
    );
    const view = viewOf([oldKey], fromDefault);
    expect(keysOf(view, "models")).toEqual([]);
    expect(view.overview.deprecatedInUse).toEqual([]);
  });

  test("shown with a deprecated badge once the user sets a value, and listed as in use", () => {
    const view = viewOf([oldKey], valuesOf(effectiveOf("l1.models.oldReview", "p/m")));
    const field = fieldOf(view, "l1.models.oldReview");
    expect(field?.deprecated).toEqual({
      since: "0.2.0",
      replacedBy: "l1.models.routing.review",
      replacedByLabel: null,
      note: null,
    });
    expect(view.overview.deprecatedInUse).toEqual(["l1.models.oldReview"]);
  });
});

describe("field facts", () => {
  test("scope, file path, shadowed values, write scopes and reset come from the setting", () => {
    const def = wireDef({
      key: "l1.models.review",
      type: { type: "string" },
      ui: { tab: "models", widget: "text", order: 1, label: "검토" },
    });
    const setting = effectiveOf("l1.models.review", "p/m", {
      source: { scope: "project", path: "/work/.xeon/settings.json" },
      shadowed: [{ scope: "user", path: "/home/user/.xeon/settings.json" }],
    });
    const field = fieldOf(viewOf([def], valuesOf(setting)), "l1.models.review");
    expect(field?.scope).toEqual({ scope: "project", text: "프로젝트", tone: "project" });
    expect(field?.filePath).toBe("/work/.xeon/settings.json");
    expect(field?.shadowed).toEqual([{ scope: "user", path: "/home/user/.xeon/settings.json" }]);
    expect(field?.selectedScope).toBe("user");
    expect(field?.canReset).toBe(true);
    expect(field?.editable).toBe(true);
    expect(field?.widget).toEqual({
      kind: "text",
      minLength: null,
      maxLength: null,
      pattern: null,
    });
  });

  test("a locked field is not editable, has no candidates and no reset", () => {
    const def = wireDef({
      key: "l1.models.review",
      type: { type: "string" },
      ui: { tab: "models", widget: "text", order: 1, label: "검토" },
    });
    const setting = effectiveOf("l1.models.review", "p/m", {
      locked: true,
      lockReason: "managed_file",
      source: { scope: "managed", path: "/etc/xeon/managed.json" },
    });
    const field = fieldOf(viewOf([def], valuesOf(setting)), "l1.models.review");
    expect(field?.lock?.text).toBe("관리 정책으로 잠겨 있어요 정책 파일: /etc/xeon/managed.json");
    expect(field?.writableScopes).toEqual([]);
    expect(field?.selectedScope).toBeNull();
    expect(field?.editable).toBe(false);
    expect(field?.canReset).toBe(false);
  });

  test("a missing value is read-only and reports missingValue", () => {
    const def = wireDef({
      key: "l1.models.flag",
      type: { type: "boolean" },
      ui: { tab: "models", widget: "toggle", order: 1, label: "켜기" },
    });
    const view = viewOf([def], new Map());
    const field = fieldOf(view, "l1.models.flag");
    expect(field?.widget).toEqual({ kind: "readonly" });
    expect(field?.editable).toBe(false);
    expect(view.diagnostics).toEqual([{ code: "missingValue", key: "l1.models.flag" }]);
  });

  test("a widget that does not fit the type is read-only with widgetMismatch", () => {
    const def = wireDef({
      key: "l1.models.flag",
      type: { type: "boolean" },
      ui: { tab: "models", widget: "number", order: 1, label: "숫자" },
    });
    const view = viewOf([def], valuesOf(effectiveOf("l1.models.flag", true)));
    expect(fieldOf(view, "l1.models.flag")?.widget).toEqual({ kind: "readonly" });
    expect(view.diagnostics).toEqual([
      { code: "widgetMismatch", key: "l1.models.flag", widget: "number" },
    ]);
  });
});

describe("secret fields", () => {
  const secretDef = wireDef({
    key: "l0.secrets.exaKey",
    layer: "L0",
    type: { type: "string", pattern: "^secret://[a-z][a-z0-9-]{1,63}$" },
    secret: true,
    allowedScopes: ["user"],
    ui: { tab: "secrets", widget: "secret", order: 1, label: "Exa 키" },
  });

  test("a plain value is never shown: the field value is null and the status unset", () => {
    const view = viewOf(
      [secretDef],
      valuesOf(effectiveOf("l0.secrets.exaKey", "sk-PLANTED-PLAIN-VALUE-123")),
    );
    const field = fieldOf(view, "l0.secrets.exaKey");
    expect(field?.value).toBeNull();
    expect(field?.secret).toEqual({ ref: null, status: "unset" });
    expect(JSON.stringify(view)).not.toContain("PLANTED");
  });

  test("a reference is shown as the reference and the status referenced", () => {
    const view = viewOf(
      [secretDef],
      valuesOf(effectiveOf("l0.secrets.exaKey", "secret://exa-api-key")),
    );
    const field = fieldOf(view, "l0.secrets.exaKey");
    expect(field?.value).toBe("secret://exa-api-key");
    expect(field?.secret).toEqual({ ref: "secret://exa-api-key", status: "referenced" });
  });

  test("a file-only secret is coerced the same way", () => {
    const fileOnlySecret = wireDef({
      key: "l0.secrets.hidden",
      layer: "L0",
      type: { type: "string", pattern: "^secret://[a-z][a-z0-9-]{1,63}$" },
      secret: true,
      allowedScopes: ["user"],
    });
    const view = viewOf(
      [fileOnlySecret],
      valuesOf(effectiveOf("l0.secrets.hidden", "sk-PLANTED-FILE-VALUE")),
    );
    expect(view.fileOnly[0]?.value).toBeNull();
    expect(JSON.stringify(view)).not.toContain("PLANTED");
  });
});

describe("overview and restart banner", () => {
  test("counts by scope including default, locks, pending changes, and secret references", () => {
    const userText = wireDef({
      key: "l1.models.a",
      type: { type: "string" },
      ui: { tab: "models", widget: "text", order: 1, label: "a" },
    });
    const missingText = wireDef({
      key: "l1.models.b",
      type: { type: "string" },
      ui: { tab: "models", widget: "text", order: 2, label: "b" },
    });
    const lockedRestart = wireDef({
      key: "l1.models.c",
      type: { type: "string" },
      runtimeChange: "restart",
      ui: { tab: "models", widget: "text", order: 3, label: "c" },
    });
    const projectNext = wireDef({
      key: "l1.models.d",
      type: { type: "string" },
      runtimeChange: "nextTurn",
      ui: { tab: "models", widget: "text", order: 4, label: "d" },
    });
    const secret = wireDef({
      key: "l0.secrets.k",
      layer: "L0",
      type: { type: "string", pattern: "^secret://[a-z][a-z0-9-]{1,63}$" },
      secret: true,
      ui: { tab: "secrets", widget: "secret", order: 1, label: "k" },
    });
    const view = viewOf(
      [userText, missingText, lockedRestart, projectNext, secret],
      valuesOf(
        effectiveOf("l1.models.a", "x"),
        effectiveOf("l1.models.c", "y", {
          locked: true,
          source: { scope: "managed", path: "/etc/xeon/m.json" },
          runtimeChange: "restart",
          pendingUntil: "restart",
        }),
        effectiveOf("l1.models.d", "z", {
          source: { scope: "project", path: "/p/.xeon/settings.json" },
          runtimeChange: "nextTurn",
          pendingUntil: "nextTurn",
        }),
        effectiveOf("l0.secrets.k", "secret://k-key"),
      ),
    );
    expect(view.overview.countsByScope).toEqual({
      managed: 1,
      user: 2,
      project: 1,
      local: 0,
      session: 0,
      default: 1,
    });
    expect(view.overview.locked).toEqual(["l1.models.c"]);
    expect(view.overview.pendingRestart).toEqual(["l1.models.c"]);
    expect(view.overview.pendingNextTurn).toEqual(["l1.models.d"]);
    expect(view.overview.secretRefs).toEqual([
      { key: "l0.secrets.k", tab: "secrets", status: "referenced" },
    ]);
    expect(view.restartBanner).toEqual({ count: 1, text: "재시작해야 적용되는 변경이 1개 있어요" });
  });

  test("no restart-pending value means no banner", () => {
    const def = toggleModels("l1.models.flag", 1, true).def;
    expect(viewOf([def], valuesOf(effectiveOf("l1.models.flag", true))).restartBanner).toBeNull();
  });
});

describe("keys, duplicates, determinism", () => {
  test("settingsViewKeys lists every tab field and file-only key, sorted", () => {
    const a = toggleModels("l1.models.beta", 1, true);
    const b = toggleModels("l1.models.alpha", 2, false);
    const plain = wireDef({ key: "l1.models.gamma", type: { type: "integer" } });
    const view = viewOf(
      [a.def, b.def, plain],
      valuesOf(a.setting, b.setting, effectiveOf("l1.models.gamma", 1)),
    );
    expect(settingsViewKeys(view)).toEqual([
      "l1.models.alpha",
      "l1.models.beta",
      "l1.models.gamma",
    ]);
  });

  test("a repeated key keeps the first definition and reports duplicateKey", () => {
    const first = toggleModels("l1.models.dup", 1, true).def;
    const second = wireDef({
      key: "l1.models.dup",
      type: { type: "boolean" },
      ui: { tab: "execution", widget: "toggle", order: 1, label: "두 번째" },
    });
    const view = viewOf([first, second], valuesOf(effectiveOf("l1.models.dup", true)));
    expect(keysOf(view, "models")).toEqual(["l1.models.dup"]);
    expect(keysOf(view, "execution")).toEqual([]);
    expect(view.diagnostics).toContainEqual({ code: "duplicateKey", key: "l1.models.dup" });
  });

  test("the same input gives the same view", () => {
    const a = toggleModels("l1.models.beta", 1, true);
    const b = toggleModels("l1.models.alpha", 1, false);
    const first = viewOf([a.def, b.def], valuesOf(a.setting, b.setting));
    const second = viewOf([b.def, a.def], valuesOf(b.setting, a.setting));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("real models definitions (l1.models.*)", () => {
  const wires: readonly SettingDefWire[] = MODELS_SETTING_DEFS.map((def) => toSettingDefWire(def));
  const defaults = new Map(
    wires.map((wire) => [
      wire.key,
      effectiveOf(wire.key, wire.default ?? null, {
        source: { scope: "default" },
        runtimeChange: wire.runtimeChange,
      }),
    ]),
  );
  const view = viewOf(wires, defaults);

  test("thinkingBudgets resolves to the fixed table", () => {
    const widget = fieldOf(view, "l1.models.thinkingBudgets")?.widget;
    expect(widget).toMatchObject({ kind: "table", shape: "fixed", maxItems: null });
    expect(widget?.kind === "table" ? widget.columns.map((column) => column.name) : []).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  test("the default model resolves to a text widget", () => {
    expect(fieldOf(view, "l1.models.default")?.widget).toMatchObject({
      kind: "text",
      maxLength: 265,
    });
  });

  test("routing.* (a nullable model reference) is a text field, groupRouting and rateLimit are record tables, thinkingBudgets is a fixed table", () => {
    for (const role of ["review", "summary", "subagent", "judge", "search"]) {
      expect(fieldOf(view, `l1.models.routing.${role}`)?.widget.kind).toBe("text");
    }
    expect(fieldOf(view, "l1.models.groupRouting")?.widget).toMatchObject({
      kind: "table",
      shape: "record",
    });
    expect(fieldOf(view, "l1.models.rateLimit")?.widget).toMatchObject({
      kind: "table",
      shape: "record",
    });
    expect(fieldOf(view, "l1.models.thinkingBudgets")?.widget).toMatchObject({
      kind: "table",
      shape: "fixed",
    });
  });

  test("every models definition is placed in its tab and none is a widget mismatch", () => {
    const mismatches = view.diagnostics
      .filter(
        (diagnostic): diagnostic is Extract<ViewDiagnostic, { code: "widgetMismatch" }> =>
          diagnostic.code === "widgetMismatch",
      )
      .map((diagnostic) => diagnostic.key);
    expect(mismatches).toEqual([]);
    expect(view.fileOnly).toEqual([]);
    expect(settingsViewKeys(view)).toHaveLength(wires.length);
  });

  test("without any value every models definition reports missingValue", () => {
    const empty = viewOf(wires, new Map());
    const missing = empty.diagnostics
      .filter((diagnostic) => diagnostic.code === "missingValue")
      .map((diagnostic) => diagnostic.key);
    expect(missing).toHaveLength(wires.length);
  });
});

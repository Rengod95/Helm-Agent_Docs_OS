import { describe, expect, test } from "bun:test";
import { reduceSettings, TAB_ORDER, settingsViewOf } from "@fresnel/client/settings";
import { thr } from "../state/helpers.ts";
import {
  allFieldsOf,
  dirtyKeysOf,
  fallbackScopeOf,
  fieldControlOf,
  fieldMatches,
  hasFooter,
  launchChoiceOf,
  numberValueOf,
  optionOf,
  pageStatusOf,
  remoteNoticeOf,
  restartCountOf,
  scopeChoiceShown,
  settingsKeyOf,
  searchGroupsOf,
  selectControlOf,
  tabStep,
  tabSwitchOf,
  tagsOf,
  textValueOf,
  valueSummaryOf,
  writableOf,
} from "../../src/views/pages/settings/settings-model.ts";
import { defOf, fieldIn, settingOf, stateOf, viewOf } from "./settings-fixtures.ts";

// 설정 화면(P-09)의 순수 모델 시험. 값은 `toEqual`·`toBe`로 정확히 비교한다.

const MODEL = defOf(
  "l1.models.default",
  "models",
  "text",
  { type: "string" },
  {},
  { order: 1, label: "기본 모델", help: "요청에 쓸 기본 모델" },
);
const STEPS = defOf(
  "l1.loop.maxSteps",
  "budgets",
  "number",
  { type: "integer" },
  { range: { min: 1, max: 20 } },
  { order: 2, label: "단계 상한" },
);
const THEME_OPTIONS = ["light", "dark"];
const THEME = defOf(
  "l4.cli.theme",
  "appearance",
  "select",
  { type: "string", enum: THEME_OPTIONS },
  { range: { enum: THEME_OPTIONS } },
  { order: 0, label: "테마" },
);

describe("tab order", () => {
  test("moving down or up wraps around the thirteen tabs", () => {
    expect(TAB_ORDER.length).toBe(13);
    expect(tabStep("overview", TAB_ORDER, 1)).toBe("models");
    expect(tabStep("advanced", TAB_ORDER, 1)).toBe("overview");
    expect(tabStep("overview", TAB_ORDER, -1)).toBe("advanced");
    expect(tabStep("models", TAB_ORDER, -1)).toBe("overview");
  });

  test("a tab that is not in the order stays where it is", () => {
    expect(tabStep("models", ["overview"], 1)).toBe("models");
  });

  test("choosing the current tab stays, a clean form moves, a dirty form asks first", () => {
    expect(tabSwitchOf({ current: "models", to: "models", dirtyKeys: ["a"] })).toEqual({
      kind: "stay",
    });
    expect(tabSwitchOf({ current: "models", to: "budgets", dirtyKeys: [] })).toEqual({
      kind: "move",
      to: "budgets",
    });
    expect(
      tabSwitchOf({ current: "models", to: "budgets", dirtyKeys: ["l1.models.default"] }),
    ).toEqual({ kind: "ask", to: "budgets", keys: ["l1.models.default"] });
  });
});

describe("key search", () => {
  const view = viewOf(
    [MODEL, STEPS, THEME],
    [settingOf(MODEL.key, "a/b"), settingOf(STEPS.key, 3)],
  );
  const field = fieldIn(view, MODEL.key);

  test("matches the label, the key and the help text, ignoring case and outer spaces", () => {
    if (field === undefined) throw new Error("field must exist");
    expect(fieldMatches(field, "기본")).toBe(true);
    expect(fieldMatches(field, "  MODELS.DEFAULT ")).toBe(true);
    expect(fieldMatches(field, "쓸 기본")).toBe(true);
    expect(fieldMatches(field, "maxSteps")).toBe(false);
  });

  test("an empty query matches every field", () => {
    if (field === undefined) throw new Error("field must exist");
    expect(fieldMatches(field, "   ")).toBe(true);
  });

  test("results are grouped by tab in tab order and empty tabs are left out", () => {
    const groups = searchGroupsOf(view.tabs, "단계");
    expect(groups.map((group) => group.tab)).toEqual(["budgets"]);
    expect(groups[0]?.fields.map((item) => item.key)).toEqual(["l1.loop.maxSteps"]);
    expect(searchGroupsOf(view.tabs, "없는말")).toEqual([]);
  });

  test("an empty query lists the fields of every tab that has one", () => {
    const groups = searchGroupsOf(view.tabs, "");
    expect(groups.map((group) => group.tab)).toEqual(["models", "budgets", "appearance"]);
    expect(allFieldsOf(view).map((item) => item.key)).toEqual([
      "l1.models.default",
      "l1.loop.maxSteps",
      "l4.cli.theme",
    ]);
  });
});

describe("field controls", () => {
  test("a select of eight options or fewer is a radio group, more is a select", () => {
    expect(selectControlOf(8)).toBe("radio");
    expect(selectControlOf(9)).toBe("select");
    expect(selectControlOf(1)).toBe("radio");
  });

  test("each widget kind has its control, and a dedicated editor is an editor slot", () => {
    const toggle = defOf("l4.cli.on", "appearance", "toggle", { type: "boolean" });
    const list = defOf("l1.models.allow", "models", "list", {
      type: "array",
      items: { type: "string" },
    });
    const table = defOf("l1.models.thinkingBudgets", "models", "table", {
      type: "object",
      properties: { low: { type: "integer" } },
      required: ["low"],
      additionalProperties: false,
    });
    const roles = defOf(
      "l1.models.roles",
      "models",
      "readonly",
      { type: "object" },
      {},
      { editor: "modelRoles" },
    );
    const view = viewOf(
      [THEME, MODEL, STEPS, toggle, list, table, roles],
      [
        settingOf(THEME.key, "dark"),
        settingOf(MODEL.key, "a/b"),
        settingOf(STEPS.key, 3),
        settingOf(toggle.key, true),
        settingOf(list.key, ["x"]),
        settingOf(table.key, { low: 1 }),
        settingOf(roles.key, {}),
      ],
    );
    const controls = Object.fromEntries(
      allFieldsOf(view).map((item) => [item.key, fieldControlOf(item)]),
    );
    expect(controls).toEqual({
      "l4.cli.theme": "select",
      "l4.cli.on": "switch",
      "l1.models.default": "text",
      "l1.models.allow": "tags",
      "l1.models.roles": "editor",
      "l1.models.thinkingBudgets": "summary",
      "l1.loop.maxSteps": "number",
    });
    const listField = fieldIn(view, list.key);
    if (listField === undefined) throw new Error("list field must exist");
    expect(hasFooter(listField)).toBe(true);
    const text = fieldIn(view, MODEL.key);
    if (text === undefined) throw new Error("text field must exist");
    expect(hasFooter(text)).toBe(false);
  });

  test("an option text maps back to the original option, numbers stay numbers", () => {
    expect(optionOf([1, 2, "x"], "2")).toBe(2);
    expect(optionOf(["a", "b"], "b")).toBe("b");
    expect(optionOf(["a", "b"], "c")).toBeNull();
  });

  test("the value readers take a matching type and fall back for anything else", () => {
    expect(numberValueOf(3)).toBe(3);
    expect(numberValueOf("3")).toBeNull();
    expect(textValueOf("abc")).toBe("abc");
    expect(textValueOf(3)).toBe("");
    expect(tagsOf([1, "a"])).toEqual(["1", "a"]);
    expect(tagsOf("x")).toEqual([]);
  });

  test("a summary counts elements of a list or an object and shows scalars as text", () => {
    expect(valueSummaryOf(null)).toEqual({ kind: "empty" });
    expect(valueSummaryOf([1, 2])).toEqual({ kind: "count", count: 2 });
    expect(valueSummaryOf({ a: 1 })).toEqual({ kind: "count", count: 1 });
    expect(valueSummaryOf("x")).toEqual({ kind: "text", text: "x" });
    expect(valueSummaryOf(true)).toEqual({ kind: "text", text: "true" });
  });
});

describe("scope choices", () => {
  test("a shadowed or managed scope is never a write target", () => {
    expect(writableOf("user")).toBe("user");
    expect(writableOf("launch")).toBe("launch");
    expect(writableOf("managed")).toBeNull();
    expect(writableOf("default")).toBeNull();
  });

  test("the this-conversation check shows only with an open conversation and a launch scope", () => {
    const closed = fieldIn(viewOf([MODEL], [settingOf(MODEL.key, "a/b")], null), MODEL.key);
    const open = fieldIn(viewOf([MODEL], [settingOf(MODEL.key, "a/b")], thr(1)), MODEL.key);
    if (closed === undefined || open === undefined) throw new Error("field must exist");
    expect(launchChoiceOf(closed, false)).toEqual({ shown: false, checked: false });
    expect(launchChoiceOf(open, true)).toEqual({ shown: true, checked: false });
    expect(fallbackScopeOf(open)).toBe("user");
    expect(scopeChoiceShown(open)).toBe(true);
  });

  test("a single writable scope needs no scope choice", () => {
    const only = defOf(
      "l1.models.only",
      "models",
      "text",
      { type: "string" },
      {
        allowedScopes: ["user"],
      },
    );
    const view = viewOf([only], [settingOf(only.key, "a")]);
    const field = fieldIn(view, only.key);
    if (field === undefined) throw new Error("field must exist");
    expect(scopeChoiceShown(field)).toBe(false);
  });
});

describe("page status and drafts", () => {
  test("no controller and no connection is offline, a connected page without a controller is loading", () => {
    expect(pageStatusOf({ live: false, hasController: false, loadStatus: "idle" })).toBe("offline");
    expect(pageStatusOf({ live: true, hasController: false, loadStatus: "idle" })).toBe("loading");
  });

  test("a failed read shows failed, a read that is done shows ready even when offline", () => {
    expect(pageStatusOf({ live: true, hasController: true, loadStatus: "failed" })).toBe("failed");
    expect(pageStatusOf({ live: false, hasController: true, loadStatus: "ready" })).toBe("ready");
    expect(pageStatusOf({ live: true, hasController: true, loadStatus: "loading" })).toBe(
      "loading",
    );
  });

  test("the keys with a draft are listed in screen order", () => {
    const state = stateOf([MODEL, STEPS], [settingOf(MODEL.key, "a/b"), settingOf(STEPS.key, 3)]);
    const edited = reduceSettings(state, { type: "draftEdited", key: STEPS.key, raw: 5 });
    const after = reduceSettings(edited, { type: "draftEdited", key: MODEL.key, raw: "c/d" });
    expect(dirtyKeysOf(settingsViewOf(after).tabs)).toEqual([
      "l1.models.default",
      "l1.loop.maxSteps",
    ]);
  });

  test("a changed value elsewhere is a notice only for a field with a draft", () => {
    const state = stateOf([MODEL], [settingOf(MODEL.key, "a/b")]);
    const edited = reduceSettings(state, { type: "draftEdited", key: MODEL.key, raw: "c/d" });
    const moved = reduceSettings(edited, { type: "invalidated", keys: [MODEL.key] });
    const field = fieldIn(settingsViewOf(moved), MODEL.key);
    if (field === undefined) throw new Error("field must exist");
    expect(remoteNoticeOf(field)).toBe(true);
    const plain = fieldIn(
      settingsViewOf(stateOf([MODEL], [settingOf(MODEL.key, "a/b")])),
      MODEL.key,
    );
    if (plain === undefined) throw new Error("field must exist");
    expect(remoteNoticeOf(plain)).toBe(false);
  });
});

describe("restart count", () => {
  test("counts the values that wait for a restart and is zero without them", () => {
    const restart = defOf(
      "l0.process.port",
      "execution",
      "number",
      { type: "integer" },
      {
        runtimeChange: "restart",
      },
    );
    const pending = viewOf(
      [restart],
      [settingOf(restart.key, 7000, { runtimeChange: "restart", pendingUntil: "restart" })],
    );
    expect(restartCountOf(pending)).toBe(1);
    expect(restartCountOf(viewOf([MODEL], [settingOf(MODEL.key, "a/b")]))).toBe(0);
  });
});

describe("keyboard shortcuts", () => {
  test("command or control with s saves and with f searches, Escape discards, other keys do nothing", () => {
    expect(settingsKeyOf({ key: "s", metaKey: true, ctrlKey: false })).toBe("save");
    expect(settingsKeyOf({ key: "S", metaKey: false, ctrlKey: true })).toBe("save");
    expect(settingsKeyOf({ key: "f", metaKey: true, ctrlKey: false })).toBe("search");
    expect(settingsKeyOf({ key: "Escape", metaKey: false, ctrlKey: false })).toBe("discard");
    expect(settingsKeyOf({ key: "s", metaKey: false, ctrlKey: false })).toBeNull();
    expect(settingsKeyOf({ key: "k", metaKey: true, ctrlKey: false })).toBeNull();
  });
});

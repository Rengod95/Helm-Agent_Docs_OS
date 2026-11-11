import { describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale } from "@fresnel/client/i18n";
import {
  reduceSettings,
  TAB_ORDER,
  settingsViewOf,
  type FieldVM,
  type SettingsView,
} from "@fresnel/client/settings";
import type { SettingScope } from "@fresnel/contracts/settings";
import { thr } from "../state/helpers.ts";
import {
  advancedGroupsOf,
  allFieldsOf,
  budgetsGroupsOf,
  columnLabelOf,
  dirtyKeysOf,
  fallbackScopeOf,
  fieldControlOf,
  fieldMatches,
  hasFooter,
  launchChoiceOf,
  modelsGroupsOf,
  numberDraftActionOf,
  choiceWarningOf,
  DISABLED_ON_SWITCH_CLASS,
  numberValueOf,
  optionHelpOf,
  optionLabelOf,
  optionOf,
  pageStatusOf,
  switchClassOf,
  remoteNoticeOf,
  restartCountOf,
  scopeChoiceShown,
  settingsKeyOf,
  searchGroupsOf,
  selectControlOf,
  shadowedSummaryOf,
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
      "l1.models.thinkingBudgets": "editor",
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

describe("advanced tab groups and option labels", () => {
  test("operator keys are split from the general ones and keep their order", () => {
    const keys = [
      "l1.models.retry",
      "l0.store.heartbeatMs",
      "l1.models.cacheRetention",
      "l0.os.telemetry.endpoint",
    ];
    const defs = keys.map((key, order) =>
      defOf(key, "advanced", "number", { type: "integer" }, {}, { order, label: key }),
    );
    const view = viewOf(
      defs,
      keys.map((key) => settingOf(key, 1)),
    );
    const fields = keys.flatMap((key) => fieldIn(view, key) ?? []);
    const groups = advancedGroupsOf(fields);
    expect(groups.general.map((field) => field.key)).toEqual([
      "l1.models.retry",
      "l1.models.cacheRetention",
    ]);
    expect(groups.operator.map((field) => field.key)).toEqual([
      "l0.store.heartbeatMs",
      "l0.os.telemetry.endpoint",
    ]);
  });

  test("an option label comes from the catalog and falls back to the raw value", () => {
    expect(optionLabelOf("l0.sandbox.onUnavailable", "run_unsandboxed")).toBe("격리 없이 실행");
    expect(optionLabelOf("l0.secrets.ageKey.source", "auto-file")).toBe("자동(파일 우선)");
    expect(optionLabelOf("ext.account-rotation.isolation", "none")).toBe("격리 안 함");
    expect(optionLabelOf("ext.account-rotation.isolation", "process")).toBe("별도 프로세스");
    expect(optionLabelOf("l9.unknown.key", "raw-value")).toBe("raw-value");
  });

  test("the desktop, CLI, and model option labels are Korean sentences", () => {
    expect(optionLabelOf("l4.desktop.window.closeBehavior", "tray")).toBe("트레이에 남기기");
    expect(optionLabelOf("l4.desktop.window.closeBehavior", "quit")).toBe("앱 끝내기");
    expect(optionLabelOf("l4.ui.locale", "auto")).toBe("시스템 설정 따르기");
    expect(optionLabelOf("l4.cli.theme", "dark")).toBe("어둡게");
    expect(optionLabelOf("l4.cli.outputMode", "json")).toBe("JSON");
    expect(optionLabelOf("l1.models.cacheRetention", "long")).toBe("길게");
  });

  test("an English session shows the English option labels", () => {
    const previous = activeLocale();
    setActiveLocale("en");
    try {
      expect(optionLabelOf("l4.desktop.window.closeBehavior", "tray")).toBe("Keep in tray");
      expect(optionLabelOf("l4.ui.locale", "ko")).toBe("한국어");
      expect(optionLabelOf("l4.ui.locale", "en")).toBe("English");
      expect(optionLabelOf("l4.ui.locale", "auto")).toBe("Follow system");
      expect(columnLabelOf("l1.models.retry", "baseDelayMs")).toBe("Base delay (ms)");
    } finally {
      setActiveLocale(previous);
    }
  });
});

describe("option help, warning and locked switch", () => {
  const MODE = "l1.tools.permissionMode";
  const MODES = ["default", "acceptEdits", "plan", "bypass"] as const;

  test("each permission mode has a one-line help in Korean and in English", () => {
    const previous = activeLocale();
    try {
      setActiveLocale("ko");
      expect(MODES.map((mode) => optionHelpOf(MODE, mode))).toEqual([
        "도구 실행과 편집을 매번 물어요.",
        "파일 편집은 묻지 않고, 명령 실행은 물어요.",
        "읽기만 하고 편집·실행은 막아요. 계획을 승인하면 나와요.",
        "명령과 편집을 묻지 않고 실행해요. 믿는 폴더에서만 쓰세요.",
      ]);
      setActiveLocale("en");
      expect(optionHelpOf(MODE, "plan")).toBe(
        "Read only. Edits and commands are blocked. Approving a plan leaves this mode.",
      );
    } finally {
      setActiveLocale(previous);
    }
  });

  test("an option with no catalog help has no help line, and the raw value is never shown", () => {
    expect(optionHelpOf("l9.unknown.key", "raw-value")).toBeNull();
    expect(optionHelpOf(MODE, "no-such-mode")).toBeNull();
  });

  test("only the bypass mode gets the warning line, and it is the bypass help text", () => {
    const previous = activeLocale();
    try {
      setActiveLocale("ko");
      expect(choiceWarningOf(MODE, "bypass")).toBe(
        "명령과 편집을 묻지 않고 실행해요. 믿는 폴더에서만 쓰세요.",
      );
      expect(choiceWarningOf(MODE, "default")).toBeNull();
      expect(choiceWarningOf(MODE, "plan")).toBeNull();
      expect(choiceWarningOf("l4.cli.theme", "bypass")).toBeNull();
    } finally {
      setActiveLocale(previous);
    }
  });

  test("a checked switch that cannot be changed gets the dimmed-on class, the others keep the caustic look", () => {
    expect(switchClassOf(true, true)).toBe(DISABLED_ON_SWITCH_CLASS);
    expect(DISABLED_ON_SWITCH_CLASS).toBe(
      "disabled:data-[state=checked]:bg-accent-solid disabled:opacity-75",
    );
    expect(switchClassOf(true, false)).toBeUndefined();
    expect(switchClassOf(false, true)).toBeUndefined();
    expect(switchClassOf(false, false)).toBeUndefined();
  });
});

/** 키 목록의 항목을 입력 순서대로 모은다. 없는 키는 빠진다 */
function fieldsInOrder(view: SettingsView, keys: readonly string[]): FieldVM[] {
  return keys.flatMap((key) => fieldIn(view, key) ?? []);
}

describe("models and budgets card groups", () => {
  test("the models tab splits basic and routing keys out and keeps the rest in input order", () => {
    const keys = [
      "l1.models.routing.judge",
      "l1.models.allowedModels",
      "l1.models.default",
      "l1.agents.maxDepth",
      "l1.models.groupRouting",
      "l1.models.thinkingLevel",
      "l1.models.routing.review",
      "l1.agents.judge.maxRuns",
      "l1.models.thinkingBudgets",
    ];
    const defs = keys.map((key, order) =>
      defOf(key, "models", "text", { type: "string" }, {}, { order, label: key }),
    );
    const view = viewOf(
      defs,
      keys.map((key) => settingOf(key, "x")),
    );
    const groups = modelsGroupsOf(fieldsInOrder(view, keys));
    expect(groups.basic.map((field) => field.key)).toEqual([
      "l1.models.default",
      "l1.models.thinkingLevel",
      "l1.agents.judge.maxRuns",
    ]);
    expect(groups.routing.map((field) => field.key)).toEqual([
      "l1.models.routing.judge",
      "l1.models.groupRouting",
      "l1.models.routing.review",
    ]);
    expect(groups.rest.map((field) => field.key)).toEqual([
      "l1.models.allowedModels",
      "l1.agents.maxDepth",
      "l1.models.thinkingBudgets",
    ]);
  });

  test("a models tab with only basic keys leaves routing and the rest empty", () => {
    const keys = ["l1.models.default"];
    const defs = keys.map((key, order) =>
      defOf(key, "models", "text", { type: "string" }, {}, { order, label: key }),
    );
    const view = viewOf(
      defs,
      keys.map((key) => settingOf(key, "sonnet")),
    );
    const groups = modelsGroupsOf(fieldsInOrder(view, keys));
    expect(groups.basic.map((field) => field.key)).toEqual(["l1.models.default"]);
    expect(groups.routing).toEqual([]);
    expect(groups.rest).toEqual([]);
  });

  test("the budgets tab puts the rate limit apart and every other key, unknown ones included, in the budget group", () => {
    const keys = ["l1.loop.maxSteps", "l1.models.rateLimit", "l9.not.registered"];
    const defs = keys.map((key, order) =>
      defOf(key, "budgets", "number", { type: "integer" }, {}, { order, label: key }),
    );
    const view = viewOf(
      defs,
      keys.map((key) => settingOf(key, 3)),
    );
    const groups = budgetsGroupsOf(fieldsInOrder(view, keys));
    expect(groups.budget.map((field) => field.key)).toEqual([
      "l1.loop.maxSteps",
      "l9.not.registered",
    ]);
    expect(groups.rateLimit.map((field) => field.key)).toEqual(["l1.models.rateLimit"]);
  });

  test("a budgets tab without a rate limit key leaves the rate limit group empty", () => {
    const keys = ["l1.loop.maxSteps"];
    const defs = keys.map((key, order) =>
      defOf(key, "budgets", "number", { type: "integer" }, {}, { order, label: key }),
    );
    const view = viewOf(
      defs,
      keys.map((key) => settingOf(key, 3)),
    );
    const groups = budgetsGroupsOf(fieldsInOrder(view, keys));
    expect(groups.budget.map((field) => field.key)).toEqual(["l1.loop.maxSteps"]);
    expect(groups.rateLimit).toEqual([]);
  });
});

describe("columnLabelOf", () => {
  test("a table column shows its catalog sentence, and an unknown column shows its name", () => {
    expect(columnLabelOf("l1.models.retry", "maxRetries")).toBe("최대 재시도 횟수");
    expect(columnLabelOf("l1.models.providers", "apiKeyRef")).toBe("API 키(시크릿 참조)");
    expect(columnLabelOf("l1.models.thinkingBudgets", "xhigh")).toBe("아주 높게");
    expect(columnLabelOf("l1.models.retry", "unknownColumn")).toBe("unknownColumn");
    expect(columnLabelOf("l9.unknown.table", "rawColumn")).toBe("rawColumn");
  });
});

describe("numberDraftActionOf", () => {
  const typed = { dirty: true, error: null, value: 6 };
  const cleared = { dirty: false, error: null, value: 6 };
  const idle = { fieldDirty: true, committing: false, escaped: false };
  test("typed text becomes a controller draft so an outside change is seen while editing", () => {
    expect(numberDraftActionOf(typed, { ...idle, fieldDirty: false })).toEqual({
      kind: "edit",
      value: 6,
    });
  });
  test("text that is not a usable value leaves the controller alone", () => {
    const bad = { dirty: true, error: "range", value: null };
    expect(numberDraftActionOf(bad, idle)).toBeNull();
  });
  test("a field that ends its edit saves the draft, Esc drops it", () => {
    expect(numberDraftActionOf(cleared, idle)).toEqual({ kind: "commit" });
    expect(numberDraftActionOf(cleared, { ...idle, escaped: true })).toEqual({ kind: "discard" });
  });
  test("a clean report after the value callback or without a draft does nothing", () => {
    expect(numberDraftActionOf(cleared, { ...idle, committing: true })).toBeNull();
    expect(numberDraftActionOf(cleared, { ...idle, fieldDirty: false })).toBeNull();
  });
});

// 가려진 값 요약(§4.3.4 개정). user=2, project=4, local=6이면 유효 값은 local이고 요약은 강한 범위 순 `프로젝트 4 · 사용자 2`다.
describe("shadowed summary", () => {
  const KEY = "ext.helm.maxLenses";
  const LENSES = defOf(
    KEY,
    "plugins",
    "number",
    { type: "integer" },
    {},
    { order: 1, label: "렌즈" },
  );
  const winner = settingOf(KEY, 6, {
    source: { scope: "local", path: "/work/.fresnel/settings.local.json" },
    shadowed: [
      { scope: "project", path: "/work/.fresnel/settings.json" },
      { scope: "user", path: "/home/user/.fresnel/settings.json" },
    ],
  });

  /** 범위 파일을 읽은 뒤의 화면 항목. 읽은 값은 `scopeFileRead`로 넣는다 */
  function fieldWithFiles(files: ReadonlyArray<readonly [SettingScope, unknown]>): FieldVM {
    let state = stateOf([LENSES], [winner], thr(1));
    for (const [scope, value] of files) {
      state = reduceSettings(state, {
        type: "scopeFileRead",
        scope,
        values: new Map([[KEY, value]]),
      });
    }
    const field = fieldIn(settingsViewOf(state), KEY);
    if (field === undefined) throw new Error("field must exist");
    return field;
  }

  test("the hidden values read as project then user, with the winning local scope not listed", () => {
    const field = fieldWithFiles([
      ["project", 4],
      ["user", 2],
    ]);
    expect(field.scope.scope).toBe("local");
    expect(field.selectedScope).toBe("local");
    expect(shadowedSummaryOf(field)).toBe("프로젝트 4 · 사용자 2");
  });

  test("a secret value is masked, a value that could not be read says so, and no value shows the scope only", () => {
    const TOKEN = "ext.helm.apiToken";
    const token = defOf(TOKEN, "plugins", "secret", { type: "string" }, { secret: true });
    const tokenWinner = settingOf(TOKEN, "secret://helm-token", {
      source: { scope: "local", path: "/work/.fresnel/settings.local.json" },
      shadowed: [{ scope: "project", path: "/work/.fresnel/settings.json" }],
    });
    let state = stateOf([token], [tokenWinner], thr(1));
    state = reduceSettings(state, {
      type: "scopeFileRead",
      scope: "project",
      values: new Map([[TOKEN, "secret://old-token"]]),
    });
    const secretField = fieldIn(settingsViewOf(state), TOKEN);
    if (secretField === undefined) throw new Error("field must exist");
    expect(shadowedSummaryOf(secretField)).toBe("프로젝트 값 가려짐");
    expect(shadowedSummaryOf(fieldWithFiles([]))).toBe(
      "프로젝트 값을 읽지 못했어요 · 사용자 값을 읽지 못했어요",
    );
  });

  test("a field with no hidden scope has an empty summary", () => {
    const alone = settingOf(KEY, 3, { source: { scope: "user" } });
    const field = fieldIn(viewOf([LENSES], [alone]), KEY);
    if (field === undefined) throw new Error("field must exist");
    expect(shadowedSummaryOf(field)).toBe("");
  });

  test("an English session names the scopes in English", () => {
    const previous = activeLocale();
    setActiveLocale("en");
    try {
      const field = fieldWithFiles([
        ["project", 4],
        ["user", 2],
      ]);
      expect(shadowedSummaryOf(field)).toBe("Project 4 · User 2");
    } finally {
      setActiveLocale(previous);
    }
  });
});

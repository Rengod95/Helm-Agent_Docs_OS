import { describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, t } from "@fresnel/client/i18n";
import { reduceSettings, settingsViewOf, type FieldVM } from "@fresnel/client/settings";
import type { EffectiveSetting, SettingDefWire } from "@fresnel/contracts/settings";
import {
  allFieldsOf,
  columnLabelOf,
  dirtyKeysOf,
  fieldControlOf,
  fieldMatches,
  hasFooter,
  numberDraftActionOf,
  choiceWarningOf,
  DISABLED_ON_SWITCH_CLASS,
  numberValueOf,
  optionHelpOf,
  optionLabelOf,
  optionOf,
  overrideWarningOf,
  pageStatusOf,
  resetShownOf,
  switchClassOf,
  remoteNoticeOf,
  restartCountOf,
  settingsKeyOf,
  searchGroupsOf,
  selectControlOf,
  tabStep,
  tabSwitchOf,
  tagsOf,
  textValueOf,
  valueSummaryOf,
  writeScopeOf,
} from "../../src/views/pages/settings/settings-model.ts";
import { defOf, fieldIn, settingOf, stateOf, viewOf } from "./settings-fixtures.ts";
import { SECTION_ORDER } from "../../src/views/pages/settings/settings-sections.ts";

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
const RESUME = defOf(
  "l1.persistence.autoResume",
  "sessions",
  "toggle",
  { type: "boolean" },
  {},
  { order: 1, label: "자동 이어가기" },
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

describe("section order", () => {
  test("moving down or up wraps around the eleven shown sections", () => {
    expect(SECTION_ORDER.length).toBe(11);
    expect(tabStep("overview", SECTION_ORDER, 1)).toBe("providers");
    expect(tabStep("advanced", SECTION_ORDER, 1)).toBe("overview");
    expect(tabStep("overview", SECTION_ORDER, -1)).toBe("advanced");
    expect(tabStep("providers", SECTION_ORDER, -1)).toBe("overview");
  });

  test("a section that is not in the order stays where it is", () => {
    expect(tabStep("providers", ["overview"], 1)).toBe("providers");
  });

  test("choosing the current section stays, a clean form moves, a dirty form asks first", () => {
    expect(tabSwitchOf({ current: "providers", to: "providers", dirtyKeys: ["a"] })).toEqual({
      kind: "stay",
    });
    expect(tabSwitchOf({ current: "providers", to: "connection", dirtyKeys: [] })).toEqual({
      kind: "move",
      to: "connection",
    });
    expect(
      tabSwitchOf({ current: "providers", to: "connection", dirtyKeys: ["l1.models.default"] }),
    ).toEqual({ kind: "ask", to: "connection", keys: ["l1.models.default"] });
  });
});

describe("key search", () => {
  const view = viewOf(
    [MODEL, RESUME, STEPS, THEME],
    [settingOf(MODEL.key, "a/b"), settingOf(RESUME.key, true), settingOf(STEPS.key, 3)],
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

  test("results are grouped by section in section order and empty sections are left out", () => {
    const groups = searchGroupsOf(view, "이어가기");
    expect(groups.map((group) => group.section)).toEqual(["sessions"]);
    expect(groups[0]?.label).toBe(t("desktop.settings.section.sessions"));
    expect(groups[0]?.fields.map((item) => item.key)).toEqual(["l1.persistence.autoResume"]);
    expect(searchGroupsOf(view, "없는말")).toEqual([]);
  });

  test("a key outside the allow list is not found, even by its own label", () => {
    expect(searchGroupsOf(view, "단계")).toEqual([]);
    expect(searchGroupsOf(view, "maxSteps")).toEqual([]);
  });

  test("an empty query lists the fields of every section that has one, in section order", () => {
    const groups = searchGroupsOf(view, "");
    expect(groups.map((group) => group.section)).toEqual(["providers", "sessions"]);
    expect(groups.map((group) => group.fields.map((item) => item.key))).toEqual([
      ["l1.models.default"],
      ["l1.persistence.autoResume"],
    ]);
    expect(allFieldsOf(view).map((item) => item.key)).toEqual([
      "l1.models.default",
      "l1.loop.maxSteps",
      "l1.persistence.autoResume",
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

// 설정은 사용자(전역) 범위에 쓴다. 다른 층이 사용자 값을 덮으면 항목 아래 경고가 그 층 이름과 파일 경로를 준다.
describe("write scope and override warning", () => {
  const PROJECT_PATH = "/work/.fresnel/settings.json";
  const LOCAL_PATH = "/work/.fresnel/settings.local.json";
  const MANAGED_PATH = "/etc/fresnel/managed.json";

  /** 정의 하나와 유효 값 하나(없으면 값 없음)로 만든 항목. 항목이 없으면 시험이 실패한다 */
  function fieldWith(setting: EffectiveSetting | null, def: SettingDefWire = MODEL): FieldVM {
    const field = fieldIn(viewOf([def], setting === null ? [] : [setting]), def.key);
    if (field === undefined) throw new Error("field must exist");
    return field;
  }

  const PROJECT_WINS = settingOf(MODEL.key, "a/b", {
    source: { scope: "project", path: PROJECT_PATH },
  });

  test("a write goes to the user scope while the user scope is writable, whichever layer wins", () => {
    expect(writeScopeOf(fieldWith(settingOf(MODEL.key, "a/b")))).toBe("user");
    expect(writeScopeOf(fieldWith(PROJECT_WINS))).toBe("user");
    expect(writeScopeOf(fieldWith(null))).toBe("user");
  });

  test("a locked field or one without the user scope has no user write scope", () => {
    const locked = settingOf(MODEL.key, "a/b", {
      locked: true,
      lockReason: "managed_file",
      source: { scope: "managed", path: MANAGED_PATH },
    });
    expect(writeScopeOf(fieldWith(locked))).toBeNull();
    const projectOnly = defOf(
      "l1.models.projectOnly",
      "models",
      "text",
      { type: "string" },
      { allowedScopes: ["project"] },
    );
    expect(writeScopeOf(fieldWith(settingOf(projectOnly.key, "a"), projectOnly))).toBeNull();
  });

  test("the reset button shows only for a value the user scope holds", () => {
    expect(resetShownOf(fieldWith(settingOf(MODEL.key, "a/b")))).toBe(true);
    expect(resetShownOf(fieldWith(PROJECT_WINS))).toBe(false);
    expect(resetShownOf(fieldWith(null))).toBe(false);
  });

  test("an override warning names the winning layer and its file, and a user or default value has none", () => {
    expect(overrideWarningOf(fieldWith(null))).toBeNull();
    expect(overrideWarningOf(fieldWith(settingOf(MODEL.key, "a/b")))).toBeNull();
    expect(overrideWarningOf(fieldWith(PROJECT_WINS))).toEqual({
      scopeName: "프로젝트",
      path: PROJECT_PATH,
    });
    const local = settingOf(MODEL.key, "a/b", { source: { scope: "local", path: LOCAL_PATH } });
    expect(overrideWarningOf(fieldWith(local))).toEqual({ scopeName: "로컬", path: LOCAL_PATH });
    const launch = settingOf(MODEL.key, "a/b", { source: { scope: "launch" } });
    expect(overrideWarningOf(fieldWith(launch))).toEqual({ scopeName: "이번 실행", path: null });
    const managed = settingOf(MODEL.key, "a/b", {
      locked: true,
      lockReason: "managed_file",
      source: { scope: "managed", path: MANAGED_PATH },
    });
    expect(overrideWarningOf(fieldWith(managed))).toEqual({
      scopeName: "관리",
      path: MANAGED_PATH,
    });
  });

  test("an English session names the overriding layer in English", () => {
    const previous = activeLocale();
    setActiveLocale("en");
    try {
      expect(overrideWarningOf(fieldWith(PROJECT_WINS))).toEqual({
        scopeName: "Project",
        path: PROJECT_PATH,
      });
    } finally {
      setActiveLocale(previous);
    }
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

describe("option labels", () => {
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

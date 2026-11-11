import { describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, t } from "@fresnel/client/i18n";
import { reduceSettings, settingsViewOf } from "@fresnel/client/settings";
import { thr } from "../state/helpers.ts";
import {
  allFieldsOf,
  columnLabelOf,
  dirtyKeysOf,
  fieldControlOf,
  hasFooter,
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
  settingsKeyOf,
  sectionSwitchOf,
  overrideNoticeOf,
  rowLayoutOf,
  tagsOf,
  textValueOf,
  valueSummaryOf,
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

describe("section switch", () => {
  test("choosing the current section stays, a clean form moves, a dirty form asks first", () => {
    expect(sectionSwitchOf({ current: "models", to: "models", dirtyKeys: ["a"] })).toEqual({
      kind: "stay",
    });
    expect(sectionSwitchOf({ current: "models", to: "sessions", dirtyKeys: [] })).toEqual({
      kind: "move",
      to: "sessions",
    });
    expect(
      sectionSwitchOf({ current: "models", to: "sessions", dirtyKeys: ["l1.models.default"] }),
    ).toEqual({ kind: "ask", to: "sessions", keys: ["l1.models.default"] });
  });

  test("every field of the view is listed in tab and order", () => {
    const view = viewOf(
      [MODEL, STEPS, THEME],
      [settingOf(MODEL.key, "a/b"), settingOf(STEPS.key, 3)],
    );
    expect(allFieldsOf(view).map((item) => item.key)).toEqual([
      "l1.models.default",
      "l1.loop.maxSteps",
      "l4.cli.theme",
    ]);
  });
});

describe("field controls", () => {
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

describe("override notice and row layout", () => {
  test("a value from a work folder file names the file, a value for one conversation says so, the global value has none", () => {
    const user = fieldIn(viewOf([MODEL], [settingOf(MODEL.key, "a/b")]), MODEL.key);
    const project = fieldIn(
      viewOf(
        [MODEL],
        [
          settingOf(MODEL.key, "c/d", {
            source: { scope: "project", path: "/work/proj/.fresnel/settings.json" },
          }),
        ],
        thr(1),
      ),
      MODEL.key,
    );
    const launch = fieldIn(
      viewOf([MODEL], [settingOf(MODEL.key, "e/f", { source: { scope: "launch" } })], thr(1)),
      MODEL.key,
    );
    if (user === undefined || project === undefined || launch === undefined) {
      throw new Error("field must exist");
    }
    expect(overrideNoticeOf(user)).toBeNull();
    expect(overrideNoticeOf(project)).toEqual({
      text: t("desktop.settings.override.folder"),
      path: "/work/proj/.fresnel/settings.json",
    });
    expect(overrideNoticeOf(launch)).toEqual({
      text: t("desktop.settings.override.thread"),
      path: null,
    });
  });

  test("switches, numbers and short text sit on one line, lists and editors take two", () => {
    const field = fieldIn(viewOf([MODEL], [settingOf(MODEL.key, "a/b")]), MODEL.key);
    if (field === undefined) throw new Error("field must exist");
    expect(rowLayoutOf(field, "switch")).toBe("inline");
    expect(rowLayoutOf(field, "number")).toBe("inline");
    expect(rowLayoutOf(field, "text")).toBe("inline");
    expect(rowLayoutOf(field, "tags")).toBe("stacked");
    expect(rowLayoutOf(field, "editor")).toBe("stacked");
    expect(rowLayoutOf(field, "summary")).toBe("stacked");
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

// 가려진 값 요약(§4.3.4 개정). user=2, project=4, local=6이면 유효 값은 local이고 요약은 강한 범위 순 `프로젝트 4 · 사용자 2`다.

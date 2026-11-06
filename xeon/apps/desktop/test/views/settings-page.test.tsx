import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  initialSettingsState,
  reduceSettings,
  settingsViewOf,
  type SettingsView,
} from "@fresnel/client/settings";
import { toSettingDefWire } from "@fresnel/contracts/settings";
import { thr } from "../state/helpers.ts";
import { renderToString } from "react-dom/server";
import { CommandsContext } from "../../src/views/commands.ts";
import { fakeCommands } from "./fake-commands.ts";
import { DESKTOP_SETTING_DEFS } from "../../src/settings-store/defs.ts";
import {
  SettingsPageView,
  type SettingsPageHandlers,
  type SettingsPageProps,
} from "../../src/views/pages/settings/settings-view.tsx";
import { diagnosticToneOf } from "../../src/views/pages/settings/settings-text.ts";
import { defOf, fieldIn, settingOf, stateOf, viewOf } from "./settings-fixtures.ts";

// 설정 화면(P-09)의 서버 렌더. 읽는 중, 실패, 오프라인(읽기 전용), 잠긴 항목의 정책 문장, 필드 오류, 좁은 폭의 탭 선택,
// 시크릿 탭의 자리, 찾기 결과를 그린다. 클릭과 키 입력은 DOM이 없어 시험하지 못한다(뜻은 settings-model.test.ts가 본다).
// 문장은 `t()`로 비교한다.

const NOOP = (): void => {};
const handlers: SettingsPageHandlers = {
  select: NOOP,
  query: NOOP,
  keyIntent: NOOP,
  restart: NOOP,
  retry: NOOP,
  fields: {
    edit: NOOP,
    change: NOOP,
    commit: NOOP,
    discard: NOOP,
    keepDraft: NOOP,
    selectScope: NOOP,
    reset: NOOP,
  },
  promptSave: NOOP,
  promptDiscard: NOOP,
  promptStay: NOOP,
  openFile: NOOP,
};

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
const LOCKED = defOf(
  "l1.models.provider",
  "models",
  "text",
  { type: "string" },
  {},
  { order: 3, label: "제공자 기본값" },
);
const LOCK_PATH = "/etc/fresnel/managed.json";

function propsOf(over: Partial<SettingsPageProps> = {}): SettingsPageProps {
  return {
    status: "ready",
    loadError: "",
    view: null,
    tab: "overview",
    query: "",
    narrow: false,
    readOnly: false,
    hasThread: false,
    saved: new Set(),
    restartError: null,
    prompt: null,
    secretsPanel: <p>SECRETS PANEL</p>,
    fileEditor: null,
    fileOpen: false,
    editors: {},
    toolsPanel: <p>TOOLS PANEL</p>,
    restorePanel: <p>RESTORE PANEL</p>,
    rotationPanel: null,
    usagePanel: null,
    filePaths: [],
    handlers,
    ...over,
  };
}

function html(props: SettingsPageProps): string {
  return renderToString(
    <CommandsContext.Provider value={fakeCommands()}>
      <SettingsPageView {...props} />
    </CommandsContext.Provider>,
  );
}

const SETTINGS = [
  settingOf(MODEL.key, "sonnet"),
  settingOf(STEPS.key, 3),
  settingOf(LOCKED.key, "openai", {
    locked: true,
    lockReason: "managed_file",
    source: { scope: "managed", path: LOCK_PATH },
  }),
];

describe("settings page states", () => {
  test("while the values are read the tab list shows at once and the form shows a loading line", () => {
    const out = html(propsOf({ status: "loading", view: null }));
    expect(out).toContain(t("desktop.settings.loading.status"));
    for (const label of ["개요", "모델", "예산과 한도", "시크릿", "고급"]) {
      expect(out).toContain(label);
    }
  });

  test("a failed read shows the reason and the retry button", () => {
    const reason = t("desktop.settings.loadFailed.unknown");
    const out = html(propsOf({ status: "failed", loadError: reason }));
    expect(out).toContain(reason);
    expect(out).toContain(t("desktop.settings.retry.button"));
    expect(out).not.toContain(t("desktop.settings.loading.status"));
  });

  test("offline with no values says it is not connected and shows no fields", () => {
    const out = html(propsOf({ status: "offline", readOnly: true }));
    expect(out).toContain(t("desktop.settings.offline"));
    expect(out).not.toContain('data-slot="settings-field"');
  });

  test("offline with the last values keeps them visible and turns every input off", () => {
    const view: SettingsView = viewOf([MODEL], [settingOf(MODEL.key, "sonnet")]);
    const out = html(propsOf({ view, tab: "models", readOnly: true }));
    expect(out).toContain(t("desktop.settings.offline"));
    expect(out).toContain("sonnet");
    expect(out).toContain('disabled=""');
  });
});

describe("field rows", () => {
  test("a locked field shows the policy sentence with the policy file path", () => {
    const view = viewOf([MODEL, LOCKED], SETTINGS);
    const out = html(propsOf({ view, tab: "models" }));
    expect(out).toContain(t("client.settings.lock.managedFilePath", { path: LOCK_PATH }));
    expect(out).toContain('aria-disabled="true"');
  });

  test("a field error sits under its field with the message of its kind", () => {
    const view = viewOf([STEPS], SETTINGS);
    const state = reduceSettings(stateOf([STEPS], SETTINGS), {
      type: "writeBlocked",
      key: STEPS.key,
      error: {
        kind: "invalidValue",
        message: t("client.settings.field.invalidRange", { min: 1, max: 20 }),
        issues: [],
      },
    });
    expect(fieldIn(view, STEPS.key)?.error).toBeNull();
    const failed = settingsViewOf(state);
    const out = html(propsOf({ view: failed, tab: "budgets" }));
    expect(out).toContain(t("client.settings.field.invalidRange", { min: 1, max: 20 }));
  });

  test("an out-of-range draft shows the range sentence under the number field", () => {
    const state = reduceSettings(stateOf([STEPS], SETTINGS), {
      type: "draftEdited",
      key: STEPS.key,
      raw: 99,
    });
    const out = html(propsOf({ view: settingsViewOf(state), tab: "budgets" }));
    expect(out).toContain(t("client.settings.field.invalidRange", { min: 1, max: 20 }));
  });

  test("a choice field shows the catalog label of each option, not the raw value", () => {
    const onUnavailable = defOf(
      "l0.sandbox.onUnavailable",
      "permissions",
      "select",
      { type: "string" },
      { range: { enum: ["disable_execute", "ask", "run_unsandboxed"] } },
      { order: 1, label: "When the sandbox is unavailable" },
    );
    const view = viewOf([onUnavailable], [settingOf(onUnavailable.key, "ask")]);
    const out = html(propsOf({ view, tab: "permissions" }));
    expect(out).toContain(t("settings.l0.sandbox.onUnavailable.option.runUnsandboxed"));
    expect(out).toContain(t("settings.l0.sandbox.onUnavailable.option.disableExecute"));
    expect(out).not.toContain(">run_unsandboxed<");
  });

  test("a clean state has no error line for its field", () => {
    const out = html(propsOf({ view: viewOf([STEPS], SETTINGS), tab: "budgets" }));
    expect(out).not.toContain(t("client.settings.field.invalidRange", { min: 1, max: 20 }));
    expect(out).toContain("단계 상한");
  });
});

describe("page layout", () => {
  test("a narrow window shows the tabs as one select, a wide one as a tab list", () => {
    const wide = html(propsOf({ narrow: false }));
    const narrow = html(propsOf({ narrow: true }));
    expect(wide).toContain(`aria-label="${t("desktop.settings.tabs.label")}"`);
    expect(narrow).toContain(`aria-label="${t("desktop.settings.tabs.select")}"`);
    expect(narrow).not.toContain(`aria-label="${t("desktop.settings.tabs.label")}"`);
  });

  test("the secrets tab shows the secrets panel instead of the field list", () => {
    const view = viewOf([MODEL], SETTINGS);
    const out = html(propsOf({ view, tab: "secrets" }));
    expect(out).toContain("SECRETS PANEL");
    expect(out).not.toContain('data-slot="settings-field"');
  });

  test("a search lists the matching fields under their tab, and no match says so", () => {
    const view = viewOf([MODEL, STEPS], SETTINGS);
    const found = html(propsOf({ view, query: "단계" }));
    expect(found).toContain("단계 상한");
    expect(found).not.toContain("기본 모델");
    const none = html(propsOf({ view, query: "없는말" }));
    expect(none).toContain(t("desktop.settings.search.noMatch"));
  });

  test("a restart count shows its banner with the restart button", () => {
    const restart = defOf(
      "l0.process.port",
      "execution",
      "number",
      { type: "integer" },
      {
        runtimeChange: "restart",
      },
    );
    const view = viewOf(
      [restart],
      [settingOf(restart.key, 7000, { runtimeChange: "restart", pendingUntil: "restart" })],
    );
    const out = html(propsOf({ view, tab: "execution" }));
    expect(out).toContain(t("client.settings.view.restartBanner", { count: 1 }));
    expect(out).toContain(t("desktop.settings.restart.button"));
  });
});

describe("notify section", () => {
  // OS 알림 묶음(B-10)은 "실행과 서비스" 탭 맨 위에 보이고, 다른 탭에는 보이지 않는다
  const RESTART_LIMIT = defOf(
    "l0.process.port",
    "execution",
    "number",
    { type: "integer" },
    { runtimeChange: "restart" },
  );

  test("the execution tab shows the notify panel above its fields, and other tabs do not", () => {
    const view = viewOf([RESTART_LIMIT], [settingOf(RESTART_LIMIT.key, 7000)]);
    const panel = <p>NOTIFY PANEL</p>;
    const out = html(propsOf({ view, tab: "execution", notifyPanel: panel }));
    expect(out.indexOf("NOTIFY PANEL")).toBeGreaterThan(-1);
    expect(out.indexOf("NOTIFY PANEL")).toBeLessThan(out.indexOf('data-slot="settings-field"'));
    expect(html(propsOf({ view, tab: "models", notifyPanel: panel }))).not.toContain(
      "NOTIFY PANEL",
    );
  });
});

describe("widget controls", () => {
  const TOGGLE = defOf(
    "l4.cli.on",
    "models",
    "toggle",
    { type: "boolean" },
    {},
    {
      order: 0,
      label: "켜기",
    },
  );
  const EFFORT_OPTIONS = ["low", "high"];
  const EFFORT = defOf(
    "l1.models.effort",
    "models",
    "select",
    { type: "string", enum: EFFORT_OPTIONS },
    { range: { enum: EFFORT_OPTIONS } },
    { order: 2, label: "추론 레벨" },
  );
  const ALLOW = defOf(
    "l1.models.allow",
    "models",
    "list",
    { type: "array", items: { type: "string" } },
    {},
    { order: 3, label: "허용 모델" },
  );
  const BUDGETS = defOf(
    "l1.models.budgets",
    "models",
    "table",
    {
      type: "object",
      properties: { low: { type: "integer" } },
      required: ["low"],
      additionalProperties: false,
    },
    {},
    { order: 4, label: "레벨별 예산" },
  );
  const OLD = defOf(
    "l1.models.old",
    "models",
    "text",
    { type: "string" },
    { deprecated: { since: "0.9.0", replacedBy: MODEL.key } },
    { order: 5, label: "옛 모델" },
  );
  const SETTINGS_ALL = [
    settingOf(TOGGLE.key, true, { shadowed: [{ scope: "project", path: "/p/settings.json" }] }),
    settingOf(EFFORT.key, "low"),
    settingOf(ALLOW.key, ["a"]),
    settingOf(BUDGETS.key, { low: 1 }),
    settingOf(MODEL.key, "sonnet"),
    settingOf(OLD.key, "x"),
  ];
  const DEFS = [TOGGLE, EFFORT, ALLOW, BUDGETS, MODEL, OLD];

  test("each widget kind renders its control, with the scope, shadow, deprecation and launch parts", () => {
    const view = viewOf(DEFS, SETTINGS_ALL, thr(1));
    const out = html(propsOf({ view, tab: "models", hasThread: true }));
    expect(out).toContain('role="switch"');
    expect(out).toContain('role="radio"');
    expect(out).toContain(t("client.settings.scope.user"));
    expect(out).toContain(t("desktop.settings.shadowed.title", { count: 1 }));
    expect(out).toContain(t("desktop.settings.field.itemCount", { count: 1 }));
    expect(out).toContain(t("desktop.settings.field.deprecated", { since: "0.9.0" }));
    expect(out).toContain(t("desktop.settings.field.deprecatedReplaced", { label: "기본 모델" }));
    expect(out).toContain(t("desktop.settings.field.launchOnly"));
    expect(out).toContain(t("desktop.settings.field.scope.label"));
  });

  test("a dirty list field shows the save and discard footer and a changed-elsewhere notice", () => {
    const base = stateOf(DEFS, SETTINGS_ALL, thr(1));
    const edited = reduceSettings(base, { type: "draftEdited", key: ALLOW.key, raw: ["a", "b"] });
    const out = html(propsOf({ view: settingsViewOf(edited), tab: "models", hasThread: true }));
    expect(out).toContain(t("desktop.settings.field.save"));
    expect(out).toContain(t("desktop.settings.field.discard"));
    const moved = reduceSettings(edited, { type: "invalidated", keys: [ALLOW.key] });
    const noticed = html(propsOf({ view: settingsViewOf(moved), tab: "models", hasThread: true }));
    expect(noticed).toContain(t("desktop.settings.field.remoteChanged"));
    expect(noticed).toContain(t("desktop.settings.conflict.label"));
    expect(noticed).toContain(t("desktop.settings.conflict.useNew"));
    expect(noticed).toContain(t("desktop.settings.conflict.keepMine"));
  });
});

/** 글이 그 문장 하나인 단추의 태그 묶음. 없으면 빈 글이다 */
function buttonOf(out: string, label: string): string {
  const buttons = out.match(/<button[\s\S]*?<\/button>/g) ?? [];
  return buttons.find((button) => button.includes(`>${label}<`)) ?? "";
}

describe("file editor entry", () => {
  const label = t("desktop.settings.file.open.button");

  test("a field tab offers the view-as-file button in its header", () => {
    const view = viewOf([MODEL], SETTINGS);
    expect(buttonOf(html(propsOf({ view, tab: "models" })), label)).not.toBe("");
  });

  test("the button is locked offline and while the editor is already open", () => {
    const view = viewOf([MODEL], SETTINGS);
    expect(buttonOf(html(propsOf({ view, tab: "models" })), label)).not.toContain('disabled=""');
    expect(buttonOf(html(propsOf({ view, tab: "models", readOnly: true })), label)).toContain(
      'disabled=""',
    );
    expect(buttonOf(html(propsOf({ view, tab: "models", fileOpen: true })), label)).toContain(
      'disabled=""',
    );
  });

  test("the secrets tab and a search result have no button of their own", () => {
    const view = viewOf([MODEL], SETTINGS);
    expect(html(propsOf({ view, tab: "secrets" }))).not.toContain(label);
    expect(html(propsOf({ view, query: "기본" }))).not.toContain(label);
  });

  test("an open editor is drawn above the field list", () => {
    const view = viewOf([MODEL], SETTINGS);
    const out = html(propsOf({ view, tab: "models", fileEditor: <p>FILE EDITOR</p> }));
    expect(out.indexOf("FILE EDITOR")).toBeGreaterThan(-1);
    expect(out.indexOf("FILE EDITOR")).toBeLessThan(out.indexOf('data-slot="settings-field"'));
  });
});

/** 항목 하나의 HTML 조각. 줄마다 `data-slot="settings-field"`로 시작하므로 다음 줄 전까지다 */
function rowOf(out: string, key: string): string {
  const start = out.indexOf(`data-key="${key}"`);
  if (start < 0) return "";
  const next = out.indexOf('data-slot="settings-field"', start + 1);
  return out.slice(start, next < 0 ? undefined : next);
}

describe("offline with desktop settings (L4.settings-ui §4.1.3)", () => {
  // 엔진은 없고, 엔진 모델 항목은 마지막으로 읽은 값이 있다. 데스크톱 항목은 엔진 없이 바꿀 수 있다
  const CLOSE_KEY = "l4.desktop.window.closeBehavior";
  const desktopDefs = DESKTOP_SETTING_DEFS.map(toSettingDefWire);
  const offlineView = (): SettingsView => {
    let state = reduceSettings(initialSettingsState, {
      type: "catalogLoaded",
      origin: "engine",
      defs: [MODEL],
    });
    state = reduceSettings(state, { type: "catalogLoaded", origin: "desktop", defs: desktopDefs });
    state = reduceSettings(state, { type: "engineStateChanged", offline: true });
    state = reduceSettings(state, {
      type: "valuesLoaded",
      settings: [
        settingOf(MODEL.key, "sonnet"),
        settingOf(CLOSE_KEY, "quit", { source: { scope: "default" } }),
      ],
    });
    return settingsViewOf(state);
  };

  test("an appearance field stays editable offline, and the engine field is read-only with the sentence", () => {
    const view = offlineView();
    const label = fieldIn(view, CLOSE_KEY)?.label ?? "";
    expect(label).toBe("창 닫기 동작");

    const appearance = html(propsOf({ view, tab: "appearance", readOnly: true }));
    expect(appearance).toContain(t("desktop.settings.offline"));
    expect(rowOf(appearance, CLOSE_KEY)).toContain(label);
    expect(rowOf(appearance, CLOSE_KEY)).not.toContain('disabled=""');
    expect(rowOf(appearance, CLOSE_KEY)).not.toContain(t("client.settings.origin.engineOffline"));

    const models = html(propsOf({ view, tab: "models", readOnly: true }));
    expect(rowOf(models, MODEL.key)).toContain(MODEL.ui?.label ?? "");
    expect(rowOf(models, MODEL.key)).toContain('disabled=""');
    expect(rowOf(models, MODEL.key)).toContain(t("client.settings.origin.engineOffline"));
  });
});

describe("restore section", () => {
  test("the advanced tab shows the restore panel, and the other tabs do not", () => {
    const view = viewOf([MODEL], SETTINGS);
    expect(html(propsOf({ view, tab: "advanced" }))).toContain("RESTORE PANEL");
    expect(html(propsOf({ view, tab: "models" }))).not.toContain("RESTORE PANEL");
  });

  test("a search lists fields instead, so the panel hides", () => {
    const view = viewOf([MODEL], SETTINGS);
    expect(html(propsOf({ view, tab: "advanced", query: "기본" }))).not.toContain("RESTORE PANEL");
  });
});

describe("update line section", () => {
  test("the update line sits on the overview tab only, and a search hides it", () => {
    const view = viewOf([MODEL], SETTINGS);
    const line = <p>UPDATE LINE</p>;
    expect(html(propsOf({ view, tab: "overview", updatePanel: line }))).toContain("UPDATE LINE");
    expect(html(propsOf({ view, tab: "models", updatePanel: line }))).not.toContain("UPDATE LINE");
    expect(
      html(propsOf({ view, tab: "overview", query: "기본", updatePanel: line })),
    ).not.toContain("UPDATE LINE");
  });
});

describe("overview tab sections", () => {
  const view = viewOf([MODEL, STEPS, LOCKED], SETTINGS);

  test("shows one 지금 상태 card of term rows with counts and no old summary sentences", () => {
    const out = html(propsOf({ view, tab: "overview" }));
    expect(out).toContain(t("desktop.settings.overview.state"));
    for (const label of [
      t("desktop.settings.overview.changed"),
      t("desktop.settings.overview.locked"),
      t("desktop.settings.overview.pendingRestart"),
      t("desktop.settings.overview.pendingNextTurn"),
      t("desktop.settings.overview.deprecated"),
    ]) {
      expect(out).toContain(label);
    }
    expect(out).not.toContain("요약할 설정이 아직 없어요");
    // 사용자 값 2개 + 관리 정책 값 1개 = 바꾼 항목 3개, 잠긴 항목 1개, 나머지 셋은 0개
    expect(out).toContain(">3개<");
    expect(out).toContain(">1개<");
    expect(out.match(/>0개</g)?.length).toBe(3);
  });

  test("draws the 정보와 진단 card with versions and the copy button, and no log button on the web", () => {
    const out = html(propsOf({ view, tab: "overview" }));
    expect(out).toContain(t("desktop.settings.about.title"));
    expect(out).toContain(t("desktop.settings.about.appVersion"));
    expect(out).toContain("0.0.0-test");
    expect(out).toContain(t("desktop.settings.about.engineUnknown"));
    expect(out).toContain(t("desktop.settings.overview.copyDiagnostics"));
    expect(out).not.toContain(t("desktop.settings.about.openLogs"));
  });

  test("draws the 설정 파일 card with the user, project and managed paths, and none when no path was read", () => {
    const withPaths = html(
      propsOf({
        view,
        tab: "overview",
        filePaths: [
          { scope: "user", path: "/home/me/.fresnel/settings.json" },
          { scope: "project", path: "/repo/.fresnel/settings.json" },
          { scope: "managed", path: "/etc/fresnel/managed.json" },
        ],
      }),
    );
    expect(withPaths).toContain(t("desktop.settings.overview.files.title"));
    expect(withPaths).toContain("~/.fresnel/settings.json");
    expect(withPaths).not.toContain("/home/me");
    expect(withPaths).toContain("/repo/.fresnel/settings.json");
    expect(withPaths).toContain("/etc/fresnel/managed.json");
    expect(withPaths).toContain(t("desktop.settings.overview.files.managed"));
    expect(html(propsOf({ view, tab: "overview" }))).not.toContain(
      t("desktop.settings.overview.files.title"),
    );
  });

  test("the first card sits at the top of the column when no notice is shown, and a notice goes above it", () => {
    const plain = html(
      propsOf({
        view,
        tab: "overview",
        filePaths: [{ scope: "user", path: "/home/me/.fresnel/settings.json" }],
      }),
    );
    // 알림 칸이 없으면 첫 카드가 내용 칸의 첫 자식이다(`first:pt-0`이 걸린다)
    expect(plain).toMatch(/py-12"><section/);
    const offline = html(
      propsOf({
        view,
        tab: "overview",
        readOnly: true,
        filePaths: [{ scope: "user", path: "/home/me/.fresnel/settings.json" }],
      }),
    );
    expect(offline).toContain(t("desktop.settings.offline"));
    expect(offline).not.toMatch(/py-12"><section/);
  });

  test("every section title renders at the mockup's 16px title-2 ink (its unlayered h2 rule beats text-ui-sm)", () => {
    const out = html(propsOf({ view, tab: "overview" }));
    const headingClasses = [...out.matchAll(/<h2 id="[^"]*" class="([^"]*)"/g)].map(
      (match) => match[1] ?? "",
    );
    expect(headingClasses.length).toBeGreaterThan(0);
    expect(new Set(headingClasses)).toEqual(new Set(["m-0 flex-1 text-title-2 text-text-primary"]));
  });
});

describe("화면 진단 card tones", () => {
  // 값 모양이 맞지 않는 항목(number 위젯에 boolean 값)과 값이 없는 항목을 함께 둔다
  const MISMATCH = defOf(
    "l1.models.flag",
    "models",
    "number",
    { type: "boolean" },
    {},
    { order: 1, label: "플래그" },
  );
  const MISSING = defOf(
    "l1.budgets.cap",
    "budgets",
    "number",
    { type: "integer" },
    {},
    { order: 2, label: "상한" },
  );
  const view = viewOf([MISMATCH, MISSING], [settingOf(MISMATCH.key, true)]);

  test("a widgetMismatch row is drawn in the danger tone and a missingValue row in the warning tone", () => {
    expect(view.diagnostics.map((diagnostic) => diagnostic.code).toSorted()).toEqual([
      "missingValue",
      "widgetMismatch",
    ]);
    const out = html(propsOf({ view, tab: "overview" }));
    const rows = out.match(/<li class="[^"]*">[\s\S]*?<\/li>/g) ?? [];
    const mismatchRow =
      rows.find((row) => row.includes(t("desktop.settings.diagnostic.widgetMismatch"))) ?? "";
    const missingRow =
      rows.find((row) => row.includes(t("desktop.settings.diagnostic.missingValue"))) ?? "";
    expect(mismatchRow).toContain("text-danger-text");
    expect(mismatchRow).not.toContain("text-warning-text");
    expect(missingRow).toContain("text-warning-text");
    expect(missingRow).not.toContain("text-danger-text");
  });

  test("each diagnostic code has exactly one tone", () => {
    expect({
      widgetMismatch: diagnosticToneOf("widgetMismatch"),
      unknownWidget: diagnosticToneOf("unknownWidget"),
      unknownTab: diagnosticToneOf("unknownTab"),
      missingValue: diagnosticToneOf("missingValue"),
      duplicateKey: diagnosticToneOf("duplicateKey"),
    }).toEqual({
      widgetMismatch: "danger",
      unknownWidget: "info",
      unknownTab: "info",
      missingValue: "warning",
      duplicateKey: "warning",
    });
  });
});

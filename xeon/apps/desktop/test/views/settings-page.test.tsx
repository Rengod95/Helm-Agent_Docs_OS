import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  initialSettingsState,
  reduceSettings,
  settingsViewOf,
  type SettingsView,
} from "@fresnel/client/settings";
import type { MemoryStoreView } from "@fresnel/contracts/capabilities";
import { toSettingDefWire } from "@fresnel/contracts/settings";
import { harness, thr } from "../state/helpers.ts";
import { renderToString } from "react-dom/server";
import { createUiStore } from "../../src/state/ui/index.ts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { Providers } from "../../src/views/providers.tsx";
import { fakeCommands } from "./fake-commands.ts";
import { DESKTOP_SETTING_DEFS } from "../../src/settings-store/defs.ts";
import {
  SettingsPageView,
  type SettingsPageHandlers,
  type SettingsPageProps,
} from "../../src/views/pages/settings/settings-view.tsx";
import { MemoryFindView } from "../../src/views/pages/settings/settings-memory-view.tsx";
import { matchesQuery } from "../../src/views/pages/settings/settings-memory-model.ts";
import { defOf, settingOf, stateOf, viewOf } from "./settings-fixtures.ts";
import { ENTRY_TEXTS, memoryPropsOf, storeOf } from "./memory-fixtures.ts";

// 설정 화면(P-09)의 서버 렌더. 읽는 중, 실패, 오프라인(읽기 전용), 구역 목록, 범위 UI가 없는 항목 줄, 다른 층이 덮은 값의 경고,
// 단위 숫자 칸, 화면에서 뺀 키, 연결 구역, 찾기 결과를 그린다. 클릭과 키 입력은 DOM이 없어 시험하지 못한다(뜻은 settings-model.test.ts가 본다).
// 문장은 `t()`로 비교한다.

const NOOP = (): void => {};
const handlers: SettingsPageHandlers = {
  select: NOOP,
  query: NOOP,
  keyIntent: NOOP,
  retry: NOOP,
  fields: {
    edit: NOOP,
    change: NOOP,
    commit: NOOP,
    discard: NOOP,
    keepDraft: NOOP,
    reset: NOOP,
  },
  promptSave: NOOP,
  promptDiscard: NOOP,
  promptStay: NOOP,
  openFile: NOOP,
};

/**
 * 일반 항목 줄로 그리는 글 칸. 모델·계정·권한 구역은 전용 패널만 그리므로(DP-83·84·109) 세션 구역의 항목을 빌려 쓴다.
 * 이름과 도움말은 시험용이다
 */
const MODEL = defOf(
  "l2.knowledge.write.approval",
  "sessions",
  "text",
  { type: "string" },
  {},
  { order: 1, label: "기본 모델", help: "요청에 쓸 기본 모델" },
);
/** 화면에서 뺀 예산 키(L4.settings-ui §4.2 [결정: 2026-11-11 사용자]). 엔진에는 남아 있다 */
const STEPS = defOf(
  "l1.loop.maxSteps",
  "budgets",
  "number",
  { type: "integer" },
  { range: { min: 1, max: 20 } },
  { order: 2, label: "단계 상한" },
);
/** 권한 구역의 초 단위 숫자. 구역에서는 패널이 그리므로 찾기 결과의 항목 줄로 본다. 단위 칸으로 그린다 */
const TIMEOUT = defOf(
  "l1.tools.unattended.timeoutSeconds",
  "permissions",
  "number",
  { type: "integer" },
  { range: { min: 1, max: 86400 } },
  { order: 3, label: "무인 승인 대기" },
);

function propsOf(over: Partial<SettingsPageProps> = {}): SettingsPageProps {
  return {
    status: "ready",
    loadError: "",
    view: null,
    section: "sessions",
    query: "",
    narrow: false,
    readOnly: false,
    saved: new Set(),
    restartError: null,
    prompt: null,
    fileEditor: null,
    fileOpen: false,
    editors: {},
    panels: {
      secrets: <p>SECRETS PANEL</p>,
      connection: <p>CONNECTION PANEL</p>,
      backup: <p>BACKUP PANEL</p>,
    },
    banners: <p>BANNERS</p>,
    handlers,
    ...over,
  };
}

function html(props: SettingsPageProps): string {
  const h = harness();
  h.store.ingest({ type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } });
  h.store.flush();
  const state = h.store.read.getState();
  const engine = {
    getState: () => state,
    getInitialState: () => state,
    subscribe: () => () => undefined,
  };
  return renderToString(
    <Providers engine={engine} ui={createUiStore().read} commands={fakeCommands()}>
      <ShellStoreContext value={createShellStore(1280)}>
        <SettingsPageView {...props} />
      </ShellStoreContext>
    </Providers>,
  );
}

const SETTINGS = [
  settingOf(MODEL.key, "sonnet"),
  settingOf(STEPS.key, 3),
  settingOf(TIMEOUT.key, 600),
];

/**
 * 설정 찾기 화면. `read`가 null이면 기억을 아직 읽는 중이다. 화면이 하는 것과 같이 `matchesQuery`로 기억 구역을 고르고,
 * 맞으면 찾는 글이 든 글만 그린다
 */
function memorySearchOf(query: string, read: readonly MemoryStoreView[] | null): string {
  const view = viewOf([MODEL, STEPS, TIMEOUT], SETTINGS);
  return html(
    propsOf({
      view,
      query,
      memoryMatches: (text) =>
        matchesQuery(text, { label: t("desktop.memory.label"), stores: read }),
      memoryFindPanel: (
        <MemoryFindView
          props={memoryPropsOf({
            load: read === null ? { kind: "loading" } : { kind: "ready", stores: read },
          })}
          query={query}
        />
      ),
    }),
  );
}

/** 글이 그 문장 하나인 단추의 태그 묶음. 없으면 빈 글이다 */
function buttonOf(out: string, label: string): string {
  const buttons = out.match(/<button[\s\S]*?<\/button>/g) ?? [];
  return buttons.find((button) => button.includes(`>${label}<`)) ?? "";
}

/** 항목 하나의 HTML 조각. 줄마다 `data-slot="settings-field"`로 시작하므로 다음 줄 전까지다 */
function rowOf(out: string, key: string): string {
  const start = out.indexOf(`data-key="${key}"`);
  if (start < 0) return "";
  const next = out.indexOf('data-slot="settings-field"', start + 1);
  return out.slice(start, next < 0 ? undefined : next);
}

describe("settings page states", () => {
  test("while the values are read the section list shows at once and the form shows a loading line", () => {
    const out = html(propsOf({ status: "loading", view: null }));
    expect(out).toContain(t("desktop.settings.loading.status"));
    for (const id of ["general", "models", "secrets", "connection", "data"] as const) {
      expect(out).toContain(t(`desktop.settings.section.${id}`));
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
    const out = html(propsOf({ view, readOnly: true }));
    expect(out).toContain(t("desktop.settings.offline"));
    expect(out).toContain("sonnet");
    expect(out).toContain('disabled=""');
  });
});

describe("section list", () => {
  test("the three group headings come in order, each before its sections", () => {
    const out = html(propsOf({ view: viewOf([MODEL], SETTINGS) }));
    const at = (id: Parameters<typeof t>[0]): number => out.indexOf(`>${t(id)}<`);
    expect(at("desktop.settings.group.app")).toBeLessThan(at("desktop.settings.section.general"));
    expect(at("desktop.settings.section.notifications")).toBeLessThan(
      at("desktop.settings.group.agent"),
    );
    expect(at("desktop.settings.group.agent")).toBeLessThan(at("desktop.settings.section.models"));
    expect(at("desktop.settings.section.sessions")).toBeLessThan(
      at("desktop.settings.group.engine"),
    );
    expect(at("desktop.settings.group.engine")).toBeLessThan(
      at("desktop.settings.section.connection"),
    );
  });

  test("a narrow window shows the sections as one select instead of the list", () => {
    const narrow = html(propsOf({ view: viewOf([MODEL], SETTINGS), narrow: true }));
    expect(narrow).toContain(`aria-label="${t("desktop.settings.tabs.select")}"`);
  });
});

describe("field rows have no scope choice", () => {
  test("a row offers no scope menu and no this-conversation check", () => {
    const out = html(propsOf({ view: viewOf([MODEL], SETTINGS) }));
    const row = rowOf(out, MODEL.key);
    expect(row).toContain("기본 모델");
    // 범위 메뉴(옛 `settings-scope` 단추)와 "이번 대화에만" 확인 상자가 없다
    expect(row).not.toContain("이번 대화에만");
    expect(row).not.toContain('type="checkbox"');
    expect(row).not.toContain('data-slot="settings-override"');
  });

  test("a value from a work folder file shows the warning with that file", () => {
    const path = "/work/proj/.fresnel/settings.json";
    const view = viewOf(
      [MODEL],
      [settingOf(MODEL.key, "haiku", { source: { scope: "project", path } })],
      thr(1),
    );
    const row = rowOf(html(propsOf({ view })), MODEL.key);
    expect(row).toContain('data-slot="settings-override"');
    expect(row).toContain(t("desktop.settings.override.folder"));
    expect(row).toContain(path);
  });

  test("a locked field shows the policy sentence with the policy file path", () => {
    const lockPath = "/etc/fresnel/managed.json";
    const view = viewOf(
      [MODEL],
      [
        settingOf(MODEL.key, "openai", {
          locked: true,
          lockReason: "managed_file",
          source: { scope: "managed", path: lockPath },
        }),
      ],
    );
    const out = html(propsOf({ view }));
    expect(out).toContain(t("client.settings.lock.managedFilePath", { path: lockPath }));
    expect(out).toContain('aria-disabled="true"');
  });

  test("a managed-only setting with no managed value shows who can change it, and its row is disabled", () => {
    const managedOnly = defOf(
      "l2.mcp.managedOnly",
      "tools",
      "toggle",
      { type: "boolean" },
      { allowedScopes: ["managed"] },
      { order: 1, label: "관리 서버만 허용" },
    );
    const view = viewOf(
      [managedOnly],
      [settingOf(managedOnly.key, false, { source: { scope: "default" } })],
    );
    const row = rowOf(html(propsOf({ view, query: "관리 서버만" })), managedOnly.key);
    expect(row).toContain("관리자 설정에서만 바꿀 수 있어요");
    expect(row).toContain('aria-disabled="true"');
  });

  test("a field error sits under its field with the message of its kind", () => {
    const state = reduceSettings(stateOf([MODEL], SETTINGS), {
      type: "writeBlocked",
      key: MODEL.key,
      error: { kind: "invalidValue", message: "모델 이름이 맞지 않아요", issues: [] },
    });
    const out = html(propsOf({ view: settingsViewOf(state) }));
    expect(rowOf(out, MODEL.key)).toContain("모델 이름이 맞지 않아요");
  });
});

describe("removed keys and unit numbers", () => {
  test("a budget key the engine still has is not drawn in any section or found by search", () => {
    const view = viewOf([MODEL, STEPS, TIMEOUT], SETTINGS);
    for (const section of ["models", "permissions", "execution", "sessions"] as const) {
      expect(html(propsOf({ view, section }))).not.toContain('data-key="l1.loop.maxSteps"');
    }
    expect(html(propsOf({ view, query: "단계 상한" }))).toContain(
      t("desktop.settings.search.noMatch"),
    );
  });

  test("a seconds value shows in the largest whole unit with its suffix and no plus or minus buttons", () => {
    const view = viewOf([TIMEOUT], SETTINGS);
    const row = rowOf(html(propsOf({ view, query: "무인 승인 대기" })), TIMEOUT.key);
    expect(row).toContain('value="10"');
    expect(row).toContain(`>${t("desktop.settings.unit.minutes")}<`);
    expect(row).not.toContain('data-slot="number-field-increment"');
  });
});

describe("permission mode field", () => {
  const MODES = ["default", "acceptEdits", "plan", "bypass"] as const;
  const PERMISSION_MODE = defOf(
    "l1.tools.permissionMode",
    "permissions",
    "select",
    { type: "string", enum: [...MODES] },
    { range: { enum: [...MODES] } },
    { order: 10, label: "권한 모드" },
  );

  test("every mode shows its one-line description, and the bypass mode also shows the warning line", () => {
    // 권한 구역은 실행 방식 카드 패널이 그린다. 찾기 결과에서는 항목 줄로 그린다
    const view = viewOf([PERMISSION_MODE], [settingOf(PERMISSION_MODE.key, "bypass")]);
    const out = html(propsOf({ view, query: "권한 모드" }));
    for (const mode of MODES) {
      expect(out).toContain(t(`settings.l1.tools.permissionMode.optionHelp.${mode}`));
    }
    const warning = out.match(
      /data-slot="settings-choice-warning"[^>]*>.*?<span class="min-w-0">([^<]*)<\/span>/,
    );
    expect(warning?.[1]).toBe(t("settings.l1.tools.permissionMode.optionHelp.bypass"));
  });

  test("a mode that is not bypass shows no warning line", () => {
    const view = viewOf([PERMISSION_MODE], [settingOf(PERMISSION_MODE.key, "default")]);
    const out = html(propsOf({ view, query: "권한 모드" }));
    expect(out).not.toContain('data-slot="settings-choice-warning"');
  });
});

describe("panels and the file button", () => {
  const label = t("desktop.settings.file.open.button");

  test("the connection section shows the banners and the connection panel even with no values", () => {
    const out = html(propsOf({ status: "offline", view: null, section: "connection" }));
    expect(out).toContain("CONNECTION PANEL");
    expect(out).toContain("BANNERS");
    expect(buttonOf(out, label)).toBe("");
  });

  test("the secrets section shows its panel and no file button, a field section has the button", () => {
    const view = viewOf([MODEL], SETTINGS);
    const secrets = html(propsOf({ view, section: "secrets" }));
    expect(secrets).toContain("SECRETS PANEL");
    expect(buttonOf(secrets, label)).toBe("");
    expect(buttonOf(html(propsOf({ view })), label)).not.toBe("");
  });

  test("the file button is locked offline and while the editor is open", () => {
    const view = viewOf([MODEL], SETTINGS);
    expect(buttonOf(html(propsOf({ view, readOnly: true })), label)).toContain('disabled=""');
    expect(buttonOf(html(propsOf({ view, fileOpen: true })), label)).toContain('disabled=""');
  });

  test("the data section draws the backup panel, other sections do not", () => {
    const view = viewOf([MODEL], SETTINGS);
    expect(html(propsOf({ view, section: "data" }))).toContain("BACKUP PANEL");
    expect(html(propsOf({ view }))).not.toContain("BACKUP PANEL");
  });
});

describe("search", () => {
  test("a search lists the matching fields under their section, and no match says so", () => {
    const view = viewOf([MODEL, STEPS, TIMEOUT], SETTINGS);
    const found = html(propsOf({ view, query: "기본 모델" }));
    expect(found).toContain(t("desktop.settings.section.sessions"));
    expect(found).toContain('data-key="l2.knowledge.write.approval"');
    expect(found).not.toContain('data-key="l1.tools.unattended.timeoutSeconds"');
    expect(html(propsOf({ view, query: "없는말" }))).toContain(
      t("desktop.settings.search.noMatch"),
    );
  });

  test("a section name finds that section in the sections group, without a 0-field count line (DP-86)", () => {
    const view = viewOf([MODEL, STEPS, TIMEOUT], SETTINGS);
    const out = html(propsOf({ view, query: "알림" }));
    expect(out).not.toContain(t("desktop.settings.search.noMatch"));
    expect(out).toContain(`>${t("desktop.settings.search.sections")}<`);
    expect(out).toContain(`>${t("desktop.settings.section.notifications")}<`);
    expect(out).toContain(`>${t("desktop.settings.search.openSection")}<`);
    expect(out).not.toContain('data-slot="settings-search-count"');
  });

  const READ = [storeOf("user", ENTRY_TEXTS), storeOf("env", [])];

  test("a search for a word in a memory entry shows the memory group with that entry", () => {
    const out = memorySearchOf("배포", READ);
    expect(out).toContain('data-slot="settings-memory"');
    expect(out.match(/data-memory-entry=/g)).toHaveLength(1);
    expect(out).not.toContain(t("desktop.settings.search.noMatch"));
  });

  test("a search that matches neither a setting nor a memory says no match", () => {
    const out = memorySearchOf("zzzz", READ);
    expect(out).toContain(t("desktop.settings.search.noMatch"));
    expect(out).not.toContain('data-slot="settings-memory"');
  });

  test("while the memory is still loading it counts as not matching", () => {
    const out = memorySearchOf("배포", null);
    expect(out).toContain(t("desktop.settings.search.noMatch"));
  });
});

describe("offline with desktop settings (L4.settings-ui §4.1.3)", () => {
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

  test("a desktop field stays editable offline, and the engine field is read-only with the sentence", () => {
    const view = offlineView();
    const general = html(propsOf({ view, section: "general", readOnly: true }));
    expect(rowOf(general, CLOSE_KEY)).toContain("창 닫기 동작");
    expect(rowOf(general, CLOSE_KEY)).not.toContain('disabled=""');
    const models = html(propsOf({ view, readOnly: true }));
    expect(rowOf(models, MODEL.key)).toContain('disabled=""');
    expect(rowOf(models, MODEL.key)).toContain(t("client.settings.origin.engineOffline"));
  });
});

describe("plugins section folded groups (DP-93)", () => {
  const TRACE = defOf(
    "x.operations.trace.enabled",
    "plugins",
    "toggle",
    { type: "boolean" },
    {},
    { order: 1, label: "실행 기록" },
  );
  const view = viewOf([TRACE], [settingOf(TRACE.key, false)]);

  test("the developer group starts as a closed header with its count, and a jump to its key opens it", () => {
    const closed = html(propsOf({ view, section: "plugins" }));
    expect(closed).toContain(t("desktop.settings.part.developer"));
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain(`data-key="${TRACE.key}"`);
    const revealed = html(propsOf({ view, section: "plugins", revealKey: TRACE.key }));
    expect(revealed).toContain('aria-expanded="true"');
    expect(revealed).toContain(`data-key="${TRACE.key}"`);
  });
});

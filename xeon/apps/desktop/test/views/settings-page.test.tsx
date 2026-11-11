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
import { HostNoticesContext } from "../../src/views/host-notices-context.ts";
import { fakeCommands } from "./fake-commands.ts";
import { DESKTOP_SETTING_DEFS } from "../../src/settings-store/defs.ts";
import {
  SettingsPageView,
  type SettingsPageHandlers,
  type SettingsPageProps,
} from "../../src/views/pages/settings/settings-view.tsx";
import { diagnosticToneOf } from "../../src/views/pages/settings/settings-text.ts";
import { MemoryFindView } from "../../src/views/pages/settings/settings-memory-view.tsx";
import { matchesQuery } from "../../src/views/pages/settings/settings-memory-model.ts";
import { defOf, fieldIn, settingOf, stateOf, viewOf } from "./settings-fixtures.ts";
import { ENTRY_TEXTS, memoryPropsOf, storeOf } from "./memory-fixtures.ts";

// 설정 화면(P-09)의 서버 렌더. 읽는 중, 실패, 오프라인(읽기 전용), 잠긴 항목의 정책 문장, 필드 오류, 좁은 폭의 탭 선택,
// 시크릿 탭의 자리, 찾기 결과를 그린다. 클릭과 키 입력은 DOM이 없어 시험하지 못한다(뜻은 settings-model.test.ts가 본다).
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

const MODEL = defOf(
  "l1.models.default",
  "models",
  "text",
  { type: "string" },
  {},
  { order: 1, label: "기본 모델", help: "요청에 쓸 기본 모델" },
);
const KEEP = defOf(
  "l1.persistence.retention.maxCount",
  "sessions",
  "number",
  { type: "integer" },
  { range: { min: 1, max: 20 } },
  { order: 2, label: "보관 개수" },
);
const LOCKED = defOf(
  "l1.models.providers",
  "providers",
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

/** 설정 파일 카드의 줄을 용어, 값, 고정폭 여부, 복사 단추 유무로 뽑는다. 카드는 제목 자리의 aria-label부터 정보와 진단 카드 전까지다 */
function fileRowsOf(out: string): readonly FileRowView[] {
  const from = out.indexOf(`aria-label="${t("desktop.settings.overview.files.title")}"`);
  const to = out.indexOf(`aria-label="${t("desktop.settings.about.title")}"`, from);
  const card = out.slice(from, to);
  return card
    .split('data-slot="list-description-row"')
    .slice(1)
    .map((row) => ({
      term: row.match(/data-slot="list-description-term"[^>]*>([^<]*)</)?.[1] ?? "",
      value: row.match(/data-slot="list-description-value-text"[^>]*>([^<]*)</)?.[1] ?? "",
      mono: row.includes('data-mono="true"'),
      copy: row.includes('aria-label="Copy '),
    }));
}

interface FileRowView {
  readonly term: string;
  readonly value: string;
  readonly mono: boolean;
  readonly copy: boolean;
}

const SETTINGS = [
  settingOf(MODEL.key, "sonnet"),
  settingOf(KEEP.key, 3),
  settingOf(LOCKED.key, "openai", {
    locked: true,
    lockReason: "managed_file",
    source: { scope: "managed", path: LOCK_PATH },
  }),
];

/**
 * 설정 찾기 화면. `read`가 null이면 기억을 아직 읽는 중이다. 화면이 하는 것과 같이 `matchesQuery`로 기억 구역을 고르고,
 * 맞으면 찾는 글이 든 글만 그린다
 */
function memorySearchOf(query: string, read: readonly MemoryStoreView[] | null): string {
  const view = viewOf([MODEL, KEEP], SETTINGS);
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

describe("settings page states", () => {
  test("while the values are read the tab list shows at once and the form shows a loading line", () => {
    const out = html(propsOf({ status: "loading", view: null }));
    expect(out).toContain(t("desktop.settings.loading.status"));
    for (const label of ["개요", "모델과 계정", "시크릿", "백업과 고급"]) {
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
    const out = html(propsOf({ view, tab: "providers", readOnly: true }));
    expect(out).toContain(t("desktop.settings.offline"));
    expect(out).toContain("sonnet");
    expect(out).toContain('disabled=""');
  });
});

describe("field rows", () => {
  test("a locked field shows the policy sentence with the policy file path", () => {
    const view = viewOf([MODEL, LOCKED], SETTINGS);
    const out = html(propsOf({ view, tab: "providers" }));
    expect(out).toContain(t("client.settings.lock.managedFilePath", { path: LOCK_PATH }));
    expect(out).toContain('aria-disabled="true"');
  });

  test("a field error sits under its field with the message of its kind", () => {
    const view = viewOf([KEEP], SETTINGS);
    const state = reduceSettings(stateOf([KEEP], SETTINGS), {
      type: "writeBlocked",
      key: KEEP.key,
      error: {
        kind: "invalidValue",
        message: t("client.settings.field.invalidRange", { min: 1, max: 20 }),
        issues: [],
      },
    });
    expect(fieldIn(view, KEEP.key)?.error).toBeNull();
    const failed = settingsViewOf(state);
    const out = html(propsOf({ view: failed, tab: "sessions" }));
    expect(out).toContain(t("client.settings.field.invalidRange", { min: 1, max: 20 }));
  });

  test("an out-of-range draft shows the range sentence under the number field", () => {
    const state = reduceSettings(stateOf([KEEP], SETTINGS), {
      type: "draftEdited",
      key: KEEP.key,
      raw: 99,
    });
    const out = html(propsOf({ view: settingsViewOf(state), tab: "sessions" }));
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
    const out = html(propsOf({ view: viewOf([KEEP], SETTINGS), tab: "sessions" }));
    expect(out).not.toContain(t("client.settings.field.invalidRange", { min: 1, max: 20 }));
    expect(out).toContain("보관 개수");
  });
});

describe("section placement", () => {
  const REST = defOf(
    "l1.models.allowedModels",
    "models",
    "text",
    { type: "string" },
    {},
    { order: 3, label: "허용 모델" },
  );
  const LOOP = defOf(
    "l1.loop.maxSteps",
    "budgets",
    "number",
    { type: "integer" },
    { range: { min: 1, max: 20 } },
    { order: 1, label: "턴당 최대 단계" },
  );

  test("the providers section draws the usage panel above its fields, and the tools section does not", () => {
    const view = viewOf([MODEL, REST], [settingOf(MODEL.key, "sonnet"), settingOf(REST.key, "x")]);
    const usage = <p>USAGE PANEL</p>;
    const out = html(propsOf({ view, tab: "providers", usagePanel: usage }));
    expect(out).toContain("USAGE PANEL");
    expect(out.indexOf("USAGE PANEL")).toBeLessThan(out.indexOf(`data-key="${MODEL.key}"`));
    expect(html(propsOf({ view, tab: "tools", usagePanel: usage }))).not.toContain("USAGE PANEL");
  });

  test("a key outside the list is drawn in no section and no search finds it", () => {
    const view = viewOf([MODEL, LOOP], [settingOf(MODEL.key, "sonnet"), settingOf(LOOP.key, 3)]);
    for (const section of ["overview", "providers", "sessions", "execution", "advanced"] as const) {
      expect(html(propsOf({ view, tab: section }))).not.toContain(LOOP.key);
    }
    expect(html(propsOf({ view, query: "턴당" }))).toContain(t("desktop.settings.search.noMatch"));
  });

  test("the connection section draws its panel even offline, and other sections show the offline line", () => {
    const connection = <p>CONNECTION PANEL</p>;
    const out = html(
      propsOf({
        status: "offline",
        readOnly: true,
        tab: "connection",
        connectionPanel: connection,
      }),
    );
    expect(out).toContain("CONNECTION PANEL");
    expect(out).not.toContain(t("desktop.settings.offline"));
    expect(html(propsOf({ status: "offline", readOnly: true, tab: "execution" }))).toContain(
      t("desktop.settings.offline"),
    );
  });

  test("the navigation lists the shown sections in order and leaves out an empty one", () => {
    const view = viewOf([MODEL], [settingOf(MODEL.key, "sonnet")]);
    const out = html(propsOf({ view, narrow: false }));
    const providers = out.indexOf(`>${t("desktop.settings.section.providers")}<`);
    const advanced = out.indexOf(`>${t("desktop.settings.section.advanced")}<`);
    expect(providers).toBeGreaterThan(-1);
    expect(advanced).toBeGreaterThan(providers);
    expect(out).toContain(`>${t("desktop.settings.section.connection")}<`);
    expect(out).not.toContain(`>${t("desktop.settings.section.sessions")}<`);
    expect(out).not.toContain(`>${t("desktop.settings.section.execution")}<`);
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

  test("the tab list scrolls inside its own column, rows stay packed at the top, so a short window never pushes it under the status bar", () => {
    const out = html(propsOf({ narrow: false }));
    const at = out.indexOf(`aria-label="${t("desktop.settings.tabs.label")}"`);
    const tag = out.slice(out.lastIndexOf("<", at), out.indexOf(">", at));
    expect(tag).toContain("min-h-0 flex-1 content-start overflow-y-auto");
  });

  test("the secrets tab shows the secrets panel instead of the field list", () => {
    const view = viewOf([MODEL], SETTINGS);
    const out = html(propsOf({ view, tab: "secrets" }));
    expect(out).toContain("SECRETS PANEL");
    expect(out).not.toContain('data-slot="settings-field"');
  });

  test("a search lists the matching fields under their tab, and no match says so", () => {
    const view = viewOf([MODEL, KEEP], SETTINGS);
    const found = html(propsOf({ view, query: "보관" }));
    expect(found).toContain("보관 개수");
    expect(found).not.toContain("기본 모델");
    const none = html(propsOf({ view, query: "없는말" }));
    expect(none).toContain(t("desktop.settings.search.noMatch"));
  });

  const READ = [storeOf("user", ENTRY_TEXTS), storeOf("env", [])];

  test("a search for a word in a memory entry shows the memory group with that entry and no no-match line", () => {
    const out = memorySearchOf("배포", READ);
    expect(out).toContain('data-slot="settings-memory"');
    expect(out.match(/data-memory-entry=/g)).toHaveLength(1);
    expect(out).toContain("금요일에는 배포를 하지 않아요");
    expect(out).not.toContain(t("desktop.settings.search.noMatch"));
  });

  test("a search for the section name shows every memory entry under the memory group", () => {
    const out = memorySearchOf("기억", READ);
    expect(out.match(/data-memory-entry=/g)).toHaveLength(55);
    expect(out).not.toContain(t("desktop.settings.search.noMatch"));
  });

  test("a search that matches neither a setting nor a memory says no match and draws no memory group", () => {
    const out = memorySearchOf("zzzz", READ);
    expect(out).toContain(t("desktop.settings.search.noMatch"));
    expect(out).not.toContain('data-slot="settings-memory"');
  });

  test("while the memory is still loading it counts as not matching, so the no-match line shows", () => {
    const out = memorySearchOf("배포", null);
    expect(out).toContain(t("desktop.settings.search.noMatch"));
    expect(out).not.toContain('data-slot="settings-memory"');
  });

  test("a restart count shows its banner with the restart button", () => {
    const restart = defOf(
      "l0.exec.shell",
      "execution",
      "text",
      { type: "string" },
      {
        runtimeChange: "restart",
      },
    );
    const view = viewOf(
      [restart],
      [settingOf(restart.key, "/bin/sh", { runtimeChange: "restart", pendingUntil: "restart" })],
    );
    const out = html(propsOf({ view, tab: "execution" }));
    expect(out).toContain(t("client.settings.view.restartBanner", { count: 1 }));
    expect(out).toContain(t("desktop.settings.restart.button"));
    // 엔진이 살아 있어도 단추가 눌린다(R1: 예전에는 거절되는 호출에 묶여 있었다)
    const button = buttonOf(out, t("desktop.settings.restart.button"));
    expect(button).not.toBe("");
    expect(button).not.toContain('disabled=""');
  });
});

describe("search results", () => {
  const RESTART = defOf(
    "l0.exec.shell",
    "execution",
    "text",
    { type: "string" },
    { runtimeChange: "restart" },
    { order: 1, label: "셸 경로" },
  );

  test("while searching the header reads the trimmed query in quotes and 찾은 항목, and a plain page shows no such header", () => {
    const view = viewOf([MODEL, KEEP], SETTINGS);
    const found = html(propsOf({ view, query: " 보관 " }));
    expect(found).toContain(">‘보관’ 찾은 항목</h1>");
    expect(found).not.toContain(`>${t("desktop.settings.title")}</h1>`);
    expect(html(propsOf({ view, tab: "providers" }))).not.toContain("찾은 항목");
  });

  test("each search result shows its setting key beside its label", () => {
    const view = viewOf([MODEL, KEEP, LOCKED], SETTINGS);
    const out = html(propsOf({ view, query: "l1." }));
    for (const key of [MODEL.key, KEEP.key, LOCKED.key]) {
      expect(rowOf(out, key)).toContain(`>${key}</span>`);
    }
  });

  test("without a search the rows show no setting key", () => {
    const view = viewOf([MODEL, KEEP], SETTINGS);
    const out = html(propsOf({ view, tab: "providers" }));
    expect(rowOf(out, MODEL.key)).toContain("기본 모델");
    expect(rowOf(out, MODEL.key)).not.toContain(`>${MODEL.key}</span>`);
  });

  test("a search result whose setting needs a restart shows the 재시작 필요 chip, and a live one does not", () => {
    const view = viewOf(
      [RESTART, MODEL],
      [
        settingOf(RESTART.key, "/bin/sh", { runtimeChange: "restart" }),
        settingOf(MODEL.key, "sonnet"),
      ],
    );
    const restart = html(propsOf({ view, query: "셸" }));
    expect(rowOf(restart, RESTART.key)).toContain(t("client.settings.runtime.restart"));
    const live = html(propsOf({ view, query: "기본" }));
    expect(rowOf(live, MODEL.key)).not.toContain(t("client.settings.runtime.restart"));
  });
});

describe("notify section", () => {
  // OS 알림 묶음(B-10)은 "화면과 알림" 구역 맨 위에 보이고, 다른 구역에는 보이지 않는다
  const CLOSE = defOf(
    "l4.desktop.window.closeBehavior",
    "appearance",
    "select",
    { type: "string", enum: ["quit", "tray"] },
    { range: { enum: ["quit", "tray"] } },
    { order: 1, label: "창 닫기 동작" },
  );

  test("the appearance section shows the notify panel above its fields, and other sections do not", () => {
    const view = viewOf([CLOSE], [settingOf(CLOSE.key, "tray")]);
    const panel = <p>NOTIFY PANEL</p>;
    const out = html(propsOf({ view, tab: "appearance", notifyPanel: panel }));
    expect(out.indexOf("NOTIFY PANEL")).toBeGreaterThan(-1);
    expect(out.indexOf("NOTIFY PANEL")).toBeLessThan(out.indexOf('data-slot="settings-field"'));
    expect(html(propsOf({ view, tab: "execution", notifyPanel: panel }))).not.toContain(
      "NOTIFY PANEL",
    );
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
  const BYPASS_ALLOWED = defOf(
    "l1.tools.bypassAllowed",
    "permissions",
    "toggle",
    { type: "boolean" },
    { allowedScopes: ["managed"] },
    { order: 20, label: "모두 허용 쓸 수 있음" },
  );

  test("every mode shows its one-line description under its radio, and the bypass mode also shows the warning line", () => {
    const view = viewOf([PERMISSION_MODE], [settingOf(PERMISSION_MODE.key, "bypass")]);
    const out = html(propsOf({ view, tab: "permissions" }));
    for (const mode of MODES) {
      expect(out).toContain(t(`settings.l1.tools.permissionMode.optionHelp.${mode}`));
    }
    expect(out).toContain('data-slot="radio-group-description"');
    const warning = out.match(/data-slot="settings-choice-warning"[^>]*>.*?<span>([^<]*)<\/span>/);
    expect(warning?.[1]).toBe(t("settings.l1.tools.permissionMode.optionHelp.bypass"));
  });

  test("a mode that is not bypass shows no warning line", () => {
    const view = viewOf([PERMISSION_MODE], [settingOf(PERMISSION_MODE.key, "default")]);
    const out = html(propsOf({ view, tab: "permissions" }));
    expect(out).toContain(t("settings.l1.tools.permissionMode.optionHelp.default"));
    expect(out).not.toContain('data-slot="settings-choice-warning"');
  });

  test("a locked switch that is on keeps the on colour and does not take the grey disabled fill", () => {
    const view = viewOf(
      [BYPASS_ALLOWED],
      [
        settingOf(BYPASS_ALLOWED.key, true, {
          locked: true,
          lockReason: "managed_file",
          source: { scope: "managed", path: LOCK_PATH },
        }),
      ],
    );
    const out = html(propsOf({ view, tab: "permissions" }));
    expect(out).toContain('aria-checked="true"');
    expect(out).toContain("bg-accent-solid");
    expect(out).not.toContain("disabled:data-[state=checked]:bg-disabled-fill");
  });
});

describe("widget controls", () => {
  // 구역 하나(도구와 MCP)에 든 위젯으로 그린다. 모델과 계정 구역에는 스위치와 선택 칸이 없다
  const TOGGLE = defOf(
    "l2.mcp.managedOnly",
    "tools",
    "toggle",
    { type: "boolean" },
    {},
    {
      order: 0,
      label: "관리 설정만",
    },
  );
  const EFFORT_OPTIONS = ["low", "high"];
  const EFFORT = defOf(
    "l2.mcp.approvalMode",
    "tools",
    "select",
    { type: "string", enum: EFFORT_OPTIONS },
    { range: { enum: EFFORT_OPTIONS } },
    { order: 2, label: "승인 모드" },
  );
  const ALLOW = defOf(
    "l2.mcp.allowedServers",
    "tools",
    "list",
    { type: "array", items: { type: "string" } },
    {},
    { order: 3, label: "허용 서버" },
  );
  const OLD = defOf(
    "l2.web.policy.unseenUrl",
    "tools",
    "text",
    { type: "string" },
    { deprecated: { since: "0.9.0", replacedBy: MODEL.key } },
    { order: 5, label: "옛 정책" },
  );
  const SETTINGS_ALL = [
    settingOf(TOGGLE.key, true, { shadowed: [{ scope: "project", path: "/p/settings.json" }] }),
    settingOf(EFFORT.key, "low"),
    settingOf(ALLOW.key, ["a"]),
    settingOf(MODEL.key, "sonnet"),
    settingOf(OLD.key, "x"),
  ];
  const DEFS = [TOGGLE, EFFORT, ALLOW, MODEL, OLD];

  test("each widget kind renders its control, with the item count and the deprecation parts", () => {
    const view = viewOf(DEFS, SETTINGS_ALL, thr(1));
    const out = html(propsOf({ view, tab: "tools" }));
    expect(out).toContain('role="switch"');
    expect(out).toContain('role="radio"');
    expect(out).toContain('aria-orientation="horizontal"');
    expect(out).not.toContain('aria-orientation="vertical"');
    expect(out).toContain(t("desktop.settings.field.deprecated", { since: "0.9.0" }));
    expect(out).toContain(t("desktop.settings.field.deprecatedReplaced", { label: "기본 모델" }));
  });

  test("a table field shows its item count in the providers section", () => {
    const TABLE = defOf(
      "l1.models.providers",
      "providers",
      "table",
      {
        type: "object",
        properties: { low: { type: "integer" } },
        required: ["low"],
        additionalProperties: false,
      },
      {},
      { order: 4, label: "제공자 표" },
    );
    const view = viewOf([TABLE], [settingOf(TABLE.key, { low: 1 })]);
    const out = html(propsOf({ view, tab: "providers" }));
    expect(out).toContain(t("desktop.settings.field.itemCount", { count: 1 }));
  });

  test("a dirty list field shows the save and discard footer and a changed-elsewhere notice", () => {
    const base = stateOf(DEFS, SETTINGS_ALL, thr(1));
    const edited = reduceSettings(base, { type: "draftEdited", key: ALLOW.key, raw: ["a", "b"] });
    const out = html(propsOf({ view: settingsViewOf(edited), tab: "tools" }));
    expect(out).toContain(t("desktop.settings.field.save"));
    expect(out).toContain(t("desktop.settings.field.discard"));
    const moved = reduceSettings(edited, { type: "invalidated", keys: [ALLOW.key] });
    const noticed = html(propsOf({ view: settingsViewOf(moved), tab: "tools" }));
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
    expect(buttonOf(html(propsOf({ view, tab: "providers" })), label)).not.toBe("");
  });

  test("the button is locked offline and while the editor is already open", () => {
    const view = viewOf([MODEL], SETTINGS);
    expect(buttonOf(html(propsOf({ view, tab: "providers" })), label)).not.toContain('disabled=""');
    expect(buttonOf(html(propsOf({ view, tab: "providers", readOnly: true })), label)).toContain(
      'disabled=""',
    );
    expect(buttonOf(html(propsOf({ view, tab: "providers", fileOpen: true })), label)).toContain(
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
    const out = html(propsOf({ view, tab: "providers", fileEditor: <p>FILE EDITOR</p> }));
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

    const models = html(propsOf({ view, tab: "providers", readOnly: true }));
    expect(rowOf(models, MODEL.key)).toContain(MODEL.ui?.label ?? "");
    expect(rowOf(models, MODEL.key)).toContain('disabled=""');
    expect(rowOf(models, MODEL.key)).toContain(t("client.settings.origin.engineOffline"));
  });
});

describe("restore section", () => {
  test("the advanced tab shows the restore panel, and the other tabs do not", () => {
    const view = viewOf([MODEL], SETTINGS);
    expect(html(propsOf({ view, tab: "advanced" }))).toContain("RESTORE PANEL");
    expect(html(propsOf({ view, tab: "providers" }))).not.toContain("RESTORE PANEL");
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
    expect(html(propsOf({ view, tab: "providers", updatePanel: line }))).not.toContain(
      "UPDATE LINE",
    );
    expect(
      html(propsOf({ view, tab: "overview", query: "기본", updatePanel: line })),
    ).not.toContain("UPDATE LINE");
  });
});

describe("overview tab sections", () => {
  const view = viewOf([MODEL, KEEP, LOCKED], SETTINGS);

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

  test("the 설정 파일 card has the user, project and managed rows in that order, and an unknown path shows 없음 in plain text with no copy button", () => {
    const out = html(
      propsOf({
        view,
        tab: "overview",
        filePaths: [
          { scope: "user", path: "/home/me/.fresnel/settings.json" },
          { scope: "project", path: null },
          { scope: "managed", path: "/etc/fresnel/managed.json" },
        ],
      }),
    );
    expect(fileRowsOf(out)).toEqual([
      {
        term: t("desktop.settings.overview.files.user"),
        value: "~/.fresnel/settings.json",
        mono: true,
        copy: true,
      },
      {
        term: t("desktop.settings.overview.files.project"),
        value: t("desktop.settings.overview.files.none"),
        mono: false,
        copy: false,
      },
      {
        term: t("desktop.settings.overview.files.managed"),
        value: "/etc/fresnel/managed.json",
        mono: true,
        copy: true,
      },
    ]);
  });

  test("the 설정 파일 card is hidden when there are no rows, as when the connection is not live", () => {
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
    expect(plain).toMatch(/pb-12"><section/);
    const offline = html(
      propsOf({
        view,
        tab: "overview",
        readOnly: true,
        filePaths: [{ scope: "user", path: "/home/me/.fresnel/settings.json" }],
      }),
    );
    expect(offline).toContain(t("desktop.settings.offline"));
    expect(offline).not.toMatch(/pb-12"><section/);
  });

  test("every section title renders at the mockup's 16px title-2 ink (its unlayered h2 rule beats text-ui)", () => {
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

// user=2, project=4, local=6: 유효 값은 local이다. 쓰기는 사용자 범위로 가고, 이기는 local 값은 항목 아래 경고 줄로
// 그 파일 경로와 함께 보인다. 범위 고르기 칸과 가려진 값 접힘은 없다.
describe("override note in the page", () => {
  test("a winning local value shows the warning under the row with its file, and no scope choice", () => {
    const KEY = "x.ui.allowProjectApps";
    const LENSES = defOf(
      KEY,
      "plugins",
      "toggle",
      { type: "boolean" },
      {},
      { order: 1, label: "프로젝트 앱 허용" },
    );
    const LOCAL_PATH = "/work/.fresnel/settings.local.json";
    const winner = settingOf(KEY, true, {
      source: { scope: "local", path: LOCAL_PATH },
      shadowed: [
        { scope: "project", path: "/work/.fresnel/settings.json" },
        { scope: "user", path: "/home/user/.fresnel/settings.json" },
      ],
    });
    const view = viewOf([LENSES], [winner], thr(1));
    const field = fieldIn(view, KEY);
    expect(field?.scope.scope).toBe("local");
    expect(field?.writableScopes).toEqual(["user", "project", "local", "launch"]);
    const out = html(propsOf({ view, tab: "plugins" }));
    expect(out).toContain(
      t("desktop.settings.field.overriddenPath", {
        scope: t("client.settings.scope.local"),
        path: LOCAL_PATH,
      }),
    );
  });
});

describe("MCP servers section", () => {
  const MCP = defOf(
    "l2.mcp.servers",
    "tools",
    "table",
    { type: "object" },
    {},
    {
      order: 300,
      label: "MCP servers",
    },
  );
  const IMPORT = defOf(
    "l2.mcp.importMcpJson",
    "tools",
    "toggle",
    { type: "boolean" },
    {},
    {
      order: 301,
      label: "Import .mcp.json",
    },
  );
  const SETTINGS_VALUES = [
    settingOf("l2.mcp.servers", {}),
    settingOf("l2.mcp.importMcpJson", true),
  ];

  test("the tools tab draws the section in place of the generic table row", () => {
    const view = viewOf([MCP, IMPORT], SETTINGS_VALUES);
    const out = html(propsOf({ view, tab: "tools", mcpPanel: <p>MCP PANEL</p> }));
    expect(out).toContain("MCP PANEL");
    expect(out).not.toContain('data-key="l2.mcp.servers"');
    expect(out).toContain('data-key="l2.mcp.importMcpJson"');
  });

  test("a search for the table's name finds the section and not the table row", () => {
    const view = viewOf([MCP, IMPORT], SETTINGS_VALUES);
    const out = html(propsOf({ view, query: "MCP servers", mcpPanel: <p>MCP PANEL</p> }));
    expect(out).toContain("MCP PANEL");
    expect(out).not.toContain('data-key="l2.mcp.servers"');
  });

  test("the section is drawn on the tools tab only", () => {
    const view = viewOf([MCP, IMPORT], SETTINGS_VALUES);
    const out = html(propsOf({ view, tab: "providers", mcpPanel: <p>MCP PANEL</p> }));
    expect(out).not.toContain("MCP PANEL");
  });
});

describe("overview tab problem banner", () => {
  const view = viewOf([MODEL, KEEP, LOCKED], SETTINGS);
  const PROBLEM = {
    scope: "user" as const,
    path: "/home/me/.fresnel/settings.json",
    reason: "invalid_json" as const,
    line: 3,
    column: 5,
  };

  /** 알림 값을 준 자리에서 그린다. 개요 탭의 맨 위 띠는 이 값을 읽는다 */
  function htmlWithProblem(props: SettingsPageProps): string {
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
          <HostNoticesContext value={{ settingsProblems: [PROBLEM], startupNotices: [] }}>
            <SettingsPageView {...props} />
          </HostNoticesContext>
        </ShellStoreContext>
      </Providers>,
    );
  }

  test("the overview tab opens with the banner and its open-file action", () => {
    const out = htmlWithProblem(propsOf({ view, tab: "overview" }));
    expect(out).toContain(t("desktop.settings.problem.title"));
    expect(out).toContain(t("desktop.settings.problem.openFile"));
    expect(out.indexOf(t("desktop.settings.problem.title"))).toBeLessThan(
      out.indexOf(t("desktop.settings.overview.state")),
    );
  });

  test("the banner stays on the overview tab only", () => {
    expect(htmlWithProblem(propsOf({ view, tab: "providers" }))).not.toContain(
      t("desktop.settings.problem.title"),
    );
  });

  test("the open-file action is locked while the file editor is open or the link is offline", () => {
    const open = htmlWithProblem(propsOf({ view, tab: "overview", fileOpen: true }));
    expect(open).toContain('disabled=""');
    const offline = htmlWithProblem(propsOf({ view, tab: "overview", readOnly: true }));
    expect(offline).toContain('disabled=""');
  });
});

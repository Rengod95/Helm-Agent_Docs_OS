import { describe, expect, test } from "bun:test";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { UI_APPS_KEY } from "../../../src/plugin-ui/policy-context.ts";
import {
  ADDON_LIST,
  addonDetailOf,
  addonMetaOf,
  addonRouteOf,
  addonRowsOf,
  appGroupsOf,
  monogramOf,
  risksOf,
  splitBuiltin,
  tabbableRowsOf,
  toolOwnerOf,
  type AddonAttention,
  type AddonMetaMap,
  type AddonRow,
  type AddonSource,
} from "../../../src/views/plugin/addon-model.ts";
import { APP_DECL, uiEntryOf } from "../../plugin-ui/support.ts";
import { entry } from "../workbench/support.tsx";

// 플레이그라운드 목록·상세 모델(addon-model.ts). 값을 그대로 비교한다.

const NO_META: AddonMetaMap = new Map();

function sourceOf(
  entries: readonly ExtUiEntry[],
  options: {
    readonly inactive?: readonly string[];
    readonly settings?: Record<string, unknown>;
  } = {},
): AddonSource {
  return {
    entries,
    inactive: new Set(options.inactive ?? []),
    settings: options.settings ?? {},
  };
}

const VIEWDEMO: readonly ExtUiEntry[] = [
  uiEntryOf({ extension: "viewdemo", id: "notes", title: "Native demo", version: "1.0.0" }),
  uiEntryOf({
    extension: "viewdemo",
    id: "frame",
    title: "Frame demo",
    mode: "app",
    version: "1.0.0",
    app: { ...APP_DECL, reason: "그래프", capabilities: ["notify", "files"] },
  }),
];

const HELM: readonly ExtUiEntry[] = [
  uiEntryOf({ id: "inquiry", title: "탐구" }),
  uiEntryOf({ id: "panel", placement: "panel", title: "Helm 패널" }),
  uiEntryOf({ id: "finding", placement: "card", title: "발견", forKind: "grp.helm.finding" }),
  uiEntryOf({ id: "start", placement: "command", title: "탐구 시작" }),
  uiEntryOf({ id: "status", placement: "status", title: "Helm 상태" }),
];

describe("monogramOf", () => {
  test("takes the first letter, upper-cased, and falls back to a question mark", () => {
    expect(monogramOf("viewdemo")).toBe("V");
    expect(monogramOf("  헬름")).toBe("헬");
    expect(monogramOf("")).toBe("?");
  });
});

function offOf(meta: AddonMetaMap, inactive: readonly string[] = []): boolean | undefined {
  return addonRowsOf(sourceOf(VIEWDEMO, { inactive }), meta, "ko")[0]?.off;
}

function attentionOf(
  entries: readonly ExtUiEntry[],
  settings: Record<string, unknown> = {},
): AddonAttention | undefined {
  return addonRowsOf(sourceOf(entries, { settings }), NO_META, "ko")[0]?.attention;
}

describe("addonRowsOf", () => {
  test("one row per extension with any entry, sorted by shown name, counting screens and other features", () => {
    const rows = addonRowsOf(sourceOf([...VIEWDEMO, ...HELM]), NO_META, "ko");
    expect(
      rows.map((row) => [
        row.name,
        row.title,
        row.monogram,
        row.screens,
        row.features,
        row.summary,
      ]),
    ).toEqual([
      // Helm의 panel은 대화 옆 Helm 탭 몫이라 화면이 아니라 기능으로 센다
      ["helm", "helm", "H", 1, 4, "탐구"],
      ["viewdemo", "viewdemo", "V", 2, 0, "Native demo, Frame demo"],
    ]);
  });

  test("uses the display name and the manifest description's first line when they are known", () => {
    const meta: AddonMetaMap = new Map([
      [
        "viewdemo",
        addonMetaOf(entry("viewdemo", { displayName: "View demo" }), {
          description: "예제 플러그인이에요.\n둘째 줄",
        }),
      ],
    ]);
    const [row] = addonRowsOf(sourceOf(VIEWDEMO), meta, "ko");
    expect([row?.title, row?.monogram, row?.summary]).toEqual([
      "View demo",
      "V",
      "예제 플러그인이에요.",
    ]);
  });

  test("marks an extension off when it is inactive, disabled in ext.list, or kept out by safe mode", () => {
    expect(offOf(NO_META)).toBe(false);
    expect(offOf(NO_META, ["viewdemo"])).toBe(true);
    expect(
      offOf(
        new Map([["viewdemo", addonMetaOf(entry("viewdemo", { status: "disabled" }), undefined)]]),
      ),
    ).toBe(true);
    expect(
      offOf(
        new Map([
          ["viewdemo", addonMetaOf(entry("viewdemo", { safeModeExcluded: "safe" }), undefined)],
        ]),
      ),
    ).toBe(true);
  });

  test("danger for an invalid entry or an error diagnostic, warning for a blocked app screen or a keep-off question", () => {
    expect(attentionOf(VIEWDEMO)).toBeUndefined();
    expect(attentionOf([uiEntryOf({ extension: "x", state: "invalid" })])).toBe("danger");
    expect(attentionOf(VIEWDEMO, { [UI_APPS_KEY]: false })).toBe("warning");
    const asking: AddonMetaMap = new Map([
      [
        "viewdemo",
        addonMetaOf(
          entry("viewdemo", {
            keepOffQuestion: { rule: "consecutive", consecutive: 5, windowFailures: 5 },
          }),
          undefined,
        ),
      ],
    ]);
    expect(addonRowsOf(sourceOf(VIEWDEMO), asking, "ko")[0]?.attention).toBe("warning");
    const meta: AddonMetaMap = new Map([
      [
        "viewdemo",
        addonMetaOf(
          entry("viewdemo", { diagnostics: [{ severity: "error", code: "x", message: "bad" }] }),
          undefined,
        ),
      ],
    ]);
    const [row] = addonRowsOf(sourceOf(VIEWDEMO), meta, "ko");
    expect([row?.attention, row?.errorCount]).toEqual(["danger", 1]);
  });

  test("lists an ext.list-only plugin as a row with no screens, and builtins apart", () => {
    const meta: AddonMetaMap = new Map([
      ["quiet", addonMetaOf(entry("quiet", { origin: "builtin" }), undefined)],
      ["viewdemo", addonMetaOf(entry("viewdemo"), undefined)],
    ]);
    const rows = addonRowsOf(sourceOf(VIEWDEMO), meta, "ko");
    expect(rows.map((row) => [row.name, row.screens, row.features, row.builtin])).toEqual([
      ["quiet", 0, 0, true],
      ["viewdemo", 2, 0, false],
    ]);
    const split = splitBuiltin(rows);
    expect([split.added.map((row) => row.name), split.builtin.map((row) => row.name)]).toEqual([
      ["viewdemo"],
      ["quiet"],
    ]);
    expect(tabbableRowsOf(sourceOf(VIEWDEMO), meta, "ko").map((row) => row.name)).toEqual([
      "viewdemo",
    ]);
  });
});

describe("risksOf", () => {
  test("names tool and request hooks, write methods and capabilities first, then other hooks and read-only methods", () => {
    const write = { verb: "save", readOnly: false, approval: true };
    const read = { verb: "list", readOnly: true, approval: false };
    expect(
      risksOf(
        ["tool.call.before", "request.system.before", "turn.end", "guard.output.before"],
        [write, read],
        ["files"],
      ),
    ).toEqual([
      { kind: "toolHooks", hooks: ["tool.call.before"] },
      { kind: "requestHooks", hooks: ["request.system.before", "guard.output.before"] },
      { kind: "methods", methods: [write, read], writes: 1 },
      { kind: "capability", capability: "files" },
      { kind: "otherHooks", count: 1 },
    ]);
    expect(risksOf(["turn.end"], [read], [])).toEqual([
      { kind: "otherHooks", count: 1 },
      { kind: "methods", methods: [read], writes: 0 },
    ]);
    expect(risksOf(undefined, undefined, [])).toEqual([]);
  });
});

describe("addonDetailOf", () => {
  test("lists screens with where they open and their mode, and picks the first openable one", () => {
    const detail = addonDetailOf("viewdemo", sourceOf(VIEWDEMO), NO_META, "ko");
    expect(
      detail?.screens.map((screen) => [
        screen.key,
        screen.title,
        screen.where,
        screen.app,
        screen.state,
      ]),
    ).toEqual([
      ["viewdemo/notes", "Native demo", "page", false, "ready"],
      ["viewdemo/frame", "Frame demo", "page", true, "ready"],
    ]);
    expect(detail?.primary?.key).toBe("viewdemo/notes");
    expect(detail?.hasApp).toBe(true);
    // 권한은 고정 순서(files, notify, settingsWrite, secrets)로 겹치지 않게 모은다
    expect(detail?.capabilities).toEqual(["files", "notify"]);
    expect(detail?.problems).toEqual([]);
  });

  test("puts conversation features in a fixed kind order: command (runnable) first, then side panel, card, status", () => {
    const detail = addonDetailOf("helm", sourceOf(HELM), NO_META, "ko");
    expect(detail?.features.map((feature) => [feature.kind, feature.title])).toEqual([
      ["command", "탐구 시작"],
      ["panel", "Helm 패널"],
      ["card", "발견"],
      ["status", "Helm 상태"],
    ]);
    expect(detail?.screens.map((screen) => screen.key)).toEqual(["helm/inquiry"]);
    expect(detail?.hasApp).toBe(false);
    expect(detail?.capabilities).toEqual([]);
  });

  test("reports problems and leaves nothing to open when the plugin is off or a screen cannot open", () => {
    const entries = [
      uiEntryOf({
        extension: "x",
        id: "bad",
        state: "invalid",
        issues: [{ severity: "error", code: "tree_invalid", message: "bad tree" }],
      }),
      uiEntryOf({ extension: "x", id: "app", mode: "app", app: APP_DECL }),
    ];
    const blocked = addonDetailOf(
      "x",
      sourceOf(entries, { settings: { [UI_APPS_KEY]: false } }),
      NO_META,
      "ko",
    );
    expect(blocked?.screens.map((screen) => [screen.state, screen.issue])).toEqual([
      ["invalid", "bad tree"],
      ["blocked", undefined],
    ]);
    expect(blocked?.primary).toBeUndefined();
    expect(blocked?.problems).toEqual([
      { kind: "invalid", count: 1 },
      { kind: "blocked", count: 1 },
    ]);
    const off = addonDetailOf("x", sourceOf(entries, { inactive: ["x"] }), NO_META, "ko");
    expect(off?.problems[0]).toEqual({ kind: "off" });
    expect(off?.screens[1]?.state).toBe("off");
  });

  test("a blocked app screen with a fallback tree still opens", () => {
    const entries = [
      uiEntryOf({ extension: "x", id: "app", mode: "app", app: APP_DECL, tree: { type: "Text" } }),
    ];
    const detail = addonDetailOf(
      "x",
      sourceOf(entries, { settings: { [UI_APPS_KEY]: false } }),
      NO_META,
      "ko",
    );
    expect(detail?.screens[0]?.state).toBe("ready");
  });

  test("is undefined for an extension that adds nothing", () => {
    expect(addonDetailOf("none", sourceOf(VIEWDEMO), NO_META, "ko")).toBeUndefined();
  });
});

describe("addonMetaOf", () => {
  test("reads the description, author (text or object) and license, and ignores other shapes", () => {
    expect(
      addonMetaOf(entry("a", { displayName: "A" }), {
        description: "설명",
        author: { name: "만든 사람" },
        license: "MIT",
      }),
    ).toEqual({
      listed: true,
      displayName: "A",
      description: "설명",
      author: "만든 사람",
      license: "MIT",
      homepage: undefined,
      repository: undefined,
      version: "1.0.0",
      origin: "user",
      location: "/x",
      requestedGrade: "user",
      effectiveGrade: "user",
      isOrchestration: false,
      enabled: true,
      safeMode: false,
      errors: 0,
      diagnostics: [],
      keepOff: undefined,
      hooks: undefined,
      hookCount: 2,
      methods: undefined,
    });
    expect(addonMetaOf(undefined, { description: 3, author: "  ", license: null })).toEqual({
      listed: false,
      displayName: undefined,
      description: undefined,
      author: undefined,
      license: undefined,
      homepage: undefined,
      repository: undefined,
      version: undefined,
      origin: undefined,
      location: undefined,
      requestedGrade: undefined,
      effectiveGrade: undefined,
      isOrchestration: undefined,
      enabled: undefined,
      safeMode: undefined,
      errors: undefined,
      diagnostics: undefined,
      keepOff: undefined,
      hooks: undefined,
      hookCount: undefined,
      methods: undefined,
    });
  });
});

describe("addonMetaOf 도구 이름", () => {
  test("reads the names of the manifest tools, keeping only the entries with a name", () => {
    const manifest = {
      tools: [
        { name: "search" },
        { name: "  " },
        { name: 3 },
        "bare",
        { desc: "x" },
        { name: "save" },
      ],
    };
    expect(addonMetaOf(undefined, manifest).tools).toEqual(["search", "save"]);
    expect(addonMetaOf(undefined, { tools: "search" }).tools).toEqual(undefined);
    expect(addonMetaOf(undefined, undefined).tools).toEqual(undefined);
  });
});

describe("toolOwnerOf", () => {
  test("names the first plugin, in meta order, whose manifest tools include the name", () => {
    const meta: AddonMetaMap = new Map([
      ["alpha", addonMetaOf(undefined, { tools: [{ name: "lookup" }] })],
      ["beta", addonMetaOf(undefined, { tools: [{ name: "lookup" }, { name: "save" }] })],
      ["gamma", addonMetaOf(undefined, {})],
    ]);
    expect(toolOwnerOf(meta, "lookup")).toEqual("alpha");
    expect(toolOwnerOf(meta, "save")).toEqual("beta");
    expect(toolOwnerOf(meta, "missing")).toEqual(undefined);
    expect(toolOwnerOf(NO_META, "lookup")).toEqual(undefined);
  });
});

const names = (list: readonly AddonRow[]): string[] => list.map((row) => row.name);

describe("appGroupsOf", () => {
  const ENTRIES: readonly ExtUiEntry[] = [
    uiEntryOf({ extension: "zeta", id: "notes", title: "Zeta screen" }),
    uiEntryOf({ extension: "alpha", id: "notes", title: "Alpha screen" }),
    uiEntryOf({ extension: "beta", id: "start", placement: "command", title: "Beta command" }),
  ];
  test("without a profile every app is main; rows with no screen are left out", () => {
    const rows = addonRowsOf(sourceOf(ENTRIES), NO_META, "ko");
    expect(names(rows)).toEqual(["alpha", "beta", "zeta"]);
    expect(names(appGroupsOf(rows, undefined).main)).toEqual(["alpha", "zeta"]);
    expect(appGroupsOf(rows, undefined).others).toEqual([]);
  });

  test("with a profile, the apps it lists are main and the rest are others, in row order", () => {
    const rows = addonRowsOf(sourceOf(ENTRIES), NO_META, "ko");
    const groups = appGroupsOf(rows, new Set(["zeta", "beta"]));
    expect(names(groups.main)).toEqual(["zeta"]);
    expect(names(groups.others)).toEqual(["alpha"]);
    expect(appGroupsOf(rows, new Set()).main).toEqual([]);
  });
});

describe("addonRouteOf", () => {
  test("keeps a route that still points at something, otherwise falls back one level", () => {
    expect(addonRouteOf(ADDON_LIST, VIEWDEMO)).toEqual(ADDON_LIST);
    expect(addonRouteOf({ kind: "plugin", name: "viewdemo" }, VIEWDEMO)).toEqual({
      kind: "plugin",
      name: "viewdemo",
    });
    expect(addonRouteOf({ kind: "plugin", name: "gone" }, VIEWDEMO)).toEqual(ADDON_LIST);
    expect(addonRouteOf({ kind: "screen", key: "viewdemo/frame" }, VIEWDEMO)).toEqual({
      kind: "screen",
      key: "viewdemo/frame",
    });
    expect(addonRouteOf({ kind: "screen", key: "viewdemo/gone" }, VIEWDEMO)).toEqual({
      kind: "plugin",
      name: "viewdemo",
    });
    expect(addonRouteOf({ kind: "screen", key: "helm/panel" }, HELM)).toEqual({
      kind: "plugin",
      name: "helm",
    });
    expect(addonRouteOf({ kind: "screen", key: "gone/x" }, VIEWDEMO)).toEqual(ADDON_LIST);
  });
});

describe("화면과 기능 이름은 플러그인 메시지로 고른다(AGE-76 plugMin: 화면 목록에 번역 키가 새던 곳)", () => {
  test("카드와 패널의 제목 키는 그 로케일 문장이 되고, 없는 로케일이면 영어 문장이다", () => {
    const messages = {
      ko: { "helm.finished.title": "탐구 결과", "helm.inquiry.title": "탐구" },
      en: { "helm.finished.title": "Inquiry result", "helm.inquiry.title": "Inquiry" },
    };
    const entries: readonly ExtUiEntry[] = [
      uiEntryOf({ id: "helm-panel", placement: "panel", title: "helm.inquiry.title", messages }),
      uiEntryOf({ id: "helm-finished", placement: "card", title: "helm.finished.title", messages }),
    ];
    const source = { entries, inactive: new Set<string>(), settings: {} };
    const ko = addonDetailOf("helm", source, new Map(), "ko");
    expect(ko?.features.map((feature) => [feature.kind, feature.title])).toEqual([
      ["panel", "탐구"],
      ["card", "탐구 결과"],
    ]);
    const fr = addonDetailOf("helm", source, new Map(), "fr");
    expect(fr?.features.map((feature) => feature.title)).toEqual(["Inquiry", "Inquiry result"]);
  });
});

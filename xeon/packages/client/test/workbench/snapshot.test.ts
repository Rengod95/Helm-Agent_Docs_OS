import { describe, expect, test } from "bun:test";
import { validateManifest } from "@fresnel/contracts/extensions";
import type {
  ExtBindingEdge,
  ExtGetResult,
  ExtHealthEntry,
  ExtHookInfo,
  ExtListEntry,
  ExtListPlugin,
} from "@fresnel/contracts/wire";
import {
  INITIAL_WORKBENCH,
  detailsLoaded,
  healthLoaded,
  listLoaded,
  snapshotOf,
  type WorkbenchState,
} from "../../src/workbench/index.ts";
import { keepsContrib } from "../../src/workbench/canvas/index.ts";

// 검사를 통과하는 매니페스트 픽스처. 시험 맨 앞에서 검사 통과를 확인한다.
const HELM_MANIFEST: Readonly<Record<string, unknown>> = {
  schemaVersion: 2,
  name: "helm",
  version: "0.4.0",
  displayName: "Helm",
  description: "작업 흐름을 맡는 그룹",
  entry: "./src/index.ts",
  group: {},
  components: { skills: ["./skills/plan/"], commands: ["./commands/ship.md"] },
  plugins: [
    {
      layer: "L3",
      title: "Helm",
      hooks: ["thread.start"],
      drives: true,
      provides: [{ id: "helm.plan", version: "1.0.0" }],
      requires: [{ id: "knowledge.memory", range: "^1.0.0" }],
      recordKinds: [
        {
          kind: "grp.helm.plan.made",
          version: 1,
          description: "계획이 만들어졌다",
          payload: {},
        },
      ],
      readsRecordKinds: ["x.acme-notes.note.*"],
    },
    {
      id: "lens",
      layer: "L2",
      title: "Lens",
      hooks: ["input.agent.before"],
      optional: [{ id: "knowledge.search", range: "^1.0.0" }],
    },
  ],
};

const PR_KIT_MANIFEST: Readonly<Record<string, unknown>> = {
  schemaVersion: 2,
  name: "pr-kit",
  version: "1.2.0",
  displayName: "PR Kit",
  entry: "./src/index.ts",
  components: {
    skills: ["./skills/review.md", "./skills/triage/"],
    commands: ["./commands/pr-open.md"],
    agents: ["./agents/reviewer.md"],
    mcpServers: "./mcp/github.json",
  },
  ui: {
    schemaVersion: 1,
    widgets: "^1.0.0",
    items: [
      {
        id: "queue",
        placement: "page",
        mode: "native",
        title: "리뷰 대기열",
        file: "./ui/queue.json",
      },
    ],
  },
  plugins: [{ layer: "L3", hooks: ["input.user.before", "tool.result"] }],
};

const PLAIN_MANIFEST: Readonly<Record<string, unknown>> = {
  schemaVersion: 2,
  name: "news",
  version: "2.0.0",
  displayName: "뉴스",
  description: "새 소식을 모아 준다",
  entry: "./src/index.ts",
  plugins: [{ layer: "plugin", hooks: [] }],
};

function listEntry(name: string, over: Partial<ExtListEntry> = {}): ExtListEntry {
  return {
    name,
    displayName: name,
    layer: "L2",
    isGroup: false,
    version: "1.0.0",
    location: "/x",
    origin: "user",
    requestedGrade: "user",
    effectiveGrade: "user",
    tier: null,
    status: "enabled",
    plugins: [{ registrationId: name, layer: "L2", status: "enabled", inGroup: false }],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 0,
    ...over,
  };
}

function plugin(registrationId: string, over: Partial<ExtListPlugin> = {}): ExtListPlugin {
  return { registrationId, layer: "L2", status: "enabled", inGroup: false, ...over };
}

function getResult(
  entry: ExtListEntry,
  manifest: Readonly<Record<string, unknown>>,
  hooks: readonly ExtHookInfo[] = [],
  bindings: readonly ExtBindingEdge[] = [],
): ExtGetResult {
  return { entry, manifest, hooks, bindings };
}

function healthEntry(registrationId: string, over: Partial<ExtHealthEntry> = {}): ExtHealthEntry {
  return {
    name: registrationId.split("/")[0] ?? registrationId,
    registrationId,
    consecutiveFailures: 0,
    windowFailures: 0,
    windowMs: 0,
    autoDisabled: false,
    lastFailureAt: null,
    lastError: null,
    ...over,
  };
}

/** 목록·상세·실패 장부를 넣은 워크벤치 상태 */
function stateOf(
  entries: readonly ExtListEntry[],
  details: readonly ExtGetResult[] = [],
  health: readonly ExtHealthEntry[] = [],
): WorkbenchState {
  let s = listLoaded(INITIAL_WORKBENCH, entries);
  for (const d of details) s = detailsLoaded(s, d.entry.name, d);
  return healthLoaded(s, health);
}

// helm: 그룹 루트(L3, 매니페스트 있음)와 구성원 lens(L2, 꺼짐)
const helmEntry = listEntry("helm", {
  displayName: "Helm",
  layer: "L3",
  isGroup: true,
  version: "0.4.0",
  origin: "builtin",
  plugins: [
    plugin("helm", { layer: "L3", inGroup: true }),
    plugin("helm/lens", { id: "lens", status: "disabled", inGroup: true }),
  ],
  hookCount: 2,
});

const HELM_DETAIL = getResult(
  helmEntry,
  HELM_MANIFEST,
  [
    { registrationId: "helm", hook: "thread.start", budgetClass: "tap", budgetMs: 50 },
    {
      registrationId: "helm/lens",
      hook: "input.agent.before",
      budgetClass: "chain",
      budgetMs: 100,
    },
  ],
  [
    {
      registrationId: "helm",
      capability: "helm.plan",
      relation: "provides",
      peer: null,
      satisfied: true,
    },
    {
      registrationId: "helm",
      capability: "knowledge.memory",
      relation: "requires",
      peer: "memory-store",
      satisfied: true,
    },
  ],
);

describe("캔버스 스냅샷 어댑터", () => {
  test("픽스처 매니페스트는 검사를 통과한다", () => {
    for (const m of [HELM_MANIFEST, PR_KIT_MANIFEST, PLAIN_MANIFEST]) {
      expect(validateManifest(m).issues).toEqual([]);
    }
  });

  test("그룹의 루트와 구성원: 이름·설명은 매니페스트, 구성 요소·기능·기록은 루트에만", () => {
    const snap = snapshotOf(stateOf([helmEntry], [HELM_DETAIL]));
    expect(snap.plugins).toEqual([
      {
        id: "helm",
        name: "Helm",
        role: "작업 흐름을 맡는 그룹",
        layer: "L3",
        group: "helm",
        origin: "builtin",
        version: "0.4.0",
        hooks: ["thread.start"],
        provides: ["helm.plan"],
        requires: ["knowledge.memory"],
        pieces: [
          { kind: "skill", name: "plan" },
          { kind: "command", name: "ship" },
        ],
        drives: true,
        records: ["grp.helm.plan.made"],
        reads: ["x.acme-notes.note.*"],
        on: true,
      },
      {
        id: "helm/lens",
        name: "Lens",
        layer: "L2",
        group: "helm",
        origin: "builtin",
        version: "0.4.0",
        hooks: ["input.agent.before"],
        provides: [],
        optional: ["knowledge.search"],
        pieces: [],
        on: false,
      },
    ]);
    expect(snap.groups).toEqual([
      {
        id: "helm",
        name: "Helm",
        role: "작업 흐름을 맡는 그룹",
        version: "0.4.0",
        origin: "builtin",
        members: ["helm", "helm/lens"],
      },
    ]);
  });

  test("단독 L3 플러그인: 구성 요소 경로는 이름만, mcp와 화면을 루트에 싣는다", () => {
    const prEntry = listEntry("pr-kit", {
      displayName: "PR Kit",
      layer: "L3",
      version: "1.2.0",
      plugins: [plugin("pr-kit", { layer: "L3" })],
    });
    const snap = snapshotOf(
      stateOf(
        [prEntry],
        [
          getResult(prEntry, PR_KIT_MANIFEST, [
            {
              registrationId: "pr-kit",
              hook: "input.user.before",
              budgetClass: "chain",
              budgetMs: 80,
            },
            { registrationId: "pr-kit", hook: "tool.result", budgetClass: "chain", budgetMs: 80 },
          ]),
        ],
      ),
    );
    expect(snap.plugins).toEqual([
      {
        id: "pr-kit",
        name: "PR Kit",
        layer: "L3",
        origin: "user",
        version: "1.2.0",
        hooks: ["input.user.before", "tool.result"],
        provides: [],
        pieces: [
          { kind: "skill", name: "review" },
          { kind: "skill", name: "triage" },
          { kind: "command", name: "pr-open" },
          { kind: "agent", name: "reviewer" },
          { kind: "mcp", name: "github" },
          { kind: "view", name: "queue" },
        ],
        on: true,
      },
    ]);
    expect(snap.groups).toEqual([]);
  });

  test("실패 장부: 연속 실패가 있으면 실패 사유와 시각을 싣고, 자동으로 꺼졌으면 자동 꺼짐 표시를 붙인다", () => {
    const news = listEntry("news", { displayName: "뉴스" });
    const review = listEntry("review", {
      status: "disabled",
      autoDisabled: true,
      plugins: [plugin("review", { status: "disabled" })],
    });
    const healthy = listEntry("notes");
    const snap = snapshotOf(
      stateOf(
        [news, review, healthy],
        [getResult(news, PLAIN_MANIFEST)],
        [
          healthEntry("news", {
            consecutiveFailures: 2,
            windowFailures: 2,
            windowMs: 60_000,
            lastFailureAt: "2026-11-04T10:00:00Z",
            lastError: "timeout",
          }),
          healthEntry("review", { consecutiveFailures: 5, windowFailures: 5, autoDisabled: true }),
          healthEntry("notes"),
        ],
      ),
    );
    const byId = Object.fromEntries(snap.plugins.map((p) => [p.id, p]));
    // 훅과 기준은 ext.health에 없어서 비운다
    expect(byId.news?.health).toEqual({ fails: 2, text: "timeout", at: "2026-11-04T10:00:00Z" });
    expect(byId.review).toMatchObject({ on: false });
    expect(byId.review?.health).toEqual({ fails: 5, text: "", at: "", autoOff: true });
    expect(byId.notes?.health).toBeUndefined();
  });

  test("캐시가 없는 확장은 매니페스트 없이 목록 값만 쓴다", () => {
    const acme = listEntry("acme", {
      displayName: "Acme",
      layer: "plugin",
      plugins: [
        plugin("acme", { layer: "plugin" }),
        plugin("acme/tap", { id: "tap", layer: "plugin", status: "disabled" }),
      ],
    });
    const snap = snapshotOf(stateOf([acme]));
    expect(snap.plugins).toEqual([
      {
        id: "acme",
        name: "Acme",
        layer: "plugin",
        origin: "user",
        version: "1.0.0",
        hooks: [],
        provides: [],
        pieces: [],
        on: true,
        unread: true,
      },
      {
        id: "acme/tap",
        name: "tap",
        layer: "plugin",
        origin: "user",
        version: "1.0.0",
        hooks: [],
        provides: [],
        pieces: [],
        on: false,
        unread: true,
      },
    ]);
    expect(snap.groups).toEqual([]);
  });

  test("검사에 실패한 매니페스트는 없는 것으로 본다", () => {
    const broken = listEntry("broken", { displayName: "깨짐" });
    const snap = snapshotOf(
      stateOf([broken], [getResult(broken, { schemaVersion: 1, name: "broken" })]),
    );
    expect(snap.plugins).toEqual([
      {
        id: "broken",
        name: "깨짐",
        layer: "L2",
        origin: "user",
        version: "1.0.0",
        hooks: [],
        provides: [],
        pieces: [],
        on: true,
        unread: true,
      },
    ]);
  });

  test("출처: managed는 사용자로, project와 builtin은 그대로, 없으면 사용자로 본다", () => {
    const { origin: _none, ...withoutOrigin } = listEntry("bare");
    const entries: ExtListEntry[] = [
      listEntry("m", { origin: "managed" }),
      listEntry("p", { origin: "project" }),
      listEntry("b", { origin: "builtin" }),
      withoutOrigin,
    ];
    const snap = snapshotOf(stateOf(entries));
    expect(snap.plugins.map((p) => [p.id, p.origin])).toEqual([
      ["m", "user"],
      ["p", "project"],
      ["b", "builtin"],
      ["bare", "user"],
    ]);
  });

  test("기능 엣지에 없고 매니페스트에만 있는 선언 이름도 싣고, 중복은 한 번만 싣는다", () => {
    const detail = getResult(
      helmEntry,
      HELM_MANIFEST,
      [],
      [
        {
          registrationId: "helm",
          capability: "helm.plan",
          relation: "provides",
          peer: null,
          satisfied: true,
        },
        {
          registrationId: "helm",
          capability: "helm.plan",
          relation: "provides",
          peer: null,
          satisfied: true,
        },
      ],
    );
    const root = snapshotOf(stateOf([helmEntry], [detail])).plugins[0];
    expect(root).toMatchObject({ provides: ["helm.plan"], requires: ["knowledge.memory"] });
  });
});

describe("구성 요소 거르기와 매니페스트 읽기", () => {
  test("매니페스트를 읽지 못한 플러그인만 unread이고, 구성 요소 거르기는 그것을 숨기지 않는다", () => {
    const state = detailsLoaded(
      listLoaded(INITIAL_WORKBENCH, [listEntry("news"), listEntry("web")]),
      "web",
      getResult(listEntry("web"), PLAIN_MANIFEST),
    );
    const plugins = snapshotOf(state).plugins;
    expect(plugins.map((p) => [p.id, p.unread])).toEqual([
      ["news", true],
      ["web", undefined],
    ]);
    // 도구를 고르면 읽지 못한 news는 남고(모르므로 숨기지 않는다), 도구가 없다고 읽은 web은 빠진다
    expect(plugins.map((p) => [p.id, keepsContrib(p, ["tool"])])).toEqual([
      ["news", true],
      ["web", false],
    ]);
  });
});

describe("대표 플러그인이 없는 확장: 구성 요소는 대표 자리(첫 구성원 또는 첫 플러그인)가 싣는다", () => {
  // 루트 플러그인이 없는 그룹. 구성 요소(스킬, MCP)는 확장의 것이고, 대표인 첫 구성원 search가 싣는다
  const DOCS_PACK_MANIFEST: Readonly<Record<string, unknown>> = {
    schemaVersion: 2,
    name: "docs-pack",
    version: "1.0.0",
    displayName: "Docs pack",
    description: "사내 문서를 모아 준다",
    entry: "./src/index.ts",
    group: {},
    components: { skills: ["./skills/write.md"], mcpServers: "./mcp/docs.json" },
    plugins: [
      { id: "search", layer: "L2", hooks: [], provides: [{ id: "docs.search", version: "1.0.0" }] },
      { id: "notes", layer: "L3", hooks: ["input.user.before"] },
    ],
  };
  const docsEntry = listEntry("docs-pack", {
    displayName: "Docs pack",
    isGroup: true,
    plugins: [
      plugin("docs-pack/search", { id: "search", layer: "L2", inGroup: true }),
      plugin("docs-pack/notes", { id: "notes", layer: "L3", inGroup: true }),
    ],
    hookCount: 1,
  });
  function docsSnapshot(): ReturnType<typeof snapshotOf> {
    return snapshotOf(
      stateOf(
        [docsEntry],
        [
          getResult(docsEntry, DOCS_PACK_MANIFEST, [
            {
              registrationId: "docs-pack/notes",
              hook: "input.user.before",
              budgetClass: "chain",
              budgetMs: 80,
            },
          ]),
        ],
      ),
    );
  }

  test("그룹에 루트가 없으면 첫 구성원이 구성 요소를 싣고, 나머지 구성원은 비운다", () => {
    expect(validateManifest(DOCS_PACK_MANIFEST).issues).toEqual([]);
    const snap = docsSnapshot();
    expect(snap.plugins).toEqual([
      {
        id: "docs-pack/search",
        name: "search",
        layer: "L2",
        group: "docs-pack",
        origin: "user",
        version: "1.0.0",
        hooks: [],
        provides: ["docs.search"],
        pieces: [
          { kind: "skill", name: "write" },
          { kind: "mcp", name: "docs" },
        ],
        on: true,
      },
      {
        id: "docs-pack/notes",
        name: "notes",
        layer: "L3",
        group: "docs-pack",
        origin: "user",
        version: "1.0.0",
        hooks: ["input.user.before"],
        provides: [],
        pieces: [],
        on: true,
      },
    ]);
    expect(snap.groups).toEqual([
      {
        id: "docs-pack",
        name: "Docs pack",
        role: "사내 문서를 모아 준다",
        version: "1.0.0",
        origin: "user",
        members: ["docs-pack/search", "docs-pack/notes"],
      },
    ]);
  });

  test("구성 요소 거르기는 대표가 싣는 구성 요소에 맞는 구성원만 남기고, 맞는 것이 없으면 그룹이 비게 된다", () => {
    const snap = docsSnapshot();
    expect(snap.plugins.filter((p) => keepsContrib(p, ["mcp"])).map((p) => p.id)).toEqual([
      "docs-pack/search",
    ]);
    expect(snap.plugins.filter((p) => keepsContrib(p, ["skill"])).map((p) => p.id)).toEqual([
      "docs-pack/search",
    ]);
    expect(snap.plugins.filter((p) => keepsContrib(p, ["tool"])).map((p) => p.id)).toEqual([]);
  });

  test("루트가 없는 확장(그룹이 아님)은 첫 플러그인이 구성 요소를 싣는다", () => {
    const TOOLS_PACK_MANIFEST: Readonly<Record<string, unknown>> = {
      schemaVersion: 2,
      name: "tools-pack",
      version: "1.0.0",
      displayName: "Tools pack",
      entry: "./src/index.ts",
      components: { commands: ["./commands/run.md"] },
      plugins: [
        { id: "alpha", layer: "L2", hooks: [] },
        { id: "beta", layer: "L2", hooks: [] },
      ],
    };
    const toolsEntry = listEntry("tools-pack", {
      displayName: "Tools pack",
      plugins: [
        plugin("tools-pack/alpha", { id: "alpha" }),
        plugin("tools-pack/beta", { id: "beta" }),
      ],
    });
    expect(validateManifest(TOOLS_PACK_MANIFEST).issues).toEqual([]);
    const snap = snapshotOf(stateOf([toolsEntry], [getResult(toolsEntry, TOOLS_PACK_MANIFEST)]));
    expect(snap.plugins).toEqual([
      {
        id: "tools-pack/alpha",
        name: "alpha",
        layer: "L2",
        origin: "user",
        version: "1.0.0",
        hooks: [],
        provides: [],
        pieces: [{ kind: "command", name: "run" }],
        on: true,
      },
      {
        id: "tools-pack/beta",
        name: "beta",
        layer: "L2",
        origin: "user",
        version: "1.0.0",
        hooks: [],
        provides: [],
        pieces: [],
        on: true,
      },
    ]);
    expect(snap.groups).toEqual([]);
  });
});

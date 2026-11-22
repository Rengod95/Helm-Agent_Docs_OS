// 프로필 화면(C3)이 엔진 값을 캔버스로 옮기는 순수 함수(`cv6/live.ts`)와 끌어 놓기 순서, 엔진이 필요로 하는 플러그인의 잠금(`cv6/model.ts`).
// 카드, 프로필, 적용 블록은 계약 모양 그대로 만든다.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HOOK_POSITIONS, type PluginCard } from "@fresnel/contracts/extensions";
import type { BlocksAppliedResult, CommonSet, Profile } from "@fresnel/contracts/wire";
import {
  anchorOfCard,
  canvasCards,
  canvasProfileOf,
  issuesOf,
  kindOfCard,
  pluginOfCard,
  pointHooks,
  profileInputOf,
  referencedNames,
} from "../../../src/views/craft/canvas/cv6/live.ts";
import {
  installLiveCatalog,
  installSampleCatalog,
  moveOnto,
  nudge,
  placedOf,
  removePlugin,
  swapPlugins,
  type CanvasProfile,
} from "../../../src/views/craft/canvas/cv6/model.ts";
import { purposeOf } from "../../../src/views/craft/canvas/shared-meta.ts";

function card(name: string, over: Partial<PluginCard> = {}): PluginCard {
  return {
    name,
    displayName: name,
    version: "1.0.0",
    purpose: `${name} purpose`,
    does: { inject: null, hook: null, drive: null },
    enforcement: "advisory",
    runs: { code: false, isolated: null },
    cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    health: { state: "ok", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "approved", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
    ...over,
  };
}

const inject = {
  instructions: { always: [{ path: "AGENTS.md", bytes: 10 }], skills: [] },
  tools: [],
  mcpServers: [],
  agents: [],
  providers: [],
  commands: [],
  ui: [],
  replaces: [],
};

function hookCard(name: string, hook: "guard.tool.before" | "tool.call.before"): PluginCard {
  return card(name, {
    does: {
      inject: null,
      hook: { hooks: [{ name: hook, fold: "chain", position: "tools.before", powers: [] }] },
      drive: null,
    },
    runs: { code: true, isolated: true },
  });
}

const CARDS: readonly PluginCard[] = [
  card("style", { does: { inject, hook: null, drive: null } }),
  card("github", {
    does: {
      inject: { ...inject, mcpServers: [{ name: "github", transport: "stdio" }] },
      hook: null,
      drive: null,
    },
  }),
  card("helm", { does: { inject: null, hook: null, drive: { start: true, commands: [] } } }),
  hookCard("guard-a", "guard.tool.before"),
  hookCard("guard-b", "guard.tool.before"),
  hookCard("guard-c", "guard.tool.before"),
  { ...hookCard("files", "guard.tool.before"), requiredByCore: ["cap-workspace"] },
  card("core-part", { internal: true }),
];

const COMMON: CommonSet = {
  plugins: [{ name: "style" }],
  settings: [],
  updatedAt: "2026-11-22T00:00:00Z",
  rev: 3,
};

const SAVED: Profile = {
  id: "default",
  title: "기본",
  builtin: true,
  plugins: [
    { name: "style" },
    { name: "helm" },
    { name: "guard-a" },
    { name: "guard-b" },
    { name: "files" },
    { name: "guard-c" },
    { name: "gone" },
  ],
  settings: [{ key: "l1.loop.maxSteps", value: 8 }],
  startDrive: "helm",
  updatedAt: "2026-11-22T00:00:00Z",
  rev: 7,
};

// 카탈로그는 모듈 하나라 다른 시험 파일(표본을 읽는 cv6 시험)을 위해 끝나면 표본으로 되돌린다
beforeAll(() => {
  installLiveCatalog(canvasCards(CARDS, referencedNames([SAVED], COMMON)).map(pluginOfCard));
});
afterAll(() => {
  installSampleCatalog();
});

const names = (p: CanvasProfile): readonly string[] =>
  p.entries.flatMap((e) => (e.type === "plugin" ? [e.name] : e.members));

describe("카드 → 캔버스 플러그인", () => {
  test("종류: Drive 칸, Hook, 도구나 MCP 서버, 나머지는 Inject", () => {
    expect(CARDS.slice(0, 4).map((c) => kindOfCard(c))).toEqual([
      "inject",
      "tool",
      "drive",
      "hook",
    ]);
  });

  test("붙는 자리: Hook은 계약의 위치 표에서 첫 자리를 읽는다", () => {
    expect(HOOK_POSITIONS["guard.tool.before"].positions[0]).toEqual({
      kind: "block",
      block: "tools",
      side: "before",
    });
    expect(CARDS.slice(0, 4).map((c) => anchorOfCard(c))).toEqual([
      "feed:context",
      "feed:tools",
      "drive",
      "before:tools",
    ]);
  });

  test("내부 부품은 어떤 프로필이나 공통 묶음에 들었을 때만 캔버스에 선다", () => {
    expect(canvasCards(CARDS, new Set()).map((c) => c.name)).not.toContain("core-part");
    expect(canvasCards(CARDS, new Set(["core-part"])).map((c) => c.name)).toContain("core-part");
  });

  test("카드의 목적, 사용처, 엔진이 필요로 하는 곳을 그대로 옮기고 카드에 없는 작성자는 비운다", () => {
    const files = CARDS.find((c) => c.name === "files");
    const meta = files === undefined ? null : pluginOfCard(files).meta;
    expect(meta === null ? null : [purposeOf(meta), meta.requiredBy, meta.author]).toEqual([
      "files purpose",
      ["cap-workspace"],
      null,
    ]);
  });
});

describe("프로필 → 캔버스 프로필과 저장 값", () => {
  const canvas = canvasProfileOf(SAVED, COMMON);

  test("공통 묶음이 베이스이고, 프로필에서 공통과 겹친 이름은 빠진다", () => {
    expect([canvas.base, names(canvas), canvas.startDrive]).toEqual([
      ["style"],
      ["helm", "guard-a", "guard-b", "files", "guard-c", "gone"],
      "helm",
    ]);
  });

  test("저장 값은 이름, 설정을 그대로 두고 순서만 캔버스를 따른다. 공통과 겹쳐 안 보이던 이름은 끝에 남는다", () => {
    const moved = moveOnto(canvas, "guard-c", "guard-a");
    expect(profileInputOf(moved, SAVED)).toEqual({
      id: "default",
      title: "기본",
      plugins: ["helm", "guard-c", "guard-a", "guard-b", "files", "gone", "style"].map((name) => ({
        name,
      })),
      settings: [{ key: "l1.loop.maxSteps", value: 8 }],
      startDrive: "helm",
    });
  });
});

/** 도구 실행 앞 자리의 호출 순서 */
function order(p: CanvasProfile): readonly string[] {
  return placedOf(p)
    .filter((x) => x.plugin.anchor === "before:tools")
    .map((x) => x.plugin.name);
}

describe("순서 바꾸기", () => {
  const canvas = canvasProfileOf(SAVED, COMMON);

  test("위로 끌면 놓은 판 앞에, 아래로 끌면 그 뒤에 선다", () => {
    expect(order(moveOnto(canvas, "guard-c", "guard-a"))).toEqual([
      "guard-c",
      "guard-a",
      "guard-b",
      "files",
    ]);
    expect(order(moveOnto(canvas, "guard-a", "guard-c"))).toEqual([
      "guard-b",
      "files",
      "guard-c",
      "guard-a",
    ]);
  });

  test("다른 자리, 같은 판, 모르는 이름이면 그대로다", () => {
    expect(moveOnto(canvas, "helm", "guard-a")).toBe(canvas);
    expect(moveOnto(canvas, "guard-a", "guard-a")).toBe(canvas);
    expect(moveOnto(canvas, "guard-a", "gone")).toBe(canvas);
  });

  test("키보드(Alt+↓)와 같은 한 칸 옮기기는 같은 자리의 이웃과 맞바꾼다", () => {
    expect(order(nudge(canvas, "guard-a", 1))).toEqual(["guard-b", "guard-a", "files", "guard-c"]);
  });

  test("블록 상세의 앞뒤 단추는 그 Hook 차례의 이웃과 프로필 자리를 맞바꾼다(판 자리가 달라도)", () => {
    expect(order(swapPlugins(canvas, "guard-b", "guard-c"))).toEqual([
      "guard-a",
      "guard-c",
      "files",
      "guard-b",
    ]);
    expect(names(swapPlugins(canvas, "helm", "guard-c"))).toEqual([
      "guard-c",
      "guard-a",
      "guard-b",
      "files",
      "helm",
      "gone",
    ]);
  });

  test("베이스(공통 묶음)나 프로필 밖 이름과는 맞바꾸지 않는다", () => {
    expect(swapPlugins(canvas, "guard-a", "style")).toBe(canvas);
    expect(swapPlugins(canvas, "guard-a", "nowhere")).toBe(canvas);
  });
});

describe("엔진이 필요로 하는 플러그인", () => {
  const canvas = canvasProfileOf(SAVED, COMMON);

  test("프로필에서 뺄 수 없다(미리 잠근다)", () => {
    expect(removePlugin(canvas, "files")).toEqual({ ok: false, reason: "required" });
  });

  test("엔진이 늘 먼저 부르므로 순서도 옮기지 않는다(끌기, 키보드, 블록 상세 단추 모두)", () => {
    expect([
      moveOnto(canvas, "files", "guard-a"),
      moveOnto(canvas, "guard-a", "files"),
      nudge(canvas, "files", -1),
      nudge(canvas, "guard-b", 1),
      swapPlugins(canvas, "guard-b", "files"),
    ]).toEqual([canvas, canvas, canvas, canvas, canvas]);
  });

  test("다른 플러그인은 뺄 수 있다", () => {
    const r = removePlugin(canvas, "guard-b");
    expect(r.ok ? r.removed : null).toEqual(["guard-b"]);
  });
});

describe("블록 상세", () => {
  const applied: BlocksAppliedResult = {
    profileId: "default",
    blocks: [
      {
        id: "tools",
        settings: [],
        parts: [],
        handlers: [
          { hook: "guard.tool.before", plugin: "guard-b", order: 1 },
          { hook: "guard.tool.before", plugin: "guard-a", order: 0 },
          { hook: "guard.tool.before", plugin: "files", order: 2 },
          { hook: "tool.execution.after", plugin: "guard-c", order: 0 },
        ],
      },
    ],
  };
  const positions = [HOOK_POSITIONS["guard.tool.before"], HOOK_POSITIONS["tool.execution.after"]];

  test("이 자리의 Hook마다 엔진의 디스패치 순서대로 선다. 다른 자리의 Hook은 빠진다", () => {
    expect(pointHooks(applied, positions, "before:tools")).toEqual([
      { hook: "guard.tool.before", plugins: ["guard-a", "guard-b", "files"] },
    ]);
  });

  test("이슈는 이 자리 플러그인에 걸린 것만(상대가 `이름/id`여도)", () => {
    const issues = [
      {
        code: "replace_conflict",
        severity: "error",
        plugin: "guard-a",
        other: "x/edit",
        tool: "edit",
      },
      { code: "replace_conflict", severity: "error", plugin: "x", other: "guard-b/edit" },
      { code: "plugin_unknown", severity: "warning", plugin: "elsewhere" },
    ] as const;
    expect(issuesOf(issues, ["guard-a", "guard-b"]).map((i) => i.plugin)).toEqual(["guard-a", "x"]);
  });
});

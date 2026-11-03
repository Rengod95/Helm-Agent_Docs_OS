// 성능 기록과 시험에 쓰는 결정적 스냅샷. 앞 18개는 wb-v5 시안의 플러그인을 옮긴 것이고(이름은 영문, 문구는 두지 않는다),
// 나머지는 고정 시드 LCG로 만든다. 같은 count는 언제나 같은 값을 준다.
import { Bug } from "@fresnel/contracts";
import { HOOKS, OTHER_HOOKS } from "./hooks.ts";
import type {
  CanvasGroup,
  CanvasHealth,
  CanvasPiece,
  CanvasPlugin,
  CanvasSnapshot,
  LayerKey,
  Origin,
  PieceKind,
} from "./types.ts";

/** 시안의 훅 줄 순서(INITIAL_ORDER). 앞 18개에 이 순서를 주면 시안과 같은 줄이 된다 */
export const FIXTURE_ORDER: Readonly<Record<string, readonly string[]>> = {
  "thread.start": ["helm"],
  "input.user.before": ["pr-kit"],
  "input.agent.before": ["helm", "review/lens"],
  "request.provider.before": ["cost-router"],
  "guard.model.before": [],
  "request.model.after": ["cost-router"],
  "tool.call.before": ["secret-scan", "helm"],
  "tool.result": ["acme-notes"],
  "tool.execution.after": ["lint-on-edit", "helm"],
  "boundary.step.after": [],
  "boundary.settle.after": ["helm", "learning", "review", "notify-done"],
  "thread.compact.before": ["compact-keep"],
  "thread.shutdown": ["learning"],
};

const SEED = 20261104;
/** 생성 확장 8개마다 그룹 하나를 만든다. 앞 3개가 그 구성원이다 */
const GROUP_BLOCK = 8;
const GROUP_SLOTS = 3;
const HOOK_POOL: readonly string[] = [...HOOKS.map((h) => h.id), ...OTHER_HOOKS.map((h) => h.id)];
const PIECE_KINDS: readonly PieceKind[] = ["skill", "command", "tool", "mcp", "agent", "view"];

type Seed = Pick<CanvasPlugin, "id" | "name" | "layer" | "origin"> & Partial<CanvasPlugin>;

const unit = (seed: Seed): CanvasPlugin => ({
  hooks: [],
  provides: [],
  pieces: [],
  on: true,
  ...seed,
});

const piece = (kind: PieceKind, name: string): CanvasPiece => ({ kind, name });

const MOCK_PLUGINS: readonly CanvasPlugin[] = [
  unit({
    id: "helm",
    name: "Helm",
    layer: "L3",
    group: "helm",
    origin: "builtin",
    version: "0.4.0",
    drives: true,
    hooks: [
      "thread.start",
      "input.agent.before",
      "tool.call.before",
      "tool.execution.after",
      "boundary.settle.after",
      "lifecycle.lease.rejected",
    ],
    optional: ["web.search", "knowledge.search", "work.tasks"],
    reads: ["grp.learning.memory.*"],
    pieces: [piece("command", "/explore")],
    health: {
      fails: 1,
      hook: "boundary.settle.after",
      text: "response limit 1.2s exceeded",
      at: "14:01",
      limit: 5,
    },
  }),
  unit({
    id: "helm/explore",
    name: "Explore feature",
    layer: "L2",
    group: "helm",
    origin: "builtin",
    version: "0.4.0",
    provides: ["helm.inquiry"],
    pieces: [
      piece("tool", "lens_search"),
      piece("agent", "explorer"),
      piece("skill", "explore-method"),
    ],
  }),
  unit({
    id: "helm/panel",
    name: "Helm panel",
    layer: "L3",
    group: "helm",
    origin: "builtin",
    version: "0.4.0",
    pieces: [piece("view", "Helm explore")],
  }),
  unit({
    id: "learning",
    name: "Learning",
    layer: "L3",
    group: "learning",
    origin: "builtin",
    version: "0.4.0",
    hooks: ["boundary.settle.after", "thread.shutdown"],
    requires: ["knowledge.memory"],
    pieces: [piece("skill", "write-lesson"), piece("command", "/learn")],
  }),
  unit({
    id: "learning/ledger",
    name: "Memory ledger",
    layer: "L2",
    group: "learning",
    origin: "builtin",
    version: "0.4.0",
    provides: ["knowledge.memory"],
    records: ["grp.learning.memory.written"],
    pieces: [piece("tool", "memory_write")],
  }),
  unit({
    id: "review",
    name: "Review",
    layer: "L3",
    group: "review",
    origin: "user",
    version: "0.2.1",
    hooks: ["boundary.settle.after"],
    requires: ["knowledge.search"],
    pieces: [piece("command", "/review")],
    health: {
      fails: 5,
      hook: "boundary.settle.after",
      text: "failed 5 times in a row, auto-off",
      at: "13:40",
      limit: 5,
      autoOff: true,
    },
  }),
  unit({
    id: "review/lens",
    name: "Review lens",
    layer: "L3",
    group: "review",
    origin: "user",
    version: "0.2.1",
    hooks: ["input.agent.before"],
    pieces: [piece("agent", "reviewer")],
  }),
  unit({
    id: "web",
    name: "Web",
    layer: "L2",
    origin: "builtin",
    version: "0.4.0",
    provides: ["web.search", "web.fetch"],
    pieces: [piece("tool", "web_search"), piece("tool", "web_fetch")],
  }),
  unit({
    id: "exa",
    name: "Exa search",
    layer: "plugin",
    origin: "user",
    version: "1.0.3",
    on: false,
    provides: ["web.search"],
    pieces: [piece("tool", "exa_search")],
  }),
  unit({
    id: "knowledge",
    name: "Knowledge",
    layer: "L2",
    origin: "builtin",
    version: "0.4.0",
    provides: ["knowledge.search", "knowledge.skills"],
    reads: ["x.acme-notes.note.*"],
    pieces: [piece("tool", "skill_load"), piece("tool", "knowledge_search")],
  }),
  unit({
    id: "work",
    name: "Work",
    layer: "L2",
    origin: "builtin",
    version: "0.4.0",
    provides: ["work.tasks"],
    pieces: [piece("tool", "task_create"), piece("command", "/todo")],
  }),
  unit({
    id: "cost-router",
    name: "Cost router",
    layer: "L1",
    origin: "user",
    version: "0.1.0",
    hooks: ["request.provider.before", "request.model.after"],
  }),
  unit({
    id: "compact-keep",
    name: "Keep summary",
    layer: "L1",
    origin: "user",
    version: "0.1.0",
    on: false,
    hooks: ["thread.compact.before"],
    pieces: [piece("skill", "keep-decisions")],
  }),
  unit({
    id: "secret-scan",
    name: "Secret scan",
    layer: "plugin",
    origin: "user",
    version: "0.2.0",
    hooks: ["tool.call.before"],
  }),
  unit({
    id: "lint-on-edit",
    name: "Lint on edit",
    layer: "plugin",
    origin: "user",
    version: "0.1.2",
    hooks: ["tool.execution.after"],
    pieces: [piece("command", "/lint")],
  }),
  unit({
    id: "notify-done",
    name: "Notify done",
    layer: "plugin",
    origin: "user",
    version: "0.1.0",
    hooks: ["boundary.settle.after"],
  }),
  unit({
    id: "acme-notes",
    name: "acme notes",
    layer: "plugin",
    origin: "project",
    version: "0.0.9",
    hooks: ["tool.result"],
    provides: ["notes.search"],
    records: ["x.acme-notes.note.indexed"],
    pieces: [piece("mcp", "acme-wiki"), piece("skill", "acme-style")],
    health: {
      fails: 2,
      hook: "tool.result",
      text: "notes.search timed out",
      at: "14:03",
      limit: 5,
    },
  }),
  unit({
    id: "pr-kit",
    name: "PR kit",
    layer: "plugin",
    origin: "user",
    version: "0.3.0",
    hooks: ["input.user.before"],
    pieces: [
      piece("skill", "pr-review"),
      piece("skill", "release-notes"),
      piece("command", "/pr"),
      piece("command", "/changelog"),
      piece("mcp", "github"),
    ],
  }),
];

const MOCK_GROUPS: readonly CanvasGroup[] = [
  {
    id: "helm",
    name: "Helm",
    version: "0.4.0",
    origin: "builtin",
    members: ["helm", "helm/explore", "helm/panel"],
    config: "maxLenses: 3",
  },
  {
    id: "learning",
    name: "Learning",
    version: "0.4.0",
    origin: "builtin",
    members: ["learning", "learning/ledger"],
  },
  {
    id: "review",
    name: "Review",
    version: "0.2.1",
    origin: "user",
    members: ["review", "review/lens"],
    config: "maxFailures: 5",
  },
];

/** 시드 LCG(Numerical Recipes 상수). 0 이상 1 미만의 값을 낸다 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** r(0 이상 1 미만)에 해당하는 항목. 목록이 비어 있으면 불변 조건이 깨진 것이다 */
function pick<T>(list: readonly T[], r: number): T {
  const item = list[Math.floor(r * list.length)];
  if (item === undefined) throw new Bug("pick from an empty list");
  return item;
}

function layerFor(r: number, grouped: boolean, root: boolean): LayerKey {
  if (root) return "L3";
  if (grouped) return r < 0.5 ? "L2" : "L3";
  if (r < 0.15) return "L1";
  if (r < 0.45) return "L2";
  return r < 0.6 ? "L3" : "plugin";
}

function originFor(r: number): Origin {
  if (r < 0.2) return "builtin";
  return r < 0.8 ? "user" : "project";
}

/** i번째 생성 확장. 그룹에 든 것은 루트(slot 0)와 두 구성원이다. 요구는 앞에 나온 제공자만 가리킨다 */
function genericPlugin(i: number, rand: () => number, provided: readonly string[]): CanvasPlugin {
  const block = Math.floor(i / GROUP_BLOCK);
  const slot = i % GROUP_BLOCK;
  const grouped = slot < GROUP_SLOTS;
  const gid = `fx-g${block}`;
  const id = grouped ? (slot === 0 ? gid : `${gid}/${slot === 1 ? "a" : "b"}`) : `fx-${i}`;
  const layer = layerFor(rand(), grouped, slot === 0);
  const origin = grouped ? "user" : originFor(rand());

  const hooks: string[] = [];
  const hookCount = Math.floor(rand() * 3);
  for (let k = 0; k < hookCount; k++) {
    const h = pick(HOOK_POOL, rand());
    if (!hooks.includes(h)) hooks.push(h);
  }
  const on = rand() >= 0.15;

  // 실패는 훅을 가진 플러그인에만 붙는다(실패가 어느 훅에서 났는지 적어야 하므로)
  const failing = rand() < 0.2;
  const fails = 1 + Math.floor(rand() * 5);
  const [firstHook] = hooks;
  const health: CanvasHealth | undefined =
    failing && firstHook !== undefined
      ? {
          fails,
          hook: firstHook,
          text: fails >= 5 ? "failed 5 times in a row, auto-off" : "response limit exceeded",
          at: `13:${String(i % 60).padStart(2, "0")}`,
          limit: 5,
          ...(fails >= 5 ? { autoOff: true } : {}),
        }
      : undefined;

  const provides = layer === "L2" && rand() < 0.7 ? [`fx.cap.${i % 6}`] : [];
  const requires: string[] = [];
  if ((layer === "L3" || layer === "plugin") && provided.length > 0 && rand() < 0.25) {
    const cap = pick(provided, rand());
    if (!provides.includes(cap)) requires.push(cap);
  }

  const pieceCount = Math.floor(rand() * 3);
  const pieces: CanvasPiece[] = [];
  for (let k = 0; k < pieceCount; k++) {
    const kind = pick(PIECE_KINDS, rand());
    pieces.push(piece(kind, `fx-${i}-${kind}-${k}`));
  }

  const drives = rand() < 0.06;
  const records = rand() < 0.1 ? [`x.fx.topic${i % 4}.written`] : [];
  const readTopic = Math.floor(rand() * 4);
  const reads = rand() < 0.1 ? [`x.fx.topic${readTopic}.*`] : [];

  return {
    id,
    name: `Fixture ${i}`,
    layer,
    origin,
    version: `0.${1 + (i % 5)}.${i % 10}`,
    ...(grouped ? { group: gid } : {}),
    hooks,
    provides,
    ...(requires.length > 0 ? { requires } : {}),
    pieces,
    ...(drives ? { drives: true } : {}),
    ...(records.length > 0 ? { records } : {}),
    ...(reads.length > 0 ? { reads } : {}),
    on,
    ...(health === undefined ? {} : { health }),
  };
}

/** 생성 확장이 든 그룹. 구성원은 group 필드로 모은다(그룹과 구성원이 어긋나지 않게 한 곳에서 만든다) */
function genericGroups(plugins: readonly CanvasPlugin[]): CanvasGroup[] {
  const mockIds = new Set(MOCK_GROUPS.map((g) => g.id));
  const ids = [
    ...new Set(
      plugins.flatMap((p) => (p.group === undefined || mockIds.has(p.group) ? [] : [p.group])),
    ),
  ];
  const out: CanvasGroup[] = [];
  for (const [n, gid] of ids.entries()) {
    out.push({
      id: gid,
      name: `Fixture group ${n}`,
      version: `0.${1 + (n % 3)}.0`,
      origin: "user",
      members: plugins.filter((p) => p.group === gid).map((p) => p.id),
      ...(n % 3 === 0 ? { config: "maxFailures: 5" } : {}),
    });
  }
  return out;
}

/**
 * count개 확장의 스냅샷. 확장 수는 plugins 항목 수다(그룹은 세지 않는다). count는 18 이상의 정수다.
 */
export function buildFixture(count: number): CanvasSnapshot {
  if (!Number.isInteger(count) || count < MOCK_PLUGINS.length) {
    throw new Bug(
      `fixture count must be an integer of at least ${MOCK_PLUGINS.length}, got ${count}`,
    );
  }
  const rand = seededRandom(SEED);
  const provided = MOCK_PLUGINS.flatMap((p) => p.provides);
  const generic: CanvasPlugin[] = [];
  for (let i = 0; i < count - MOCK_PLUGINS.length; i++) {
    const p = genericPlugin(i, rand, provided);
    generic.push(p);
    provided.push(...p.provides);
  }
  const plugins = [...MOCK_PLUGINS, ...generic];
  return { plugins, groups: [...MOCK_GROUPS, ...genericGroups(plugins)] };
}

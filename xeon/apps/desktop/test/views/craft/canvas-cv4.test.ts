// cv4 "G3" 시안의 순수 값: 확대 단계, 상세 패널 "작동 방식"의 네 줄(시점·입력·영향·출력)에 내부 이름이 없는가,
// 같은 자리에 여럿이 붙을 때의 소켓(줄기 하나와 수), 더미 안의 순서, 핸드오프가 들어오는 변, 판끼리 겹치지 않는 배치.
// 값은 공용 표본(`shared-sample.ts`)과 메타(`shared-meta.ts`), cv4의 합성 Hook 표(`sample-ext.ts`)에서 읽는다.
import { describe, expect, test } from "bun:test";
import { HOOKS, type HookName } from "@fresnel/contracts/extensions";
import {
  foldsOf,
  merge,
  pluginFacts,
  type Fact,
} from "../../../src/views/craft/canvas/cv4/facts.ts";
import {
  layoutProfile,
  PLATE_H,
  RAIL_HALF,
  type Rect,
} from "../../../src/views/craft/canvas/cv4/layout.ts";
import { LOD_EDGE, lodOf } from "../../../src/views/craft/canvas/cv4/lod.ts";
import {
  attachProfile,
  pluginOf,
  profileFromSample,
  type Plugin,
} from "../../../src/views/craft/canvas/cv4/model.ts";

const P = "desktop.craft.canvas.cv3.fact.";

const short = (xs: readonly Fact[]): (string | number | null)[][] =>
  xs.map((f) => [f.word.slice(P.length), f.value, f.count, f.at]);

function must(name: string): Plugin {
  const p = pluginOf(name);
  if (p === undefined) throw new Error(`표본에 ${name}이 없다`);
  return p;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const HOOK_NAMES: ReadonlySet<string> = new Set(Object.keys(HOOKS));

/** 칩에 실린 값 가운데 계약의 Hook 이름이거나 그 플러그인의 내부 id(기능 id·기록 종류)인 것 */
function internalValues(p: Plugin, xs: readonly Fact[]): string[] {
  const m = p.meta;
  const ids = new Set([
    ...[...m.requires, ...m.optional, ...m.provides].map((c) => c.id),
    ...m.recordKinds,
    ...m.readsRecordKinds,
  ]);
  return xs
    .flatMap((f) => (f.value === null ? [] : f.value.split(", ")))
    .filter((v) => HOOK_NAMES.has(v) || ids.has(v));
}

describe("lodOf", () => {
  test("처음 여는 60%는 중간, 100%는 가까이, 48% 아래는 멀리", () => {
    expect([0.3, LOD_EDGE.mid - 0.01, 0.6, 0.8, 1].map(lodOf)).toEqual([
      "far",
      "far",
      "mid",
      "mid",
      "near",
    ]);
  });
});

describe("pluginFacts", () => {
  test("helm: 같은 자리 칩은 하나, Hook 이름·기능 id·기록 종류는 수로만", () => {
    const f = pluginFacts(must("helm"), { start: true, handoffFrom: [] });
    expect(short(f.when)).toEqual([
      ["when.start", null, 1, null],
      ["when.event", null, 1, "before:context"],
      ["when.event", null, 1, "before:tools"],
      ["when.event", null, 1, "after:tools"],
      ["when.event", null, 1, null],
      ["when.event", null, 1, "boundary:conversation-start"],
    ]);
    expect(short(f.reads)).toEqual([
      ["reads.kind.input", null, 1, null],
      ["reads.kind.tool", null, 1, null],
      ["reads.kind.boundary", null, 1, null],
      ["reads.kind.thread", null, 1, null],
      ["reads.file", "helm.md", 1, null],
      ["reads.optional", null, 6, null],
    ]);
    expect(short(f.changes)).toEqual([
      ["changes.holdsTurn", null, 1, null],
      ["changes.contribute", null, 1, null],
      ["changes.decide", null, 1, null],
    ]);
    expect(short(f.gives)).toEqual([
      ["gives.handoff", "verifier", 1, null],
      ["gives.record", null, 2, null],
    ]);
  });

  test("표본의 모든 플러그인에서 칩 값에 내부 이름이 없다", () => {
    const names = [
      "helm",
      "verifier",
      "secret-guard",
      "lint-on-edit",
      "cost-cap",
      "commit-msg",
      "memory",
      "house-style",
      "github-mcp",
    ];
    const leaks = names.flatMap((n) => {
      const f = pluginFacts(must(n), { start: false, handoffFrom: [] });
      return internalValues(must(n), [...f.when, ...f.reads, ...f.changes, ...f.gives]).map(
        (v) => `${n}:${v}`,
      );
    });
    expect(leaks).toEqual([]);
  });

  test("github-mcp: 사람이 적는 이름(서버·환경 변수)과 쓰는 도구 수는 남는다", () => {
    const f = pluginFacts(must("github-mcp"), { start: false, handoffFrom: [] });
    expect([short(f.when), short(f.reads), short(f.changes), short(f.gives)]).toEqual([
      [["when.modelCalls", "github", 1, null]],
      [
        ["reads.needs", null, 1, null],
        ["reads.env", "GITHUB_TOKEN", 1, null],
      ],
      [["changes.writeTools", "4/12", 1, null]],
      [
        ["gives.tools", "12", 1, null],
        ["gives.capability", null, 1, null],
      ],
    ]);
  });
});

const at = (anchor: "before:tools" | "after:tools"): Fact => ({
  word: "desktop.craft.canvas.cv3.fact.when.event",
  value: null,
  warn: false,
  at: anchor,
  count: 1,
});
const plain = (value: string | null): Fact => ({
  word: "desktop.craft.canvas.cv3.fact.reads.file",
  value,
  warn: false,
  at: null,
  count: 1,
});

describe("merge", () => {
  test("같은 자리 칩은 하나만 남고 수를 늘리지 않는다", () => {
    expect(short(merge([at("before:tools"), at("after:tools"), at("before:tools")]))).toEqual([
      ["when.event", null, 1, "before:tools"],
      ["when.event", null, 1, "after:tools"],
    ]);
  });

  test("값이 없는 칩은 수를 더하고, 값이 있는 칩은 값을 잇는다", () => {
    expect(short(merge([plain(null), plain("a.md"), plain(null), plain("b.md")]))).toEqual([
      ["reads.file", null, 2, null],
      ["reads.file", "a.md, b.md", 1, null],
    ]);
  });
});

describe("foldsOf", () => {
  test("Hook 하나는 합치는 방식 하나, helm은 중복 없이", () => {
    const hooks: readonly HookName[] = must("helm").meta.hooks;
    expect([foldsOf(must("secret-guard")), foldsOf(must("helm")), hooks.length]).toEqual([
      ["first"],
      ["collect", "first", "tap"],
      5,
    ]);
  });
});

describe("layoutProfile", () => {
  test("노드 30개 장면에서도 판끼리 겹치지 않는다", () => {
    const l = layoutProfile(profileFromSample("scale"), new Set());
    const hits = l.plates.flatMap((a, i) =>
      l.plates
        .slice(i + 1)
        .flatMap((b) =>
          overlaps(a, b) ? [`${a.placed.plugin.name}×${b.placed.plugin.name}`] : [],
        ),
    );
    expect(hits).toEqual([]);
  });

  test("빌더 윤곽은 어느 장면에서도 판과 겹치지 않는다", () => {
    const hits = (["dev", "scale"] as const).flatMap((id) => {
      const l = layoutProfile(profileFromSample(id), new Set());
      const b = l.builder;
      return b === null
        ? []
        : l.plates.filter((p) => overlaps(p, b)).map((p) => `${id}:${p.placed.plugin.name}`);
    });
    expect(hits).toEqual([]);
  });

  test("한 자리에 1·5·20개: 소켓은 하나, 수는 붙은 판 수, 판은 겹치지 않는다", () => {
    const out = [1, 5, 20].map((n) => {
      const l = layoutProfile(attachProfile(n), new Set());
      const at = l.sockets.filter((s) => s.anchor === "before:tools");
      const plates = l.plates.filter((p) => p.placed.plugin.anchor === "before:tools");
      const hits = plates.filter((a, i) => plates.slice(i + 1).some((b) => overlaps(a, b)));
      return [at.length, at[0]?.count, plates.length, hits.length];
    });
    expect(out).toEqual([
      [1, 1, 1, 0],
      [1, 5, 5, 0],
      [1, 20, 20, 0],
    ]);
  });

  test("한 자리의 순서: 번호는 1부터 이어지고, 레일에서 가까운 판이 먼저다", () => {
    const l = layoutProfile(attachProfile(5), new Set());
    const plates = l.plates
      .filter((p) => p.placed.plugin.anchor === "before:tools")
      .map((p) => ({
        order: p.placed.order,
        dist: Math.abs(p.y + (p.lip === "top" ? 0 : PLATE_H)),
      }));
    const byOrder = plates.toSorted((a, b) => a.order - b.order);
    expect(byOrder.map((p) => p.order)).toEqual([1, 2, 3, 4, 5]);
    // 같은 열 안에서는 번호가 클수록 레일에서 멀다(열이 둘 이상이면 열마다)
    const rows = new Set(byOrder.map((p) => p.dist));
    expect(rows.size).toBeGreaterThan(1);
    expect(Math.min(...byOrder.map((p) => p.dist))).toBeGreaterThanOrEqual(RAIL_HALF);
  });

  test("개발 프로필: helm은 핸드오프를 내보내고, verifier는 사이의 판을 피해 아래 변으로 받는다", () => {
    const l = layoutProfile(profileFromSample("dev"), new Set());
    const g = (n: string) => l.plates.find((p) => p.placed.plugin.name === n);
    expect([g("helm")?.handoffOut, g("verifier")?.handoffIn, g("lint-on-edit")?.handoffIn]).toEqual(
      [true, "bottom", null],
    );
  });
});

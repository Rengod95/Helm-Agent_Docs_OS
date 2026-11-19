// cv3 "G2" 시안의 순수 값: 확대 단계와 단계마다 보이는 칸, 판의 상태 표시, 상세 패널 "설명과 동작"의 네 줄과
// "작동"의 Hook 줄(계약의 HOOKS·HOOK_POSITIONS에서), 판끼리 겹치지 않는 배치, 베이스 판정.
// 값은 공용 표본(`shared-sample.ts`)과 F·G·H가 함께 보는 메타(`shared-meta.ts`)에서 읽는다.
import { describe, expect, test } from "bun:test";
import { hookRows, pluginFacts, type Fact } from "../../../src/views/craft/canvas/cv3/facts.ts";
import { layoutProfile, type Rect } from "../../../src/views/craft/canvas/cv3/layout.ts";
import {
  LOD_EDGE,
  lodOf,
  PLATE_FIELDS,
  plateMarks,
} from "../../../src/views/craft/canvas/cv3/lod.ts";
import {
  isBaseOf,
  placedOf,
  pluginOf,
  profileFromSample,
  type Plugin,
} from "../../../src/views/craft/canvas/cv3/model.ts";

const P = "desktop.craft.canvas.cv3.fact.";

const short = (xs: readonly Fact[]): (string | boolean | null)[][] =>
  xs.map((f) => [f.word.slice(P.length), f.value, f.warn, f.at]);

function must(name: string): Plugin {
  const p = pluginOf(name);
  if (p === undefined) throw new Error(`표본에 ${name}이 없다`);
  return p;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("lodOf", () => {
  test("경계 값에서 다음 단계로 넘어간다", () => {
    expect([0.2, 0.47, LOD_EDGE.mid, 0.6, 0.84, LOD_EDGE.near, 1, 1.6].map(lodOf)).toEqual([
      "far",
      "far",
      "mid",
      "mid",
      "mid",
      "near",
      "near",
      "near",
    ]);
  });

  test("단계마다 판에 보이는 칸: 구성 요소 수나 붙는 자리 문구는 없다", () => {
    expect(PLATE_FIELDS).toEqual({
      far: ["tile", "name", "status"],
      mid: ["tile", "name", "purpose", "status"],
      near: ["tile", "name", "kind", "purpose", "status"],
    });
  });
});

describe("plateMarks", () => {
  test("개발 프로필: 베이스, 리뷰 대기, 스타트, 드래프트", () => {
    const marks = placedOf(profileFromSample("dev")).map((p) => [p.plugin.name, plateMarks(p)]);
    expect(marks).toEqual([
      ["memory", ["base"]],
      ["secret-guard", ["base"]],
      ["house-style", []],
      ["repo-skills", []],
      ["lint-on-edit", ["pending"]],
      ["verifier", []],
      ["cost-cap", []],
      ["helm", ["start"]],
      ["github-mcp", []],
      ["commit-msg", ["draft"]],
    ]);
  });
});

describe("hookRows", () => {
  test("helm: 매니페스트 hooks마다 계약의 자리·합치는 방식·powers", () => {
    expect(hookRows(must("helm"))).toEqual([
      {
        hook: "input.agent.before",
        anchor: "before:context",
        fold: "collect",
        powers: ["contribute"],
      },
      { hook: "tool.call.before", anchor: "before:tools", fold: "first", powers: ["decide"] },
      { hook: "tool.execution.after", anchor: "after:tools", fold: "tap", powers: ["observe"] },
      { hook: "boundary.settle.after", anchor: null, fold: "tap", powers: ["observe"] },
      {
        hook: "thread.start",
        anchor: "boundary:conversation-start",
        fold: "tap",
        powers: ["observe"],
      },
    ]);
  });

  test("Hook이 없는 도구는 빈 목록", () => {
    expect(hookRows(must("github-mcp"))).toEqual([]);
  });
});

describe("pluginFacts", () => {
  test("helm(스타트 Drive): 언제·읽나·바꾸나·내나", () => {
    const f = pluginFacts(must("helm"), { start: true, handoffFrom: [] });
    expect(short(f.when)).toEqual([
      ["when.start", null, false, null],
      ["when.event", "input.agent.before", false, "before:context"],
      ["when.event", "tool.call.before", false, "before:tools"],
      ["when.event", "tool.execution.after", false, "after:tools"],
      ["when.event", "boundary.settle.after", false, null],
      ["when.event", "thread.start", false, "boundary:conversation-start"],
    ]);
    expect(short(f.reads)).toEqual([
      ["reads.kind.input", null, false, null],
      ["reads.kind.tool", null, false, null],
      ["reads.kind.boundary", null, false, null],
      ["reads.kind.thread", null, false, null],
      ["reads.file", "helm.md", false, null],
      [
        "reads.optional",
        "web.search, web.fetch, knowledge.search, knowledge.skills, knowledge.memory, work.tasks",
        false,
        null,
      ],
    ]);
    expect(short(f.changes)).toEqual([
      ["changes.holdsTurn", null, false, null],
      ["changes.contribute", "input.agent.before", false, null],
      ["changes.decide", "tool.call.before", false, null],
    ]);
    expect(short(f.gives)).toEqual([
      ["gives.handoff", "verifier", false, null],
      ["gives.record", "grp.helm.signal.detected, grp.helm.discovery.recorded", false, null],
    ]);
  });

  test("helm이 스타트가 아니고 넘겨받지도 않으면 고를 때 턴을 쥔다", () => {
    const f = pluginFacts(must("helm"), { start: false, handoffFrom: [] });
    expect(short(f.when)[0]).toEqual(["when.picked", null, false, null]);
  });

  test("verifier는 넘겨주는 Drive마다 한 줄", () => {
    const f = pluginFacts(must("verifier"), { start: false, handoffFrom: ["helm"] });
    expect(short(f.when)[0]).toEqual(["when.handoffIn", "helm", false, null]);
  });

  test("secret-guard: 도구 실행 앞에서 막는다", () => {
    const f = pluginFacts(must("secret-guard"), { start: false, handoffFrom: [] });
    expect([short(f.when), short(f.reads), short(f.changes), short(f.gives)]).toEqual([
      [["when.event", "guard.tool.before", false, "before:tools"]],
      [["reads.kind.guard", null, false, null]],
      [["changes.decide", "guard.tool.before", false, null]],
      [["gives.block", null, false, null]],
    ]);
  });

  test("github-mcp: 쓰는 도구는 경고, 환경 변수는 이름만", () => {
    const f = pluginFacts(must("github-mcp"), { start: false, handoffFrom: [] });
    expect([short(f.when), short(f.reads), short(f.changes), short(f.gives)]).toEqual([
      [["when.modelCalls", "github", false, null]],
      [
        ["reads.needs", "mcp.client", false, null],
        ["reads.env", "GITHUB_TOKEN", false, null],
      ],
      [["changes.writeTools", "4/12", true, null]],
      [
        ["gives.tools", "12", false, null],
        ["gives.capability", "github.issues", false, null],
      ],
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
});

describe("isBaseOf", () => {
  test("베이스만 참", () => {
    const dev = profileFromSample("dev");
    expect(["memory", "secret-guard", "helm", "web-research"].map((n) => isBaseOf(dev, n))).toEqual(
      [true, true, false, false],
    );
  });
});

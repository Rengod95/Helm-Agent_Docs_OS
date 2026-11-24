// 구성 탭 루프 캔버스(plugHead, AGE-76)의 순수 모델과 배치: 계약 위치를 캔버스 자리로 옮기는 규칙, 카드의 Inject 목록을 블록마다 묶는 것,
// 매니페스트 훅 줄과 카드 훅 이름 중 무엇을 쓰는지, Drive가 언제 서는지, 자리마다 훅 묶기, 그리고 배치의 지점 순서와 카드가 겹치지 않는 것을 본다.
import { describe, expect, test } from "bun:test";
import type { BlockRow, InspectHookVM } from "@fresnel/client/workbench";
import type { PluginCard } from "@fresnel/contracts/extensions";
import { loopLayoutOf, type Rect } from "../../../src/views/craft/loop/loop-layout.ts";
import {
  hookLinesOf,
  hooksBySpot,
  loopFeedsOf,
  loopHookOf,
  loopPlanOf,
  outsideOf,
  pickKey,
  pickedSpotsOf,
  RAIL_POINTS,
  spotKey,
  spotOfPosition,
  stepSpotsOf,
  usedPointsOf,
  type LoopPlan,
} from "../../../src/views/craft/loop/loop-model.ts";

function card(does: Partial<PluginCard["does"]> = {}): PluginCard {
  return {
    name: "kit",
    displayName: "킷",
    purpose: "목적",
    does: { inject: null, hook: null, drive: null, ...does },
    enforcement: "advisory",
    runs: { code: false, isolated: null },
    cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    health: { state: "ok", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "approved", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
  };
}

type Inject = NonNullable<PluginCard["does"]["inject"]>;

function inject(over: Partial<Inject> = {}): Inject {
  return {
    instructions: { always: [], skills: [] },
    tools: [],
    mcpServers: [],
    agents: [],
    providers: [],
    commands: [],
    ui: [],
    replaces: [],
    ...over,
  };
}

function hookRow(hook: string, p95Ms: number | null = null): InspectHookVM {
  return {
    hook,
    registrationId: `kit:${hook}`,
    fold: null,
    budgetClass: "fast",
    budgetMs: 50,
    p95Ms,
    failures: null,
    level: null,
  };
}

function step(id: string, hooks: readonly string[]): BlockRow {
  return {
    id,
    title: id,
    stage: "detect",
    op: "on",
    summary: null,
    hooks,
    consumes: [],
    produces: [],
    plugin: null,
    memberTitle: null,
  };
}

describe("계약 위치를 캔버스 자리로(plugHead)", () => {
  test("블록 위치는 그 블록의 앞이나 뒤 문, 경계는 경계 위, 닻 없는 소식은 기록 위, 엔진 안은 루프 밖이다", () => {
    expect(spotOfPosition({ kind: "block", block: "tools", side: "before" })).toEqual({
      kind: "gate",
      block: "tools",
      side: "before",
    });
    expect(spotOfPosition({ kind: "boundary", boundary: "input-received" })).toEqual({
      kind: "on",
      point: "input-received",
    });
    expect(spotOfPosition({ kind: "event" })).toEqual({ kind: "on", point: "record" });
    expect(spotOfPosition({ kind: "event", anchor: { block: "model", side: "after" } })).toEqual({
      kind: "gate",
      block: "model",
      side: "after",
    });
    expect(spotOfPosition({ kind: "internal" })).toEqual({ kind: "outside" });
  });

  test("훅 하나는 계약의 위치, fold, 할 수 있는 일, 불리는지를 그대로 가져온다. 두 자리에 서는 훅은 자리가 둘이다", () => {
    const guard = loopHookOf("guard.output.before", null);
    expect(guard.spots.map(spotKey)).toEqual(["after:model", "before:tools"]);
    expect(guard.fold).toBe("first");
    expect(guard.powers).toEqual(["decide"]);
    expect(guard.event).toBe(false);
    expect(guard.fired).toBe(true);
    const turn = loopHookOf("boundary.turn.before", null);
    expect(turn.spots.map(spotKey)).toEqual(["on:record"]);
    expect(turn.event).toBe(true);
    const cache = loopHookOf("request.cache.before", null);
    expect(cache.spots.map(spotKey)).toEqual(["outside"]);
    expect(cache.fired).toBe(false);
  });

  test("계약에 없는 훅 이름은 자리도 fold도 없고 불리지 않는다", () => {
    expect(loopHookOf("made.up", null)).toEqual({
      name: "made.up",
      known: false,
      spots: [],
      event: false,
      fold: null,
      powers: [],
      fired: false,
      measure: null,
    });
  });
});

describe("Inject 재료 묶기(plugHead)", () => {
  test("카드의 Inject 목록을 넣는 블록마다 묶고, 빈 묶음과 화면 항목은 뺀다", () => {
    const feeds = loopFeedsOf(
      card({
        inject: inject({
          instructions: { always: [{ path: "AGENTS.md", bytes: 10 }], skills: [] },
          commands: ["/plan"],
          tools: [{ name: "kanban.move", description: null }],
          mcpServers: [{ name: "board", transport: "stdio" }],
        }),
      }),
    );
    expect(
      feeds.map((feed) => ({
        point: feed.point,
        items: feed.items.map((item) => `${item.kind}:${item.name}`),
      })),
    ).toEqual([
      { point: "context", items: ["instruction:AGENTS.md", "command:/plan"] },
      { point: "tools", items: ["tool:kanban.move", "server:board"] },
    ]);
  });

  test("서비스(provides)와 앱 화면(ui)은 루프 재료가 아니라 루프 밖에서 주는 것이다", () => {
    const value = card({
      inject: inject({
        providers: ["work.tasks"],
        ui: [{ id: "suggest", placement: "page", readsState: null, modelVisible: "none" }],
      }),
    });
    expect(loopFeedsOf(value)).toEqual([]);
    expect(outsideOf(value)).toEqual([
      { kind: "service", name: "work.tasks" },
      { kind: "screen", name: "suggest" },
    ]);
  });

  test("카드가 없거나 Inject 칸이 없으면 재료가 없다", () => {
    expect(loopFeedsOf(null)).toEqual([]);
    expect(loopFeedsOf(card())).toEqual([]);
  });
});

describe("캔버스에 그릴 것(plugHead)", () => {
  test("매니페스트 훅 줄이 있으면 그것을 쓰고 잰 값을 붙인다. 아직 없으면 카드의 훅 이름을 쓴다", () => {
    const withHooks = card({
      hook: {
        hooks: [
          {
            name: "tool.call.before",
            fold: "first",
            position: "tools.before",
            powers: ["decide"],
          },
        ],
      },
    });
    const fromRows = loopPlanOf({
      card: withHooks,
      hookRows: [hookRow("input.user.before", 12)],
      orchestration: false,
      steps: [],
    });
    expect(fromRows.hooks.map((hook) => [hook.name, hook.measure?.p95Ms ?? null])).toEqual([
      ["input.user.before", 12],
    ]);
    const fromCard = loopPlanOf({
      card: withHooks,
      hookRows: null,
      orchestration: false,
      steps: [],
    });
    expect(fromCard.hooks.map((hook) => [hook.name, hook.measure])).toEqual([
      ["tool.call.before", null],
    ]);
  });

  test("Drive는 카드에 Drive 칸이 있거나 묶음 플러그인일 때만 서고, 단계마다 그 훅들의 자리를 겹침 없이 갖는다", () => {
    expect(
      loopPlanOf({ card: card(), hookRows: [], orchestration: false, steps: [] }).drive,
    ).toBeNull();
    const plan = loopPlanOf({
      card: card({ drive: { start: true, commands: ["/helm"] } }),
      hookRows: [],
      orchestration: false,
      steps: [step("detect", ["tool.call.before", "guard.tool.before", "boundary.turn.before"])],
    });
    expect(plan.drive?.commands).toEqual(["/helm"]);
    expect(plan.drive?.steps.map((s) => s.spots.map(spotKey))).toEqual([
      ["before:tools", "on:record"],
    ]);
    const kit = loopPlanOf({ card: null, hookRows: null, orchestration: true, steps: [] });
    expect(kit.drive).toEqual({ commands: [], steps: [] });
  });

  test("단계의 모르는 훅 이름은 자리가 없다", () => {
    expect(stepSpotsOf(step("x", ["made.up"]))).toEqual([]);
  });

  test("훅을 자리마다 묶는다. 두 자리에 서는 훅은 두 묶음에 든다", () => {
    const hooks = ["tool.call.before", "guard.output.before", "guard.tool.before"].map((name) =>
      loopHookOf(name, null),
    );
    expect(
      hooksBySpot(hooks).map((group) => [
        spotKey(group.spot),
        group.hooks.map((hook) => hook.name),
      ]),
    ).toEqual([
      ["before:tools", ["tool.call.before", "guard.output.before", "guard.tool.before"]],
      ["after:model", ["guard.output.before"]],
    ]);
  });

  test("훅 카드의 줄은 같은 일을 하는 훅을 한 줄로 묶고, 일이 없는 모르는 훅은 하나씩 한 줄이다", () => {
    const hooks = [
      "boundary.step.after",
      "guard.output.before",
      "boundary.settle.before",
      "made.up",
      "other.made.up",
    ].map((name) => loopHookOf(name, null));
    expect(
      hookLinesOf(hooks).map((line) => [line.power, line.hooks.map((hook) => hook.name)]),
    ).toEqual([
      ["modify", ["boundary.step.after", "boundary.settle.before"]],
      ["decide", ["guard.output.before"]],
      [null, ["made.up"]],
      [null, ["other.made.up"]],
    ]);
  });

  test("붙는 지점은 재료, 훅, Drive 단계의 지점을 모은 것이고 루프 밖은 지점이 아니다", () => {
    const plan = loopPlanOf({
      card: card({ inject: inject({ providers: ["local"] }) }),
      hookRows: [hookRow("thread.start"), hookRow("request.cache.before")],
      orchestration: true,
      steps: [step("ask", ["ask.human.before"])],
    });
    expect([...usedPointsOf(plan)].toSorted()).toEqual(["ask", "conversation-start"]);
    // 카드의 providers는 모델 제공자가 아니라 매니페스트 provides의 서비스 id라 재료가 아니고 따로 든다
    expect(plan.feeds).toEqual([]);
    expect(plan.outside).toEqual([{ kind: "service", name: "local" }]);
  });

  test("고른 것의 열쇠와 밝힐 자리", () => {
    const plan = loopPlanOf({
      card: null,
      hookRows: [hookRow("guard.output.before")],
      orchestration: true,
      steps: [step("s1", ["agent.spawn.after"])],
    });
    expect(pickKey(null)).toBe("none");
    expect(pickKey({ kind: "point", point: "model" })).toBe("point:model");
    expect(pickKey({ kind: "step", id: "s1" })).toBe("step:s1");
    expect(pickedSpotsOf(plan, { kind: "hook", name: "guard.output.before" }).map(spotKey)).toEqual(
      ["after:model", "before:tools"],
    );
    expect(pickedSpotsOf(plan, { kind: "step", id: "s1" }).map(spotKey)).toEqual(["after:agents"]);
    expect(pickedSpotsOf(plan, { kind: "drive" })).toEqual([]);
  });
});

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("루프 배치(plugHead)", () => {
  const busy: LoopPlan = loopPlanOf({
    card: card({
      inject: inject({
        instructions: { always: [{ path: "A.md", bytes: 10 }], skills: [] },
        providers: ["local"],
        tools: [{ name: "t", description: null }],
        agents: ["helper"],
      }),
      drive: { start: true, commands: ["/go"] },
    }),
    hookRows: [
      "input.user.before",
      "request.context.before",
      "guard.model.before",
      "guard.output.before",
      "tool.result",
      "ask.human.before",
      "agent.spawn.after",
      "boundary.turn.before",
      "boundary.settle.before",
      "thread.start",
      "request.cache.before",
    ].map((name) => hookRow(name)),
    orchestration: false,
    steps: [step("a", ["tool.call.before"]), step("b", ["thread.start"])],
  });
  const layout = loopLayoutOf(busy);

  test("줄 위 지점은 엔진 순서대로 왼쪽에서 오른쪽이고 모두 같은 가운데 줄에 선다", () => {
    const xs = RAIL_POINTS.map((point) => layout.points.get(point)?.x ?? Number.NaN);
    expect(xs.every((x, i) => i === 0 || x > (xs[i - 1] ?? Number.POSITIVE_INFINITY))).toBe(true);
    for (const point of RAIL_POINTS) {
      const rect = layout.points.get(point);
      expect(rect === undefined ? null : rect.y + rect.h / 2).toBe(layout.railY);
    }
  });

  test("재료 카드, 훅 카드, 지점, 기록 띠, Drive 단계가 서로 겹치지 않고 모두 캔버스 안에 든다", () => {
    const rects: Rect[] = [
      ...layout.points.values(),
      ...layout.feeds.map((box) => box.rect),
      ...layout.hooks.map((box) => box.rect),
      layout.record,
      ...(layout.drive?.steps.map((box) => box.rect) ?? []),
    ];
    const clashes: string[] = [];
    rects.forEach((a, i) => {
      rects.forEach((b, j) => {
        if (j > i && overlaps(a, b)) clashes.push(`${i}/${j}`);
      });
    });
    expect(clashes).toEqual([]);
    for (const rect of rects) {
      expect(rect.x >= 0 && rect.y >= 0).toBe(true);
      expect(rect.x + rect.w <= layout.width && rect.y + rect.h <= layout.height).toBe(true);
    }
  });

  test("재료는 줄 위, 훅은 줄 아래, Drive는 맨 아래다", () => {
    for (const box of layout.feeds) expect(box.rect.y + box.rect.h < layout.railY).toBe(true);
    for (const box of layout.hooks) expect(box.rect.y > layout.railY).toBe(true);
    const lowestHook = Math.max(...layout.hooks.map((box) => box.rect.y + box.rect.h));
    expect((layout.drive?.rect.y ?? 0) > lowestHook).toBe(true);
    expect(layout.drive?.steps.map((box) => box.step.row.id)).toEqual(["a", "b"]);
  });

  test("붙는 것이 없으면 재료도 훅도 Drive도 없이 뼈대만 선다", () => {
    const bare = loopLayoutOf(
      loopPlanOf({ card: null, hookRows: [], orchestration: false, steps: [] }),
    );
    expect([bare.feeds.length, bare.hooks.length, bare.drive]).toEqual([0, 0, null]);
    expect([...bare.points.keys()]).toEqual([...RAIL_POINTS]);
  });
});

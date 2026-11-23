import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  BUILTIN_GROUP_NAMES,
  BUILTIN_PLUGIN_NAMES,
  builtinPluginTextKey,
  CARD_MCP_LAUNCH_LIMITS,
  CostFiguresSchema,
  EvidenceRefSchema,
  InjectInventorySchema,
  INTERNAL_PLUGIN_NAMES,
  internalLayerTextKey,
  internalPluginLayer,
  internalPluginTextKey,
  isInternalPluginName,
  manifestTextGaps,
  PluginCardSchema,
  PluginSettingDefSchema,
  PluginUiDeclSchema,
  type CardLaunch,
  type CardScript,
} from "../../src/extensions/index.ts";
import { PLUGIN_CARD } from "../wire-settings/plugin-fixtures.ts";

function roundTrip(schema: TSchema, value: unknown): void {
  const result = parse(schema, value);
  expect(result.ok ? result.value : result.error).toEqual(value);
}

/** 카드의 Hook 칸 하나를 fold만 바꾼 덮어쓰기 값(나머지 칸은 픽스처 그대로) */
function withHookFold(fold: string): object {
  return {
    does: {
      ...PLUGIN_CARD.does,
      hook: { hooks: [{ ...PLUGIN_CARD.does.hook?.hooks[0], fold }] },
    },
  };
}

describe("plugin card schema (M5c-1)", () => {
  test("a complete card round trips by value", () => {
    roundTrip(PluginCardSchema, PLUGIN_CARD);
  });

  test("a card with no Inject, Hook or Drive and a null purpose is valid", () => {
    roundTrip(PluginCardSchema, {
      ...PLUGIN_CARD,
      purpose: null,
      does: { inject: null, hook: null, drive: null },
      runs: { code: false, isolated: null },
    });
  });

  test("optional origin fields are kept when given and may be omitted", () => {
    const origin = { kind: "project", projectId: "prj_1", createdIn: { threadId: "thr_1" } };
    roundTrip(PluginCardSchema, { ...PLUGIN_CARD, origin });
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, origin: { kind: "user" } }).ok).toBe(true);
  });

  test("rejects extra top-level keys, unknown origin, enforcement and health values", () => {
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, extra: 1 }).ok).toBe(false);
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, origin: { kind: "unknown" } }).ok).toBe(false);
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, enforcement: "strict" }).ok).toBe(false);
    expect(
      parse(PluginCardSchema, {
        ...PLUGIN_CARD,
        health: { ...PLUGIN_CARD.health, state: "running" },
      }).ok,
    ).toBe(false);
  });

  test("the review state of a card is one of the four card states", () => {
    expect(
      parse(PluginCardSchema, {
        ...PLUGIN_CARD,
        review: { ...PLUGIN_CARD.review, state: "sent_back" },
      }).ok,
    ).toBe(false);
    for (const state of ["approved", "pending", "draft", "none"]) {
      expect(
        parse(PluginCardSchema, { ...PLUGIN_CARD, review: { ...PLUGIN_CARD.review, state } }).ok,
      ).toBe(true);
    }
  });

  test("the purpose is at most 200 characters", () => {
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, purpose: "a".repeat(200) }).ok).toBe(true);
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, purpose: "a".repeat(201) }).ok).toBe(false);
  });

  test("a hook fold is one of the four folds of hooks.ts", () => {
    for (const fold of ["tap", "first", "chain", "collect"]) {
      expect(parse(PluginCardSchema, { ...PLUGIN_CARD, ...withHookFold(fold) }).ok).toBe(true);
    }
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, ...withHookFold("detached") }).ok).toBe(false);
  });

  test("cost figures are non-negative integers or null, and the basis is one of four", () => {
    roundTrip(CostFiguresSchema, {
      always: 0,
      drive: null,
      onDemand: null,
      toolCount: null,
      basis: "unknown",
    });
    expect(
      parse(CostFiguresSchema, {
        always: -1,
        drive: null,
        onDemand: null,
        toolCount: null,
        basis: "declared",
      }).ok,
    ).toBe(false);
    expect(
      parse(CostFiguresSchema, {
        always: 1.5,
        drive: null,
        onDemand: null,
        toolCount: null,
        basis: "declared",
      }).ok,
    ).toBe(false);
    expect(
      parse(CostFiguresSchema, {
        always: 1,
        drive: null,
        onDemand: null,
        toolCount: null,
        basis: "guess",
      }).ok,
    ).toBe(false);
  });

  test("InjectInventory keeps its lists and its UI declarations are objects", () => {
    roundTrip(InjectInventorySchema, PLUGIN_CARD.does.inject);
    expect(parse(InjectInventorySchema, { ...PLUGIN_CARD.does.inject, ui: ["panel"] }).ok).toBe(
      false,
    );
    roundTrip(PluginUiDeclSchema, {
      id: "panel",
      placement: "side",
      readsState: "notes.count",
      modelVisible: "partial",
    });
    expect(
      parse(PluginUiDeclSchema, {
        id: "panel",
        placement: "side",
        readsState: null,
        modelVisible: "some",
      }).ok,
    ).toBe(false);
  });

  test("a UI declaration may carry its drawing mode and an own-code app's reason and capabilities; a card without them still parses", () => {
    roundTrip(PluginUiDeclSchema, {
      id: "graph",
      placement: "panel",
      readsState: null,
      modelVisible: "none",
      mode: "app",
      app: { reason: "Needs a canvas", capabilities: ["files", "secrets"] },
    });
    roundTrip(PluginUiDeclSchema, {
      id: "main",
      placement: "page",
      readsState: null,
      modelVisible: "none",
    });
    const base = { id: "graph", placement: "panel", readsState: null, modelVisible: "none" };
    expect(parse(PluginUiDeclSchema, { ...base, mode: "web" }).ok).toBe(false);
    expect(
      parse(PluginUiDeclSchema, { ...base, app: { reason: "r", capabilities: ["shell"] } }).ok,
    ).toBe(false);
    expect(
      parse(PluginUiDeclSchema, { ...base, app: { reason: "r", capabilities: [], extra: 1 } }).ok,
    ).toBe(false);
  });

  test("a setting definition keeps an unknown default value", () => {
    for (const value of ["text", 3, null, { nested: true }]) {
      roundTrip(PluginSettingDefSchema, {
        key: "ext.acme-notes.token",
        label: "Token",
        default: value,
        required: false,
        secret: true,
      });
    }
    expect(
      parse(PluginSettingDefSchema, { key: "k", label: "l", default: 1, secret: false }).ok,
    ).toBe(false);
  });
});

describe("evidence reference (E §3.5 minimal copy)", () => {
  test("a turn reference and a backtest reference round trip", () => {
    roundTrip(EvidenceRefSchema, { kind: "turn", threadId: "thr_1", turnId: "trn_1" });
    roundTrip(EvidenceRefSchema, {
      kind: "call",
      threadId: "thr_1",
      turnId: "trn_1",
      stepIndex: 2,
      toolCallId: "call_9",
    });
    roundTrip(EvidenceRefSchema, { kind: "backtest", backtestRunId: "bt_1" });
  });

  test("an unknown kind or a backtest with a thread is rejected", () => {
    expect(parse(EvidenceRefSchema, { kind: "replay", threadId: "t", turnId: "u" }).ok).toBe(false);
    expect(
      parse(EvidenceRefSchema, { kind: "backtest", backtestRunId: "bt_1", threadId: "thr_1" }).ok,
    ).toBe(false);
    expect(
      parse(EvidenceRefSchema, { kind: "turn", threadId: "thr_1", turnId: "trn_1", stepIndex: -1 })
        .ok,
    ).toBe(false);
  });
});

/** 픽스처 카드의 Inject 칸에 스크립트 칸을 얹은 값 */
function withScriptLane(scripts: unknown): object {
  return {
    ...PLUGIN_CARD,
    does: { ...PLUGIN_CARD.does, inject: { ...PLUGIN_CARD.does.inject, scripts } },
  };
}

describe("script lane of the card (설계 B [제안])", () => {
  const lintLaunch: CardLaunch = {
    command: "sh",
    args: ["scripts/lint.sh"],
    envNames: ["LINT_LEVEL"],
    cwd: null,
  };
  const lintScript: CardScript = { name: "lint", launch: lintLaunch, timeoutMs: 10000 };

  test("an old card whose Inject lane has no scripts parses and keeps no scripts key", () => {
    const parsed = parse(PluginCardSchema, PLUGIN_CARD);
    const value: unknown = parsed.ok ? parsed.value : parsed.error;
    expect(value).toEqual(PLUGIN_CARD);
    expect(
      parsed.ok && parsed.value.does.inject !== null && "scripts" in parsed.value.does.inject,
    ).toBe(false);
  });

  test("a card with a scripts lane round trips by value", () => {
    roundTrip(PluginCardSchema, withScriptLane([lintScript]));
    roundTrip(PluginCardSchema, withScriptLane([]));
  });

  test("a script entry needs name, launch and timeoutMs, and the launch keeps its shape", () => {
    expect(parse(PluginCardSchema, withScriptLane([{ name: "lint", launch: lintLaunch }])).ok).toBe(
      false,
    );
    expect(parse(PluginCardSchema, withScriptLane([{ name: "lint", timeoutMs: 1 }])).ok).toBe(
      false,
    );
    expect(parse(PluginCardSchema, withScriptLane([{ ...lintScript, extra: 1 }])).ok).toBe(false);
    expect(
      parse(
        PluginCardSchema,
        withScriptLane([{ ...lintScript, launch: { ...lintLaunch, shell: true } }]),
      ).ok,
    ).toBe(false);
  });

  test("the launch of a script has the same caps as the MCP launch", () => {
    const longCommand = "x".repeat(CARD_MCP_LAUNCH_LIMITS.command + 1);
    expect(
      parse(
        PluginCardSchema,
        withScriptLane([{ ...lintScript, launch: { ...lintLaunch, command: longCommand } }]),
      ).ok,
    ).toBe(false);
    const cwdSet = { ...lintLaunch, cwd: "/work" };
    roundTrip(PluginCardSchema, withScriptLane([{ ...lintScript, launch: cwdSet }]));
  });

  test("timeoutMs is an integer from 1 to 60000 ms", () => {
    for (const timeoutMs of [1, 60000]) {
      expect(parse(PluginCardSchema, withScriptLane([{ ...lintScript, timeoutMs }])).ok).toBe(true);
    }
    for (const timeoutMs of [0, 60001, 1.5]) {
      expect(parse(PluginCardSchema, withScriptLane([{ ...lintScript, timeoutMs }])).ok).toBe(
        false,
      );
    }
  });

  test("the scripts lane holds at most 64 entries", () => {
    const many = Array.from({ length: 65 }, (_, index) => ({ ...lintScript, name: `s${index}` }));
    expect(parse(PluginCardSchema, withScriptLane(many)).ok).toBe(false);
    expect(parse(PluginCardSchema, withScriptLane(many.slice(0, 64))).ok).toBe(true);
  });
});

describe("internal plugin marker (AGE-33)", () => {
  test("the internal flag round trips and may be omitted", () => {
    roundTrip(PluginCardSchema, { ...PLUGIN_CARD, internal: true });
    roundTrip(PluginCardSchema, { ...PLUGIN_CARD, internal: false });
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, internal: "yes" }).ok).toBe(false);
  });

  test("the layer value round trips, may be omitted and rejects unknown values", () => {
    roundTrip(PluginCardSchema, { ...PLUGIN_CARD, internal: true, internalLayer: "core" });
    roundTrip(PluginCardSchema, { ...PLUGIN_CARD, internal: true, internalLayer: "bridge" });
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, internalLayer: "plugin" }).ok).toBe(false);
  });

  test("every internal name has a layer: core-* is core, cap-* is capability, host-* is bridge, tool-* by need", () => {
    // 도구 종류 플러그인(AGE-76 질문 2): 엔진이 꼭 필요로 하는 도구는 앱 핵심, 없어도 되는 도구(git, secret-tool)는 기본 제공(기능)
    const optionalTools = new Set(["tool-git", "tool-secret-tool"]);
    for (const name of INTERNAL_PLUGIN_NAMES) {
      const expected =
        name.startsWith("core-") || (name.startsWith("tool-") && !optionalTools.has(name))
          ? "core"
          : name.startsWith("cap-") || optionalTools.has(name)
            ? "capability"
            : "bridge";
      expect(internalPluginLayer(name)).toBe(expected);
    }
    expect(internalPluginLayer("authoring")).toBeUndefined();
    expect(internalLayerTextKey("capability")).toBe("plugin.internal.layer.capability");
  });

  test("text keys are camelCase per field and the name list has no duplicates", () => {
    expect(internalPluginTextKey("core-loop", "name")).toBe("plugin.internal.coreLoop.name");
    expect(internalPluginTextKey("host-goal-bridge", "purpose")).toBe(
      "plugin.internal.hostGoalBridge.purpose",
    );
    expect(INTERNAL_PLUGIN_NAMES).toHaveLength(29);
    expect(INTERNAL_PLUGIN_NAMES).not.toContain("host-dialog-area-bridge");
    expect(new Set(INTERNAL_PLUGIN_NAMES).size).toBe(INTERNAL_PLUGIN_NAMES.length);
    expect(isInternalPluginName("core-loop")).toBe(true);
    expect(isInternalPluginName("authoring")).toBe(false);
    expect(isInternalPluginName("guide")).toBe(false);
  });
});

describe("card dependency cells (AGE-33)", () => {
  const LINE = { from: "app", target: "kit", kind: "hard", range: "^1.0.0", problem: null };
  const WITH_CELL = {
    ...PLUGIN_CARD,
    dependencies: {
      dependsOn: [LINE, { ...LINE, problem: "range_unmet" }],
      dependents: [{ ...LINE, from: "tool", target: "app", range: null }],
    },
  };

  test("the dependency cell round trips by value, and a card without it (an old card) still parses", () => {
    roundTrip(PluginCardSchema, WITH_CELL);
    expect("dependencies" in PLUGIN_CARD).toBe(false);
    roundTrip(PluginCardSchema, PLUGIN_CARD);
  });

  test("the problem takes only the card's three values or null; target_disabled is a profile matter and is rejected", () => {
    for (const problem of ["target_missing", "member_missing", "range_unmet", null]) {
      expect(
        parse(PluginCardSchema, {
          ...PLUGIN_CARD,
          dependencies: { dependsOn: [{ ...LINE, problem }], dependents: [] },
        }).ok,
      ).toBe(true);
    }
    expect(
      parse(PluginCardSchema, {
        ...PLUGIN_CARD,
        dependencies: { dependsOn: [{ ...LINE, problem: "target_disabled" }], dependents: [] },
      }).ok,
    ).toBe(false);
  });

  test("the kind is hard or soft, and the line and the cell take no extra fields", () => {
    expect(
      parse(PluginCardSchema, {
        ...PLUGIN_CARD,
        dependencies: { dependsOn: [{ ...LINE, kind: "optional" }], dependents: [] },
      }).ok,
    ).toBe(false);
    expect(
      parse(PluginCardSchema, {
        ...PLUGIN_CARD,
        dependencies: { dependsOn: [{ ...LINE, extra: 1 }], dependents: [] },
      }).ok,
    ).toBe(false);
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, dependencies: { dependsOn: [] } }).ok).toBe(
      false,
    );
  });
});

describe("required by core and the not-passed names (AGE-33 enDep 10, 11)", () => {
  test("requiredByCore round trips by value, and a card without it parses with no such key", () => {
    roundTrip(PluginCardSchema, { ...PLUGIN_CARD, requiredByCore: ["core-tools"] });
    roundTrip(PluginCardSchema, PLUGIN_CARD);
    expect("requiredByCore" in PLUGIN_CARD).toBe(false);
  });

  test("requiredByCore takes strings only and at most 16 names", () => {
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, requiredByCore: [42] }).ok).toBe(false);
    const names = Array.from({ length: 17 }, (_, index) => `core-${index}`);
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, requiredByCore: names }).ok).toBe(false);
  });

  test("a script's envNotPassed round trips by value and may be omitted", () => {
    const lint: CardScript = {
      name: "lint",
      launch: { command: "sh", args: ["scripts/lint.sh"], envNames: [], cwd: null },
      timeoutMs: 10000,
      envNotPassed: ["API_TOKEN"],
    };
    roundTrip(PluginCardSchema, withScriptLane([lint]));
  });

  test("builtin text keys: internal parts keep plugin.internal, the two builtin groups use plugin.builtin", () => {
    expect(builtinPluginTextKey("cap-schedule", "description")).toBe(
      "plugin.internal.capSchedule.description",
    );
    expect(builtinPluginTextKey("authoring", "purpose")).toBe("plugin.builtin.authoring.purpose");
    expect(builtinPluginTextKey("guide", "description")).toBe("plugin.builtin.guide.description");
    expect(builtinPluginTextKey("my-plugin", "purpose")).toBeUndefined();
    expect([...BUILTIN_GROUP_NAMES]).toEqual(["authoring", "guide"]);
    expect(BUILTIN_PLUGIN_NAMES).toHaveLength(31);
    expect(new Set(BUILTIN_PLUGIN_NAMES).size).toBe(31);
  });
});

describe("card description (AGE-31)", () => {
  test("a card with a description round-trips and an old card without one still parses", () => {
    roundTrip(PluginCardSchema, { ...PLUGIN_CARD, description: "Runs a prompt later." });
    roundTrip(PluginCardSchema, PLUGIN_CARD);
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, description: "" }).ok).toBe(false);
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, description: "x".repeat(1025) }).ok).toBe(
      false,
    );
  });

  test("manifestTextGaps names each empty or blank human field", () => {
    expect(
      manifestTextGaps({ purpose: "Saves notes.", description: "Saves notes to a file." }),
    ).toEqual([]);
    expect(manifestTextGaps({})).toEqual(["purpose", "description"]);
    expect(manifestTextGaps({ purpose: "  ", description: "Does a thing." })).toEqual(["purpose"]);
    expect(manifestTextGaps({ purpose: "Does a thing.", description: "\n" })).toEqual([
      "description",
    ]);
  });
});

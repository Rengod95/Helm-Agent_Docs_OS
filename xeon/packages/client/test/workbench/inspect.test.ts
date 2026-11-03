import { describe, expect, test } from "bun:test";
import type { ExtHookTiming } from "@fresnel/contracts/extensions";
import type { ExtBindingEdge, ExtHookInfo, GroupStatusWire } from "@fresnel/contracts/wire";
import {
  budgetLevelOf,
  inspectCompositionOf,
  inspectDriveOf,
  inspectFeaturesOf,
  inspectHookRowsOf,
  inspectSettingOf,
  runtimeViewOf,
  userConfigOf,
} from "../../src/workbench/index.ts";

const hook = (over: Partial<ExtHookInfo> = {}): ExtHookInfo => ({
  registrationId: "web",
  hook: "tool.call.before",
  budgetClass: "fast",
  budgetMs: 100,
  ...over,
});

const timing = (over: Partial<ExtHookTiming> = {}): ExtHookTiming => ({
  hook: "tool.call.before",
  registrationId: "web",
  count: 10,
  p50Ms: 10,
  p95Ms: 50,
  maxMs: 80,
  failures: 1,
  ...over,
});

describe("검사 탭 훅 줄: 예산 대비 단계(50% warning, 100% danger)", () => {
  test("p95가 예산의 50%면 warning, 100%면 danger, 그 아래는 normal이다", () => {
    expect(budgetLevelOf(49, 100)).toBe("normal");
    expect(budgetLevelOf(50, 100)).toBe("warning");
    expect(budgetLevelOf(99, 100)).toBe("warning");
    expect(budgetLevelOf(100, 100)).toBe("danger");
    expect(budgetLevelOf(10, 0)).toBeNull();
  });

  test("측정이 있으면 p95, 실패 수, fold가 붙고 없으면 null이다", () => {
    const rows = inspectHookRowsOf(
      [hook(), hook({ hook: "request.stream", budgetMs: 200 })],
      [timing({ p95Ms: 120 })],
    );
    expect(rows[0]).toEqual({
      hook: "tool.call.before",
      registrationId: "web",
      fold: "first",
      budgetClass: "fast",
      budgetMs: 100,
      p95Ms: 120,
      failures: 1,
      level: "danger",
    });
    expect(rows[1]).toEqual({
      hook: "request.stream",
      registrationId: "web",
      fold: "tap",
      budgetClass: "fast",
      budgetMs: 200,
      p95Ms: null,
      failures: null,
      level: null,
    });
  });
});

describe("검사 탭 기능 구역", () => {
  test("제공은 이름만, 요구와 선택은 맞은편과 충족 여부를 싣는다", () => {
    const edges: ExtBindingEdge[] = [
      {
        registrationId: "web",
        capability: "web.search",
        relation: "provides",
        peer: null,
        satisfied: true,
      },
      {
        registrationId: "web",
        capability: "knowledge.skills",
        relation: "requires",
        peer: "knowledge",
        satisfied: true,
      },
      {
        registrationId: "web",
        capability: "memory",
        relation: "optional",
        peer: null,
        satisfied: false,
      },
    ];
    expect(inspectFeaturesOf(edges)).toEqual({
      provides: ["web.search"],
      requires: [{ capability: "knowledge.skills", peer: "knowledge", satisfied: true }],
      optional: [{ capability: "memory", peer: null, satisfied: false }],
    });
  });
});

describe("검사 탭 구성 구역과 설정 바인딩", () => {
  test("composition이 없으면 null이고, 있으면 블록 줄을 낸다", () => {
    expect(inspectCompositionOf({ name: "review" })).toBeNull();
    const manifest = {
      composition: {
        blocks: [{ id: "lint", stage: "check", op: "on", title: "Lint" }],
      },
    };
    expect(inspectCompositionOf(manifest)).toEqual([
      { id: "lint", stage: "check", op: "on", title: "Lint" },
    ]);
    expect(
      inspectCompositionOf({ composition: { blocks: [{ id: "x", stage: "check", op: "run" }] } }),
    ).toBeNull();
  });

  test("userConfig 항목을 설정 키와 제목으로 읽고 시크릿 값은 가린다", () => {
    const manifest = {
      userConfig: {
        apiKey: { setting: "ext.web.apiKey", title: "키", sensitive: true },
        depth: { setting: "ext.web.depth", title: "깊이" },
      },
    };
    expect(userConfigOf(manifest)).toEqual([
      { setting: "ext.web.apiKey", title: "키", sensitive: true },
      { setting: "ext.web.depth", title: "깊이" },
    ]);
    expect(
      inspectSettingOf(
        { setting: "ext.web.apiKey", title: "키", sensitive: true },
        { key: "ext.web.apiKey", value: "secret://k", winningScope: "user", writer: "user" },
      ),
    ).toEqual({
      key: "ext.web.apiKey",
      title: "키",
      value: null,
      winningScope: "user",
      writer: "user",
    });
    expect(
      inspectSettingOf(
        { setting: "ext.web.depth", title: "깊이" },
        { key: "ext.web.depth", value: 3, winningScope: null, writer: "default" },
      ),
    ).toEqual({
      key: "ext.web.depth",
      title: "깊이",
      value: "3",
      winningScope: null,
      writer: "default",
    });
  });
});

describe("검사 탭 주도 락 구역: 역할은 런타임 탭과 같은 값에서 온다", () => {
  const groups: GroupStatusWire[] = [
    {
      id: "helm",
      displayName: "helm",
      scope: "enabled",
      pendingToggle: null,
      usesDrive: true,
      drive: "holder",
      lastError: null,
      metrics: null,
    },
    {
      id: "review",
      displayName: "review",
      scope: "enabled",
      pendingToggle: null,
      usesDrive: true,
      drive: "waiting",
      lastError: null,
      metrics: null,
    },
    {
      id: "work",
      displayName: "work",
      scope: "enabled",
      pendingToggle: null,
      usesDrive: true,
      drive: "rejected",
      lastError: null,
      metrics: null,
    },
  ];
  const view = runtimeViewOf(groups, {
    holder: "helm",
    leaseEpoch: 1,
    activeDriver: null,
    limits: { turns: 4, spawns: 4, tokens: null },
    used: { turns: 1, spawns: 0, tokens: 0 },
    candidates: [{ registrationId: "review", waits: 1, waitLimit: 3 }],
    lastRejected: null,
  });

  test("보유, 대기, 거절, 후보 아님을 가린다", () => {
    expect(inspectDriveOf(view, "helm")).toEqual({ role: "holder", waits: null, waitLimit: null });
    expect(inspectDriveOf(view, "review")).toEqual({ role: "waiting", waits: 1, waitLimit: 3 });
    expect(inspectDriveOf(view, "work")).toEqual({
      role: "rejected",
      waits: null,
      waitLimit: null,
    });
    expect(inspectDriveOf(view, "plugin-x")).toEqual({
      role: "none",
      waits: null,
      waitLimit: null,
    });
  });
});

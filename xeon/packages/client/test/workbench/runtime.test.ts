import { describe, expect, test } from "bun:test";
import type { ExtListEntry, GroupDriveLockResult, GroupStatusWire } from "@fresnel/contracts/wire";
import {
  failureGroupsOf,
  runtimeRowsOf,
  runtimeViewOf,
  type HandlerFailureEntry,
} from "../../src/workbench/index.ts";

function group(
  id: string,
  drive: GroupStatusWire["drive"],
  over: Partial<GroupStatusWire> = {},
): GroupStatusWire {
  return {
    id,
    displayName: id,
    scope: "enabled",
    pendingToggle: null,
    usesDrive: true,
    drive,
    lastError: null,
    metrics: null,
    ...over,
  };
}

function lock(over: Partial<GroupDriveLockResult> = {}): GroupDriveLockResult {
  return {
    holder: null,
    leaseEpoch: 0,
    activeDriver: null,
    limits: { turns: 4, spawns: 4, tokens: null },
    used: { turns: 0, spawns: 0, tokens: 0 },
    candidates: [],
    lastRejected: null,
    ...over,
  };
}

function entry(name: string, over: Partial<ExtListEntry> = {}): ExtListEntry {
  return {
    name,
    displayName: name,
    layer: "L3",
    isGroup: true,
    version: "1.0.0",
    location: "/x",
    origin: "builtin",
    requestedGrade: "user",
    effectiveGrade: "user",
    tier: null,
    status: "enabled",
    plugins: [{ registrationId: name, layer: "L3", status: "enabled", inGroup: false }],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 3,
    ...over,
  };
}

describe("runtime-tab.drive-queue-matches-group-status", () => {
  test("helm 보유, review 대기, work 거절: 보유·대기열·거절이 GroupStatus.drive와 driveLock에서 같다", () => {
    const view = runtimeViewOf(
      [group("helm", "holder"), group("review", "waiting"), group("work", "rejected")],
      lock({
        holder: "helm",
        leaseEpoch: 3,
        used: { turns: 2, spawns: 1, tokens: 900 },
        candidates: [{ registrationId: "review", waits: 1, waitLimit: 3 }],
        lastRejected: { groupId: "work", reason: "waitLimit", requestSeq: 7 },
      }),
    );
    expect(view.holder?.id).toBe("helm");
    expect(view.holderAgrees).toBe(true);
    expect(view.queue.map((m) => m.id)).toEqual(["review"]);
    expect(view.queue[0]).toEqual({ id: "review", displayName: "review", waits: 1, waitLimit: 3 });
    expect(view.rejected.map((m) => m.id)).toEqual(["work"]);
    expect(view.leaseEpoch).toBe(3);
    expect(view.used).toEqual({ turns: 2, spawns: 1, tokens: 900 });
    expect(view.lastRejected).toEqual({ groupId: "work", reason: "waitLimit", requestSeq: 7 });
  });

  test("보유자가 helm이 아닌 review여도 같은 모양이다: helm이 대기, work가 거절", () => {
    const view = runtimeViewOf(
      [group("review", "holder"), group("helm", "waiting"), group("work", "rejected")],
      lock({
        holder: "review",
        candidates: [{ registrationId: "helm", waits: 0, waitLimit: 2 }],
      }),
    );
    expect(view.holder?.id).toBe("review");
    expect(view.holderAgrees).toBe(true);
    expect(view.queue.map((m) => m.id)).toEqual(["helm"]);
    expect(view.rejected.map((m) => m.id)).toEqual(["work"]);
  });

  test("대기열 순서는 driveLock.candidates 순서이고, 후보에 없는 대기 그룹은 뒤에 붙는다", () => {
    const view = runtimeViewOf(
      [group("a", "holder"), group("b", "waiting"), group("c", "waiting"), group("d", "waiting")],
      lock({
        holder: "a",
        candidates: [
          { registrationId: "c", waits: 2, waitLimit: 4 },
          { registrationId: "b", waits: 0, waitLimit: 4 },
        ],
      }),
    );
    expect(view.queue.map((m) => m.id)).toEqual(["c", "b", "d"]);
    expect(view.queue[2]).toEqual({ id: "d", displayName: "d", waits: null, waitLimit: null });
  });

  test("drive가 none인 그룹과 목록에 없는 보유자는 구역에 들지 않는다", () => {
    const view = runtimeViewOf(
      [group("plain", "none", { usesDrive: false })],
      lock({ holder: "ghost" }),
    );
    expect(view.holder).toBeNull();
    expect(view.holderAgrees).toBe(false);
    expect(view.queue).toEqual([]);
    expect(view.rejected).toEqual([]);
  });
});

describe("runtime-tab 행: 이 대화의 켜진 그룹과 확장", () => {
  test("대화 범위가 꺼진 확장은 빼고, 그룹의 켜짐 요청은 켜는 중으로 보인다", () => {
    const rows = runtimeRowsOf(
      [
        entry("helm", { hookCount: 5 }),
        entry("review", { status: "enabled", registration: "disabled", hookCount: 2 }),
        entry("web", { isGroup: false, layer: "L2", hookCount: 1 }),
      ],
      [group("helm", "holder", { pendingToggle: "disable" })],
    );
    expect(rows.map((r) => r.name)).toEqual(["helm", "web"]);
    expect(rows[0]).toEqual({
      name: "helm",
      displayName: null,
      layer: "L3",
      kind: "group",
      state: "disabling",
      hookCount: 5,
      drive: "holder",
    });
    expect(rows[1]?.drive).toBeNull();
    expect(rows[1]?.kind).toBe("plugin");
  });

  test("자동 꺼진 확장은 대화에서 꺼져 있어도 자동 꺼짐 상태로 보인다", () => {
    const rows = runtimeRowsOf(
      [entry("review", { status: "disabled", autoDisabled: true, isGroup: false, layer: "L3" })],
      [],
    );
    expect(rows.map((r) => [r.name, r.state])).toEqual([["review", "auto_disabled"]]);
  });
});

describe("runtime-tab 실패 구역: 엔진 거울의 scope.handler_failed를 owner별로 묶는다", () => {
  test("ext:와 hook: owner를 처음 나온 순서대로 묶고 같은 실패는 한 행으로 센다", () => {
    const records: HandlerFailureEntry[] = [
      { owner: "ext:review", point: "turn.end", result: "error", message: "boom", consecutive: 1 },
      { owner: "hook:turn.end", point: "turn.end", result: "error", message: "x", consecutive: 1 },
      { owner: "ext:review", point: "turn.end", result: "error", message: "boom", consecutive: 2 },
    ];
    const groups = failureGroupsOf(records);
    expect(groups.map((g) => g.label)).toEqual(["review", "hook:turn.end"]);
    expect(groups[0]?.rows).toEqual([
      { point: "turn.end", result: "error", message: "boom", count: 2, consecutive: 2 },
    ]);
  });
});

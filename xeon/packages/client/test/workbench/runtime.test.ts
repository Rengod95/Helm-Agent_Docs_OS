import { describe, expect, test } from "bun:test";
import type { DriveFrameView } from "@fresnel/contracts/extensions";
import type { ExtListEntry, GroupStatusWire } from "@fresnel/contracts/wire";
import {
  clockTextOf,
  failureClockOf,
  failureGroupsOf,
  runtimeRowsOf,
  runtimeViewOf,
  transitionRowsOf,
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

/** 주도권 스택의 프레임. `depth`는 코어 0, 플러그인 프레임 1부터다 */
function frame(
  plugin: string | null,
  state: DriveFrameView["state"],
  depth: number,
  over: Partial<DriveFrameView> = {},
): DriveFrameView {
  return {
    depth,
    plugin,
    versionId: plugin === null ? null : "1.0.0",
    leaseId: plugin === null ? null : `lease-${plugin}`,
    state,
    used: { turns: 0, spawns: 0, tokens: 0 },
    limits: {},
    ...over,
  };
}

/** 코어 루프 프레임(맨 아래) */
const CORE: DriveFrameView = frame(null, "waiting", 0);

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
  test("[코어, A waiting, B driving]: 보유는 B, 대기는 [A]이고 프레임 전체를 싣는다", () => {
    const frames = [CORE, frame("A", "waiting", 1), frame("B", "driving", 2)];
    const view = runtimeViewOf([group("B", "holder"), group("A", "waiting")], frames);
    expect(view.holder).toEqual({ id: "B", displayName: "B" });
    expect(view.holderAgrees).toBe(true);
    expect(view.queue).toEqual([{ id: "A", displayName: "A" }]);
    expect(view.frames).toEqual(frames);
  });

  test("대기는 waiting 프레임만 든다. 보유자 아래라도 driving이나 asking 프레임은 대기가 아니다", () => {
    const view = runtimeViewOf(
      [group("C", "holder"), group("A", "waiting")],
      [CORE, frame("A", "waiting", 1), frame("B", "asking", 2), frame("C", "driving", 3)],
    );
    expect(view.holder?.id).toBe("C");
    expect(view.queue.map((m) => m.id)).toEqual(["A"]);
  });

  test("대기 순서는 프레임 순서(아래에서 위)이고, 목록에 없는 그룹도 id를 이름으로 싣는다", () => {
    const view = runtimeViewOf(
      [group("a", "waiting")],
      [CORE, frame("a", "waiting", 1), frame("b", "waiting", 2), frame("c", "driving", 3)],
    );
    expect(view.queue).toEqual([
      { id: "a", displayName: "a" },
      { id: "b", displayName: "b" },
    ]);
    expect(view.holder).toEqual({ id: "c", displayName: "c" });
  });

  test("플러그인 프레임이 없으면 보유자도 대기도 없다", () => {
    const view = runtimeViewOf([group("plain", "none", { usesDrive: false })], [CORE]);
    expect(view.holder).toBeNull();
    expect(view.holderAgrees).toBe(true);
    expect(view.queue).toEqual([]);
    expect(view.used).toEqual({ turns: 0, spawns: 0, tokens: 0 });
    expect(view.limits).toEqual({ turns: null, spawns: null, tokens: null });
  });

  test("group.list의 보유 그룹과 맨 위 프레임이 다르면 어긋난다", () => {
    const view = runtimeViewOf([group("X", "holder")], [CORE, frame("B", "driving", 1)]);
    expect(view.holder?.id).toBe("B");
    expect(view.holderAgrees).toBe(false);
  });

  test("맨 위 플러그인 프레임의 사용량과 상한을 싣고, 상한이 없는 항목은 null이다", () => {
    const view = runtimeViewOf(
      [group("B", "holder")],
      [
        CORE,
        frame("B", "driving", 1, {
          used: { turns: 2, spawns: 1, tokens: 900 },
          limits: { turns: 4, spawns: 4 },
        }),
      ],
    );
    expect(view.used).toEqual({ turns: 2, spawns: 1, tokens: 900 });
    expect(view.limits).toEqual({ turns: 4, spawns: 4, tokens: null });
  });

  test("drive 오류인 그룹은 오류 구역에 들고, drive를 안 쓰는 그룹은 어느 목록에도 없다", () => {
    const view = runtimeViewOf(
      [group("plain", "none", { usesDrive: false }), group("bad", "error")],
      [CORE],
    );
    expect(view.errored.map((m) => m.id)).toEqual(["bad"]);
    expect(view.holder).toBeNull();
    expect(view.queue).toEqual([]);
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

// 지역 시각으로 만든 시각이라 어느 시간대에서도 같은 HH:MM:SS를 읽는다
const at = (hour: number, minute: number, second: number): string =>
  new Date(2026, 10, 4, hour, minute, second).toISOString();

describe("transitionRowsOf: 전환 기록 줄", () => {
  test("최근 것이 먼저 오고, 시각은 HH:MM:SS, 턴 꼬리는 끝 여섯 글자다", () => {
    const rows = transitionRowsOf([
      {
        seq: 3,
        at: at(9, 5, 7),
        turnId: "trn_0000000000000000000000abcdef",
        subject: "helm",
        change: { kind: "lease.acquired", leaseEpoch: null },
      },
      {
        seq: 5,
        at: at(14, 2, 41),
        turnId: null,
        subject: "review",
        change: { kind: "lease.released", reason: "waiting" },
      },
    ]);
    expect(rows).toEqual([
      {
        seq: 5,
        time: "14:02:41",
        turn: null,
        subject: "review",
        change: { kind: "lease.released", reason: "waiting" },
      },
      {
        seq: 3,
        time: "09:05:07",
        turn: "abcdef",
        subject: "helm",
        change: { kind: "lease.acquired", leaseEpoch: null },
      },
    ]);
  });

  test("기록이 없으면 빈 목록이다", () => {
    expect(transitionRowsOf([])).toEqual([]);
  });
});

describe("clockTextOf와 failureClockOf: 지역 HH:MM:SS 글", () => {
  test("시·분·초를 두 자리씩 채운다", () => {
    expect(clockTextOf(new Date(2026, 10, 4, 9, 8, 7))).toBe("09:08:07");
    expect(clockTextOf(new Date(2026, 10, 4, 23, 59, 59))).toBe("23:59:59");
  });

  test("실패 기록 시각은 지역 HH:MM:SS 글이다", () => {
    expect(failureClockOf(at(14, 3, 22))).toBe("14:03:22");
    expect(failureClockOf(at(0, 5, 9))).toBe("00:05:09");
  });

  test("시각이 없거나 날짜로 읽히지 않으면 null이다", () => {
    expect(failureClockOf(undefined)).toBeNull();
    expect(failureClockOf("")).toBeNull();
    expect(failureClockOf("not-a-date")).toBeNull();
  });
});

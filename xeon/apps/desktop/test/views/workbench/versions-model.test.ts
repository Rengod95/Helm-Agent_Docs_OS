import { describe, expect, test } from "bun:test";
import type { PluginHistoryEntry, WhatItDoesDiff } from "@fresnel/contracts/wire";
import {
  DROPPED_LIMIT,
  actorWordOf,
  currentLabelOf,
  detailRead,
  droppedOf,
  entryKeyOf,
  eventWordOf,
  hasChangesOf,
  historyLinesOf,
  pendingRollbackOf,
  rollbackStopOf,
  selectedIndexOf,
  stopWordOf,
  versionLabelOf,
} from "../../../src/views/workbench/versions-model.ts";
import { sampleItems } from "../../../src/views/craft/review/testing/review-samples.ts";

const hash = (c: string): string => `sha256:${c.repeat(64)}`;

/** 이력 한 줄. 기본은 요약이 있는 편집 줄이고, 바꿀 칸만 고친다 */
function line(over: Partial<PluginHistoryEntry>): PluginHistoryEntry {
  return {
    at: "2026-11-20T10:00:00.000Z",
    event: "edit",
    version: "0.2.0",
    contentHash: hash("b"),
    baseHash: null,
    itemId: "rvw_edit",
    actor: "user",
    summary: "검색을 더함",
    current: false,
    kept: true,
    ...over,
  };
}

/** 최신이 앞인 이력: 0.3.0(지금, 되돌리기 줄), 0.2.0, 0.1.0(만들기, 가져옴) */
const ENTRIES: readonly PluginHistoryEntry[] = [
  line({
    at: "2026-11-24T09:00:00.000Z",
    event: "rollback",
    version: "0.3.0",
    contentHash: hash("c"),
    current: true,
    summary: null,
    actor: "user",
    itemId: null,
  }),
  line({
    at: "2026-11-22T09:00:00.000Z",
    event: "edit",
    version: "0.2.0",
    contentHash: hash("b"),
    summary: "검색을 더함",
  }),
  line({
    at: "2026-11-20T09:00:00.000Z",
    event: "create",
    version: "0.1.0",
    contentHash: hash("a"),
    summary: null,
    actor: "migration",
    kept: false,
    itemId: null,
  }),
];

describe("사건과 승인 말", () => {
  test("사건마다 자기 말을 고른다(만들기, 고치기, 가져오기, 내장 업데이트, 되돌리기)", () => {
    expect(eventWordOf("create")).toBe("desktop.workbench.history.event.create");
    expect(eventWordOf("edit")).toBe("desktop.workbench.history.event.edit");
    expect(eventWordOf("import")).toBe("desktop.workbench.history.event.import");
    expect(eventWordOf("bundled")).toBe("desktop.workbench.history.event.bundled");
    expect(eventWordOf("rollback")).toBe("desktop.workbench.history.event.rollback");
  });

  test("승인한 쪽의 말은 사용자 승인, 가져오기, 앱 업데이트다", () => {
    expect(actorWordOf("user")).toBe("desktop.workbench.history.actor.user");
    expect(actorWordOf("migration")).toBe("desktop.workbench.history.actor.migration");
    expect(actorWordOf("release")).toBe("desktop.workbench.history.actor.release");
  });
});

describe("이력 줄 목록", () => {
  test("줄마다 버전 글, 사건 말, 시각을 가지고 최신이 앞이다", () => {
    const lines = historyLinesOf(ENTRIES, 0);
    expect(lines.map((l) => l.label)).toEqual(["0.3.0", "0.2.0", "0.1.0"]);
    expect(lines.map((l) => l.event)).toEqual([
      "desktop.workbench.history.event.rollback",
      "desktop.workbench.history.event.edit",
      "desktop.workbench.history.event.create",
    ]);
    expect(lines[1]?.at).toBe("2026-11-22T09:00:00.000Z");
  });

  test("지금 표시는 지금 줄 하나에만 있고, 고른 줄도 하나다", () => {
    const lines = historyLinesOf(ENTRIES, 1);
    expect(lines.filter((l) => l.current).map((l) => l.label)).toEqual(["0.3.0"]);
    expect(lines.filter((l) => l.selected).map((l) => l.label)).toEqual(["0.2.0"]);
  });

  test("요약이 있으면 요약이 아래 글이고, 없거나 빈 글이면 승인한 쪽의 말이다", () => {
    const lines = historyLinesOf(
      [
        line({ summary: "검색을 더함" }),
        line({ summary: null, actor: "release" }),
        line({ summary: "   ", actor: "migration" }),
      ],
      0,
    );
    expect(lines[0]?.note).toEqual({ kind: "summary", text: "검색을 더함" });
    expect(lines[1]?.note).toEqual({
      kind: "actor",
      word: "desktop.workbench.history.actor.release",
    });
    expect(lines[2]?.note).toEqual({
      kind: "actor",
      word: "desktop.workbench.history.actor.migration",
    });
  });

  test("버전이 없으면 판의 해시 앞 8자를 글로 쓴다", () => {
    expect(versionLabelOf({ version: null, contentHash: `sha256:${"ab".repeat(32)}` })).toBe(
      "abababab",
    );
    expect(versionLabelOf({ version: "1.2.0", contentHash: hash("c") })).toBe("1.2.0");
  });

  test("고른 줄은 키로 찾고, 키가 없거나 없어진 줄이면 맨 앞(최신)이다", () => {
    expect(selectedIndexOf(ENTRIES, null)).toBe(0);
    expect(selectedIndexOf(ENTRIES, entryKeyOf(ENTRIES[2] ?? line({})))).toBe(2);
    expect(selectedIndexOf(ENTRIES, "없는 키")).toBe(0);
  });
});

describe("되돌리기 까닭", () => {
  const open = { current: false, kept: true };

  test("플러그인이 막는 까닭을 먼저 보인다(builtin, bundled, project, managed)", () => {
    expect(rollbackStopOf({ blocked: "builtin", locked: false, entry: open })).toBe("builtin");
    expect(rollbackStopOf({ blocked: "bundled", locked: false, entry: open })).toBe("bundled");
    expect(rollbackStopOf({ blocked: "project", locked: false, entry: open })).toBe("project");
    expect(rollbackStopOf({ blocked: "managed", locked: false, entry: open })).toBe("managed");
  });

  test("탭이 잠겨 있으면 managed와 같은 말이다", () => {
    const stop = rollbackStopOf({ blocked: null, locked: true, entry: open });
    expect(stop).toBe("locked");
    expect(stopWordOf("locked")).toBe(stopWordOf("managed"));
    expect(stopWordOf("managed")).toBe("desktop.workbench.history.stop.managed");
  });

  test("지금 판이면 지금 판의 까닭이고, 내용이 남지 않았으면 그 까닭이다", () => {
    expect(
      rollbackStopOf({ blocked: null, locked: false, entry: { current: true, kept: true } }),
    ).toBe("current");
    expect(
      rollbackStopOf({ blocked: null, locked: false, entry: { current: false, kept: false } }),
    ).toBe("notKept");
  });

  test("막는 까닭이 여럿이면 순서대로 첫 것이다(플러그인 막음, 잠금, 지금 판, 남지 않음)", () => {
    expect(
      rollbackStopOf({ blocked: "project", locked: true, entry: { current: true, kept: false } }),
    ).toBe("project");
    expect(
      rollbackStopOf({ blocked: null, locked: true, entry: { current: true, kept: false } }),
    ).toBe("locked");
    expect(
      rollbackStopOf({ blocked: null, locked: false, entry: { current: true, kept: false } }),
    ).toBe("current");
  });

  test("까닭이 없으면 되돌릴 수 있다", () => {
    expect(rollbackStopOf({ blocked: null, locked: false, entry: open })).toBeNull();
  });
});

describe("빠지는 바뀜", () => {
  test("고른 줄보다 최신인 줄을 최신이 앞인 순서로 준다", () => {
    const dropped = droppedOf(ENTRIES, 2);
    expect(dropped.lines.map((e) => e.version)).toEqual(["0.3.0", "0.2.0"]);
    expect(dropped.rest).toBe(0);
  });

  test("맨 앞을 고르면 빠지는 줄이 없다", () => {
    expect(droppedOf(ENTRIES, 0)).toEqual({ lines: [], rest: 0 });
  });

  test("다섯 줄까지 나열하고 나머지는 수로 센다", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      line({ version: `0.${String(i)}.0`, contentHash: hash(String(i)) }),
    );
    const dropped = droppedOf(many, 7);
    expect(DROPPED_LIMIT).toBe(5);
    expect(dropped.lines).toHaveLength(5);
    expect(dropped.lines.map((e) => e.version)).toEqual([
      "0.0.0",
      "0.1.0",
      "0.2.0",
      "0.3.0",
      "0.4.0",
    ]);
    expect(dropped.rest).toBe(2);
  });

  test("다섯 줄 이하면 나머지 수는 0이다", () => {
    expect(droppedOf(ENTRIES, 2).rest).toBe(0);
  });
});

describe("지금 판과 대기 중인 되돌리기", () => {
  test("지금 판의 글은 지금 줄의 버전이고, 지금 줄이 없으면 설치본 버전이다", () => {
    expect(currentLabelOf(ENTRIES, "0.9.0")).toBe("0.3.0");
    expect(currentLabelOf([line({ current: false })], "0.9.0")).toBe("0.9.0");
  });

  test("같은 이름의 대기 중인 되돌리기 항목만 고른다", () => {
    const [sample] = sampleItems();
    if (sample === undefined) throw new Error("sample item missing");
    const rollback = { fromVersion: "0.3.0", toVersion: "0.1.0", savedState: false };
    // 되돌리기가 없는 항목은 `rollback` 키 자체가 없다(`exactOptionalPropertyTypes`)
    const plain = { ...sample, name: "plug", state: "pending" as const };
    const items = [
      { ...sample, name: "other", state: "pending" as const, rollback },
      { ...sample, name: "plug", state: "approved" as const, rollback },
      plain,
      { ...sample, itemId: "rvw_rollback", name: "plug", state: "pending" as const, rollback },
    ];
    expect(pendingRollbackOf(items, "plug")).toEqual({ itemId: "rvw_rollback", to: "0.1.0" });
    expect(pendingRollbackOf(items, "missing")).toBeNull();
  });

  test("고른 줄의 변경 내용 읽기: 항목 id가 없으면 none, 다른 항목의 응답은 읽는 중이다", () => {
    const [sample] = sampleItems();
    if (sample === undefined) throw new Error("sample item missing");
    expect(detailRead(null, null)).toEqual({ kind: "none" });
    expect(detailRead("rvw_a", null)).toEqual({ kind: "loading" });
    expect(detailRead("rvw_a", { itemId: "rvw_b", read: { kind: "failed" } })).toEqual({
      kind: "loading",
    });
    expect(detailRead("rvw_a", { itemId: "rvw_a", read: { kind: "ready", item: sample } })).toEqual(
      {
        kind: "ready",
        item: sample,
      },
    );
  });

  test("하는 일의 차이는 더한 것, 바뀐 것, 뺀 것 가운데 하나라도 있어야 바뀐 것이다", () => {
    const empty: WhatItDoesDiff = {
      added: [],
      removed: [],
      changed: [],
      enforcementChange: null,
      costDelta: { always: null, onDemand: null },
    };
    expect(hasChangesOf(empty)).toBe(false);
    expect(hasChangesOf({ ...empty, changed: [{ row: "hook", what: "pre-tool" }] })).toBe(true);
  });
});

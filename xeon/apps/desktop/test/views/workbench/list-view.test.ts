import { describe, expect, test } from "bun:test";
import { rowOf, type ExtRowVM } from "@fresnel/client/workbench";
import { rowHealthOf } from "../../../src/views/workbench/plugin-cells.tsx";
import type { PluginKind } from "../../../src/views/workbench/plugin-kind.tsx";
import {
  listViewOf,
  sortKeyOf,
  sortRows,
  type TableSort,
} from "../../../src/views/workbench/list-view.ts";
import { entry } from "./support.tsx";

// 플러그인 목록의 보기 값, 표 정렬, 상태 칸 우선순위(순수 모델). 그리지 않는다.

/** 표시 이름을 정해 둔 줄 넷. 이름순은 Apple, Banana, Cherry, Date다 */
const ROWS: readonly ExtRowVM[] = [
  rowOf(entry("a-tool", { displayName: "Cherry" })),
  rowOf(entry("b-tool", { displayName: "Apple" })),
  rowOf(entry("c-tool", { displayName: "Banana" })),
  rowOf(entry("d-tool", { displayName: "Date" })),
];

/** 종류: c는 drive, a와 d는 tool, b는 카드가 없다(null) */
const KINDS = new Map<string, PluginKind>([
  ["a-tool", "tool"],
  ["c-tool", "drive"],
  ["d-tool", "tool"],
]);
const kindOf = (name: string): PluginKind | null => KINDS.get(name) ?? null;

const namesOf = (rows: readonly ExtRowVM[]): string[] => rows.map((row) => row.name);

const sorted = (sort: TableSort | null): string[] => namesOf(sortRows(ROWS, sort, kindOf));

describe("표 정렬: 이름", () => {
  test("정렬을 걸지 않으면 들어온 순서 그대로다", () => {
    expect(sorted(null)).toEqual(["a-tool", "b-tool", "c-tool", "d-tool"]);
  });

  test("오름차순은 보이는 이름순이고, 내림차순은 뒤집는다", () => {
    expect(sorted({ key: "name", direction: "ascending" })).toEqual([
      "b-tool",
      "c-tool",
      "a-tool",
      "d-tool",
    ]);
    expect(sorted({ key: "name", direction: "descending" })).toEqual([
      "d-tool",
      "a-tool",
      "c-tool",
      "b-tool",
    ]);
  });
});

describe("표 정렬: 종류", () => {
  test("오름차순은 KIND_ORDER(drive, inject, tool, hook) 순서이고 카드 없는 줄은 끝, 같은 종류 안은 이름순이다", () => {
    expect(sorted({ key: "kind", direction: "ascending" })).toEqual([
      "c-tool",
      "a-tool",
      "d-tool",
      "b-tool",
    ]);
  });

  test("내림차순은 오름차순을 뒤집는다", () => {
    expect(sorted({ key: "kind", direction: "descending" })).toEqual([
      "b-tool",
      "d-tool",
      "a-tool",
      "c-tool",
    ]);
  });
});

describe("열 키와 보기 값", () => {
  test("정렬할 수 있는 열은 이름과 종류뿐이다", () => {
    expect(sortKeyOf("name")).toBe("name");
    expect(sortKeyOf("kind")).toBe("kind");
    expect(sortKeyOf("version")).toBeNull();
  });

  test("보기 값은 cards만 카드이고, 나머지는 표다", () => {
    expect(listViewOf("cards")).toBe("cards");
    expect(listViewOf("table")).toBe("table");
    expect(listViewOf("grid")).toBe("table");
  });
});

describe("상태 칸 우선순위", () => {
  test("멈춤 > 안전 모드에서 빠짐 > 문제 있음 > 준비 안 됨 > 준비됨", () => {
    expect(rowHealthOf({ state: "auto_disabled", failed: true }, true)).toBe("stopped");
    expect(rowHealthOf({ state: "safe_excluded", failed: true }, true)).toBe("safeMode");
    expect(rowHealthOf({ state: "on", failed: true }, true)).toBe("problem");
    expect(rowHealthOf({ state: "on", failed: false }, true)).toBe("notReady");
    expect(rowHealthOf({ state: "on", failed: false }, false)).toBe("ready");
    expect(rowHealthOf({ state: "on", failed: false })).toBe("ready");
  });
});

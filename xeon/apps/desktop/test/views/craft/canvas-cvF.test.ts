// cvF "도면" 시안의 순수 모델과 기하: 자리 안 순서(스타트 Drive·가드 먼저), 넣기·빼기·옮기기의 거절 사유,
// 묶음째 넣고 빼기, 프로필 안 관계(핸드오프·의존), 쌓인 줄이 겹치지 않는 배치, 묶음 구역과 참조 표.
// 값은 표본(`shared-sample.ts`의 프로필 "개발", "규모")에서 읽는다.
import { describe, expect, test } from "bun:test";
import { layoutProfile } from "../../../src/views/craft/canvas/cvF/layout.ts";
import {
  addGroup,
  addPlugin,
  CATALOG,
  move,
  moveInGroup,
  PROFILES,
  type Profile,
  relationRows,
  relationsOf,
  removeGroup,
  removePlugin,
  sourceOf,
  spotOrder,
} from "../../../src/views/craft/canvas/cvF/model.ts";

const dev = PROFILES.dev;

function applied(edit: ReturnType<typeof addPlugin>): Profile | string {
  return edit.ok ? edit.profile : edit.reason;
}

describe("cvF 자리 안 순서", () => {
  test("베이스가 앞, 가드 Hook이 먼저, 스타트 Drive가 먼저", () => {
    expect(spotOrder(dev, CATALOG, "feed:context")).toEqual([
      "memory",
      "house-style",
      "repo-skills",
    ]);
    expect(spotOrder(dev, CATALOG, "before:tools")).toEqual(["secret-guard", "commit-msg"]);
    expect(spotOrder(dev, CATALOG, "drive")).toEqual(["helm", "verifier"]);
    expect(spotOrder(dev, CATALOG, "boundary:before-turn-end")).toEqual([]);
  });
});

describe("cvF 편집", () => {
  test("베이스는 뺄 수 없고, 묶음 구성원은 하나만 뺄 수 없다", () => {
    expect(applied(removePlugin(dev, "memory"))).toBe("base");
    expect(applied(removePlugin(dev, "verifier"))).toBe("inGroup");
    expect(applied(removePlugin(dev, "nope"))).toBe("absent");
  });

  test("하나를 빼면 목록에서만 빠지고 스타트 Drive를 빼면 비운다", () => {
    const out = removePlugin(dev, "helm");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.profile.plugins).toEqual([
      "house-style",
      "repo-skills",
      "lint-on-edit",
      "cost-cap",
      "verifier",
      "github-mcp",
      "commit-msg",
    ]);
    expect(out.profile.startDrive).toBe(null);
  });

  test("묶음은 묶음째 빼고, 구성원 하나를 넣으면 묶음째 들어온다", () => {
    const out = removeGroup(dev, "quality");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.profile.plugins).toEqual([
      "house-style",
      "repo-skills",
      "cost-cap",
      "helm",
      "github-mcp",
      "commit-msg",
    ]);
    const back = addPlugin(out.profile, "verifier");
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.profile.plugins.slice(-2)).toEqual(["lint-on-edit", "verifier"]);
    expect(applied(addGroup(dev, "quality"))).toBe("present");
  });

  test("누가 넣었나: 베이스, 묶음, 프로필", () => {
    expect(sourceOf(dev, "memory")).toEqual({ kind: "base" });
    expect(sourceOf(dev, "lint-on-edit")).toEqual({ kind: "group", group: "quality" });
    expect(sourceOf(dev, "cost-cap")).toEqual({ kind: "profile" });
  });

  test("옮기기: 같은 자리에서 맞바꾸고, 베이스·가드·스타트 Drive와 끝은 거절한다", () => {
    const out = move(dev, CATALOG, "repo-skills", -1);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(spotOrder(out.profile, CATALOG, "feed:context")).toEqual([
      "memory",
      "repo-skills",
      "house-style",
    ]);
    expect(applied(move(dev, CATALOG, "house-style", -1))).toBe("edge");
    expect(applied(move(dev, CATALOG, "memory", 1))).toBe("base");
    expect(applied(move(dev, CATALOG, "helm", 1))).toBe("guard");
    expect(applied(move(dev, CATALOG, "commit-msg", 1))).toBe("edge");
  });

  test("묶음 안 순서를 바꾼다", () => {
    const out = moveInGroup(dev, "quality", "verifier", -1);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.profile.groups.map((g) => g.members)).toEqual([["verifier", "lint-on-edit"]]);
    expect(applied(moveInGroup(dev, "quality", "lint-on-edit", -1))).toBe("edge");
  });
});

describe("cvF 관계", () => {
  test("프로필 안에서는 핸드오프와 capability 의존만 선이 된다", () => {
    expect(relationsOf(dev, CATALOG)).toEqual([
      { kind: "handoff", from: "helm", to: "verifier" },
      { kind: "depends", from: "helm", to: "memory", capability: "knowledge.memory" },
    ]);
  });

  test("상세 판의 관계 줄: 받는 쪽은 넘겨받음, 내는 쪽은 의존 받음", () => {
    expect(
      relationRows(dev, CATALOG, "verifier").map((r) => [r.kind, r.other, r.present]),
    ).toContainEqual(["handoffFrom", "helm", true]);
    expect(
      relationRows(dev, CATALOG, "memory").map((r) => [r.kind, r.other, r.via]),
    ).toContainEqual(["providesTo", "helm", "knowledge.memory"]);
  });
});

type Box = { x: number; y: number; w: number; h: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
describe("cvF 배치", () => {
  test("펼친 묶음: 구성원은 구역 안에, 다른 자리에는 참조 표(A1)가 남는다", () => {
    const l = layoutProfile(dev, CATALOG, new Set());
    expect(l.cards.filter((c) => c.zone !== null).map((c) => [c.name, c.mark])).toEqual([
      ["lint-on-edit", "A1"],
      ["verifier", "A2"],
    ]);
    expect(l.marks.map((m) => m.item)).toEqual([
      { type: "ref", name: "lint-on-edit", zone: "quality", mark: "A1" },
    ]);
    expect(l.zones.map((z) => [z.letter, z.collapsed, z.members])).toEqual([
      ["A", false, ["lint-on-edit", "verifier"]],
    ]);
    expect(l.points.map((p) => p.spot)).toEqual(["before:model", "before:tools", "after:tools"]);
  });

  test("접은 묶음은 더 좁다", () => {
    const open = layoutProfile(dev, CATALOG, new Set());
    const shut = layoutProfile(dev, CATALOG, new Set(["quality"]));
    expect(shut.zones[0]?.collapsed).toBe(true);
    expect((shut.zones[0]?.w ?? 0) < (open.zones[0]?.w ?? 0)).toBe(true);
  });

  test("규모 프로필 30장: 카드끼리 겹치지 않는다", () => {
    const l = layoutProfile(PROFILES.scale, CATALOG, new Set());
    expect(l.cards.length).toBe(30);
    const boxes = l.cards
      .filter((c) => c.zone === null)
      .map((c) => ({ x: c.x, y: c.y, w: 228, h: 124 }));
    const hits = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => overlaps(a, b)));
    expect(hits).toEqual([]);
  });
});

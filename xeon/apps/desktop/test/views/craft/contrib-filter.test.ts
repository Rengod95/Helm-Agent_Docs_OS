// 구성 요소 거르기(`contrib`)가 보이는 화면마다 맞는 것만 남기는지: 지도, 층 패널, 순서 줄, 링크.
// 값은 `buildFixture(18)`(시안의 플러그인 18개, 고정 값)에서 읽는다.
import { describe, expect, test } from "bun:test";
import { INITIAL_WORKBENCH, toggleContrib } from "@fresnel/client/workbench";
import {
  FIXTURE_ORDER,
  buildFixture,
  hooksInOrder,
  relationsOf,
  type CanvasPlugin,
  type CanvasSnapshot,
  type Contrib,
} from "@fresnel/client/workbench/canvas";
import { groupShown, layerPlugins, shownOnMap } from "../../../src/views/craft/orbit-model.ts";
import { relationContext, rowsOf, visibleRels } from "../../../src/views/craft/link-model.ts";
import { mergeVisibleLane, visibleLane } from "../../../src/views/craft/strata-model.ts";

const fixture = buildFixture(18);
const byId = (id: string): CanvasPlugin => {
  const p = fixture.plugins.find((x) => x.id === id);
  if (p === undefined) throw new Error(`fixture has no ${id}`);
  return p;
};
const idsOf = (plugins: readonly CanvasPlugin[]): string[] => plugins.map((p) => p.id);
/** 루트가 없는 그룹 docs-pack의 구성원 하나. 구성 요소만 다르고 나머지는 같다 */
const docsPlugin = (
  id: string,
  layer: "L2" | "L3",
  pieces: CanvasPlugin["pieces"],
): CanvasPlugin => ({
  id,
  name: id,
  layer,
  group: "docs-pack",
  origin: "user",
  hooks: [],
  provides: [],
  pieces,
  on: true,
});

describe("구성 요소 거르기: 토글 값", () => {
  test("토글하면 고른 구성 요소가 들고, 다시 누르면 빠진다", () => {
    const on = toggleContrib(INITIAL_WORKBENCH, "skill");
    expect(on.contrib).toEqual(["skill"]);
    expect(toggleContrib(on, "tool").contrib).toEqual(["skill", "tool"]);
    expect(toggleContrib(on, "skill").contrib).toEqual([]);
  });
});

describe("지도: 고른 구성 요소를 넣어 주는 점만 그린다", () => {
  test("구성 요소를 고르지 않으면 점이 전부 남는다", () => {
    expect(idsOf(shownOnMap(fixture, []))).toHaveLength(18);
  });

  test("스킬을 고르면 스킬을 넣어 주는 플러그인만 남는다", () => {
    const state = toggleContrib(INITIAL_WORKBENCH, "skill");
    expect(idsOf(shownOnMap(fixture, state.contrib))).toEqual([
      "helm/explore",
      "learning",
      "compact-keep",
      "acme-notes",
      "pr-kit",
    ]);
  });

  test("고른 것 가운데 하나라도 맞으면 남는다(합집합)", () => {
    expect(idsOf(shownOnMap(fixture, ["mcp", "view"]))).toEqual([
      "helm/panel",
      "acme-notes",
      "pr-kit",
    ]);
  });

  test("훅을 고르면 훅 선언이 있는 점만 남는다", () => {
    expect(idsOf(shownOnMap(fixture, ["hook"]))).toEqual([
      "helm",
      "learning",
      "review",
      "review/lens",
      "cost-router",
      "compact-keep",
      "secret-scan",
      "lint-on-edit",
      "notify-done",
      "acme-notes",
      "pr-kit",
    ]);
  });

  test("호는 구성원 가운데 남는 것이 있을 때만 그린다", () => {
    expect(groupShown(fixture, "learning", ["command"])).toBe(true);
    expect(groupShown(fixture, "learning", ["mcp"])).toBe(false);
    expect(groupShown(fixture, "helm", ["view"])).toBe(true);
    expect(groupShown(fixture, "helm", ["mcp"])).toBe(false);
  });
});

describe("층 패널: 고른 구성 요소에 맞는 층의 플러그인만 준다", () => {
  test("L3에서 명령을 고르면 명령을 넣어 주는 L3 플러그인만 남는다", () => {
    expect(idsOf(layerPlugins(fixture, "L3", ["command"]))).toEqual(["helm", "learning", "review"]);
  });

  test("L2에서 도구를 고르면 도구를 넣어 주는 L2 플러그인만 남는다", () => {
    expect(idsOf(layerPlugins(fixture, "L2", ["tool"]))).toEqual([
      "helm/explore",
      "learning/ledger",
      "web",
      "knowledge",
      "work",
    ]);
  });
});

describe("순서 줄: 맞지 않는 핸들러는 줄에서 숨기고, 저장할 순서는 가려진 것까지 지킨다", () => {
  const lanes = hooksInOrder(fixture.plugins, FIXTURE_ORDER);
  const lane = lanes["boundary.settle.after"] ?? [];

  test("명령을 고르면 boundary.settle.after 줄에는 명령이 있는 핸들러만 남는다", () => {
    expect(lane).toEqual(["helm", "learning", "review", "notify-done"]);
    expect(visibleLane(lane, fixture, ["command"])).toEqual(["helm", "learning", "review"]);
  });

  test("보이는 핸들러의 새 순서는 가려진 핸들러를 제자리에 둔 채 전체 줄에 합쳐진다", () => {
    expect(mergeVisibleLane(lane, fixture, ["command"], ["review", "helm", "learning"])).toEqual([
      "review",
      "helm",
      "learning",
      "notify-done",
    ]);
  });

  test("구성 요소를 고르지 않으면 줄은 그대로다", () => {
    expect(visibleLane(lane, fixture, [])).toEqual(lane);
  });
});

describe("링크: 맞지 않는 상대는 줄과 실에서 뺀다", () => {
  test("초점 helm의 상대 가운데 도구를 넣어 주는 것만 남는다", () => {
    const lanes = hooksInOrder(fixture.plugins, FIXTURE_ORDER);
    const rels = relationsOf(byId("helm"), fixture, relationContext(fixture, lanes));
    expect(rowsOf(rels).map((r) => r.other.id)).toHaveLength(13);
    expect(rowsOf(visibleRels(rels, ["tool"])).map((r) => r.other.id)).toEqual([
      "exa",
      "helm/explore",
      "knowledge",
      "learning/ledger",
      "web",
      "work",
    ]);
  });

  test("구성 요소를 고르지 않으면 관계는 그대로다", () => {
    const lanes = hooksInOrder(fixture.plugins, FIXTURE_ORDER);
    const rels = relationsOf(byId("helm"), fixture, relationContext(fixture, lanes));
    expect(visibleRels(rels, [])).toEqual(rels);
  });
});

describe("대표 플러그인이 없는 그룹: 구성원 가운데 맞는 것이 있으면 그룹과 그 조각을 남긴다", () => {
  // 루트 플러그인(그룹 이름과 같은 id)이 없는 그룹 docs-pack. 구성원마다 넣어 주는 것이 다르다.
  const withDocs: CanvasSnapshot = {
    plugins: [
      ...fixture.plugins,
      docsPlugin("docs-pack/search", "L2", [
        { kind: "tool", name: "note_search" },
        { kind: "skill", name: "note-style" },
      ]),
      docsPlugin("docs-pack/notes", "L3", [{ kind: "mcp", name: "docs-server" }]),
      docsPlugin("docs-pack/index", "L3", [{ kind: "command", name: "index-docs" }]),
    ],
    groups: [
      ...fixture.groups,
      {
        id: "docs-pack",
        name: "Docs pack",
        version: "1.0.0",
        origin: "user",
        members: ["docs-pack/search", "docs-pack/notes", "docs-pack/index"],
      },
    ],
  };
  /** 스냅샷 순서대로 보이는 그룹 id들(지도는 이 순서로 호를 그린다) */
  const groupsShown = (contrib: readonly Contrib[]): string[] =>
    withDocs.groups.map((g) => g.id).filter((gid) => groupShown(withDocs, gid, contrib));
  /** 그룹의 구성원 가운데 지도에 남는 것(구성원 순서대로) */
  const membersShown = (gid: string, contrib: readonly Contrib[]): string[] => {
    const onMap = new Set(shownOnMap(withDocs, contrib).map((p) => p.id));
    const members = withDocs.groups.find((g) => g.id === gid)?.members ?? [];
    return members.filter((id) => onMap.has(id));
  };

  test("구성 요소를 고르지 않으면 그룹과 구성원이 전부 남는다", () => {
    expect(groupsShown([])).toEqual(["helm", "learning", "review", "docs-pack"]);
    expect(membersShown("docs-pack", [])).toEqual([
      "docs-pack/search",
      "docs-pack/notes",
      "docs-pack/index",
    ]);
  });

  test("도구를 고르면 대표가 없어도 그룹이 남고, 도구를 넣어 주는 구성원만 남는다", () => {
    expect(groupsShown(["tool"])).toEqual(["helm", "learning", "docs-pack"]);
    expect(membersShown("docs-pack", ["tool"])).toEqual(["docs-pack/search"]);
  });

  test("맞는 구성 요소가 없는 그룹은 호와 구성원을 모두 숨긴다", () => {
    expect(groupShown(withDocs, "docs-pack", ["view"])).toBe(false);
    expect(groupsShown(["view"])).toEqual(["helm"]);
    expect(membersShown("docs-pack", ["view"])).toEqual([]);
  });

  test("층 패널도 대표가 없는 그룹의 맞는 구성원을 보인다", () => {
    expect(idsOf(layerPlugins(withDocs, "L2", ["tool"]))).toEqual([
      "helm/explore",
      "learning/ledger",
      "web",
      "knowledge",
      "work",
      "docs-pack/search",
    ]);
    expect(idsOf(layerPlugins(withDocs, "L3", ["mcp"]))).toEqual(["docs-pack/notes"]);
  });
});

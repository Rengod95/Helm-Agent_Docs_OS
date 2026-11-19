import { describe, expect, test } from "bun:test";
import { BLOCK_MODEL } from "@fresnel/contracts/blocks";
import {
  layoutProfile,
  nearestSlot,
  readingOrder,
  slotsFor,
  spread,
} from "../../../src/views/craft/canvas/cvA/layout.ts";
import {
  BOUNDARIES,
  RAIL_BLOCKS,
  catalogOf,
  handoffsOf,
  nudge,
  orderInStack,
  place,
  removeFrom,
  stackOrder,
  targetsFor,
} from "../../../src/views/craft/canvas/cvA/model.ts";
import { SAMPLE_PLUGINS, SAMPLE_PROFILE } from "../../../src/views/craft/canvas/cvA/sample.ts";

const catalog = catalogOf(SAMPLE_PLUGINS);
const profile = SAMPLE_PROFILE;

describe("cvA 레일", () => {
  test("블록과 경계는 엔진의 블록 모델과 같다(기록은 돌아오는 길에 따로 선다)", () => {
    expect([...RAIL_BLOCKS]).toEqual(
      BLOCK_MODEL.blocks.map((b) => b.id).filter((id) => id !== "record"),
    );
    expect([...BOUNDARIES].toSorted()).toEqual(BLOCK_MODEL.boundaries.map((b) => b.id).toSorted());
  });
});

describe("cvA 줄 순서", () => {
  test("베이스가 먼저, 그다음 프로필 순서", () => {
    expect(stackOrder(profile, catalog, { lane: "feed", station: "context" })).toEqual([
      "memory",
      "house-style",
      "repo-skills",
    ]);
  });

  test("같은 Hook 자리에서는 가드가 먼저", () => {
    expect(stackOrder(profile, catalog, { lane: "hook", port: "tools.before" })).toEqual([
      "secret-guard",
      "commit-msg",
    ]);
  });

  test("Drive 줄은 스타트 Drive가 맨 앞", () => {
    expect(stackOrder(profile, catalog, { lane: "drive" })).toEqual(["helm", "verifier"]);
  });

  test("핸드오프는 둘 다 프로필에 있을 때만", () => {
    expect(handoffsOf(profile, catalog)).toEqual([{ from: "helm", to: "verifier" }]);
  });
});

describe("cvA 놓을 자리와 편집", () => {
  test("가드가 아닌 Hook은 가드 앞에 놓을 수 없다", () => {
    expect(targetsFor(profile, catalog, "commit-msg").map((t) => t.index)).toEqual([1]);
    expect(targetsFor(profile, catalog, "test-runner")).toEqual([
      { key: { lane: "hook", port: "before-turn-end" }, index: 0 },
    ]);
  });

  test("목록에서 끌어 놓으면 프로필 끝에 들고 그 줄에 선다", () => {
    const next = place(profile, catalog, "test-runner", {
      key: { lane: "hook", port: "before-turn-end" },
      index: 0,
    });
    expect(next.plugins.at(-1)).toBe("test-runner");
    expect(orderInStack(next, catalog, "test-runner")).toBe(1);
  });

  test("Drive 줄 0번에 놓으면 스타트 Drive가 바뀐다", () => {
    const next = place(profile, catalog, "web-research", { key: { lane: "drive" }, index: 0 });
    expect(next.startDrive).toBe("web-research");
    expect(stackOrder(next, catalog, { lane: "drive" })).toEqual([
      "web-research",
      "helm",
      "verifier",
    ]);
  });

  test("한 칸 앞으로", () => {
    const next = nudge(profile, catalog, "repo-skills", -1);
    expect(stackOrder(next, catalog, { lane: "feed", station: "context" })).toEqual([
      "memory",
      "repo-skills",
      "house-style",
    ]);
  });

  test("가드 앞으로는 가지 않는다", () => {
    expect(nudge(profile, catalog, "commit-msg", -1)).toEqual(profile);
  });

  test("베이스에서 온 것은 빼지 않는다", () => {
    expect(removeFrom(profile, "secret-guard")).toEqual(profile);
  });

  test("빼면 묶음에서도 빠지고, 하나 남은 묶음은 풀린다", () => {
    const next = removeFrom(profile, "verifier");
    expect(next.plugins).not.toContain("verifier");
    expect(next.groups).toEqual([]);
  });
});

describe("cvA 배치", () => {
  test("겹치는 가운데는 평균을 가운데로 두고 편다", () => {
    expect(spread([0, 10], 100)).toEqual([-45, 55]);
    expect(spread([0, 300], 100)).toEqual([0, 300]);
  });

  test("열린 묶음은 구성원이 노드로, 접힌 묶음은 묶음 노드 하나로 선다", () => {
    const open = layoutProfile(profile, catalog, new Set());
    expect(open.nodes.map((n) => n.id).toSorted()).toEqual(
      [
        "commit-msg",
        "cost-cap",
        "github-mcp",
        "helm",
        "house-style",
        "lint-on-edit",
        "memory",
        "repo-skills",
        "secret-guard",
        "verifier",
      ].toSorted(),
    );
    const closed = layoutProfile(profile, catalog, new Set(["quality"]));
    const ids = closed.nodes.map((n) => n.id);
    expect(ids).toContain("group:quality");
    expect(ids).not.toContain("verifier");
    expect(ids).not.toContain("lint-on-edit");
  });

  test("키보드 이동 순서는 모든 노드를 한 번씩 지난다", () => {
    const layout = layoutProfile(profile, catalog, new Set());
    expect(readingOrder(layout).toSorted()).toEqual(layout.nodes.map((n) => n.id).toSorted());
  });

  test("끄는 동안 놓을 자리는 놓을 수 있는 자리 수와 같고, 자리 위에서는 그 자리를 고른다", () => {
    const layout = layoutProfile(profile, catalog, new Set());
    const slots = slotsFor(layout, profile, catalog, "commit-msg");
    expect(slots.length).toBe(targetsFor(profile, catalog, "commit-msg").length);
    const first = slots[0];
    expect(first === undefined ? null : nearestSlot(slots, first.anchor)).toEqual(first ?? null);
  });
});

// cvC 프로필 캔버스 시안의 순수 모델: 자리 찾기, 실행 순서, 바꾸기, 묶음 접기, 배치, 내부 그림.
import { describe, expect, test } from "bun:test";
import { planOf } from "../../../src/views/craft/canvas/cvC/inside.tsx";
import {
  anchorOfGroup,
  cardKey,
  cardsAt,
  effectiveNames,
  handoffsOf,
  layoutOf,
  membersAt,
  minIndexAt,
  nudgePlugin,
  outsideNames,
  placeOf,
  placePlugin,
  removePlugin,
  type Place,
} from "../../../src/views/craft/canvas/cvC/model.ts";
import { nearestSlot } from "../../../src/views/craft/canvas/cvC/profile-canvas.tsx";
import {
  CATALOG,
  pluginOf,
  sampleProfiles,
  type SampleProfile,
} from "../../../src/views/craft/canvas/cvC/sample.ts";

const DEV = sampleProfiles().find((x) => x.id === "dev");

function dev(): SampleProfile {
  if (DEV === undefined) throw new Error("sample profile dev missing");
  return DEV;
}

const TOOLS_BEFORE: Place = { lane: "point", point: "tools", side: "before" };
const CONTEXT_IN: Place = { lane: "point", point: "context", side: "in" };
const DRIVE: Place = { lane: "drive" };
const NONE: ReadonlySet<string> = new Set();

const names = (profile: SampleProfile, place: Place): readonly string[] =>
  membersAt(profile, place).map((m) => m.name);

describe("placeOf", () => {
  test("Hook은 BLOCK_MODEL의 훅 이름으로 지점과 칸을 찾는다", () => {
    expect(placeOf("secret-guard")).toEqual(TOOLS_BEFORE);
    expect(placeOf("lint-on-edit")).toEqual({ lane: "point", point: "tools", side: "after" });
    expect(placeOf("cost-cap")).toEqual({ lane: "point", point: "model", side: "before" });
    expect(placeOf("test-runner")).toEqual({ lane: "point", point: "before-turn-end", side: "at" });
  });

  test("Inject는 컨텍스트 몸통, 도구는 실행 몸통, Drive는 Drive 줄이다", () => {
    expect(placeOf("house-style")).toEqual(CONTEXT_IN);
    expect(placeOf("memory")).toEqual(CONTEXT_IN);
    expect(placeOf("github-mcp")).toEqual({ lane: "point", point: "tools", side: "in" });
    expect(placeOf("helm")).toEqual(DRIVE);
    expect(placeOf("nope")).toBeNull();
  });
});

describe("실행 순서", () => {
  test("베이스가 프로필 순서 앞에 온다", () => {
    expect(effectiveNames(dev()).slice(0, 3)).toEqual(["memory", "secret-guard", "helm"]);
  });

  test("고정(베이스·가드)이 자리의 앞이고 그 뒤로 프로필 순서", () => {
    expect(names(dev(), TOOLS_BEFORE)).toEqual(["secret-guard", "commit-msg"]);
    expect(names(dev(), CONTEXT_IN)).toEqual(["memory", "house-style", "repo-skills"]);
    expect(minIndexAt(dev(), TOOLS_BEFORE)).toBe(1);
    expect(minIndexAt(dev(), CONTEXT_IN)).toBe(1);
  });

  test("출처: 베이스, 드래프트, 프로필", () => {
    const sources = membersAt(dev(), TOOLS_BEFORE).map((m) => [m.name, m.source, m.fixed]);
    expect(sources).toEqual([
      ["secret-guard", "base", true],
      ["commit-msg", "draft", false],
    ]);
  });

  test("Drive 줄은 스타트 Drive가 먼저", () => {
    expect(names(dev(), DRIVE)).toEqual(["helm", "verifier"]);
    const flipped = { ...dev(), startDrive: "verifier" };
    expect(names(flipped, DRIVE)).toEqual(["verifier", "helm"]);
  });
});

describe("바꾸기", () => {
  test("빼기는 프로필 목록·스타트 Drive·드래프트에서 함께 지운다. 베이스는 그대로", () => {
    const out = removePlugin(dev(), "helm");
    expect(out.plugins.includes("helm")).toBe(false);
    expect(out.startDrive).toBeNull();
    expect(removePlugin(dev(), "commit-msg").drafts).toEqual([]);
    expect(removePlugin(dev(), "memory")).toBe(dev());
  });

  test("밖의 플러그인을 자리 칸에 놓으면 그 칸 순서로 든다", () => {
    const out = placePlugin(dev(), "changelog", CONTEXT_IN, 1);
    expect(names(out, CONTEXT_IN)).toEqual(["memory", "changelog", "house-style", "repo-skills"]);
    const last = placePlugin(dev(), "changelog", CONTEXT_IN, 9);
    expect(names(last, CONTEXT_IN)).toEqual(["memory", "house-style", "repo-skills", "changelog"]);
  });

  test("고정 앞 칸에는 놓지 못하고 고정 바로 뒤로 간다", () => {
    const out = placePlugin(dev(), "changelog", CONTEXT_IN, 0);
    expect(names(out, CONTEXT_IN)).toEqual(["memory", "changelog", "house-style", "repo-skills"]);
  });

  test("맞지 않는 자리와 베이스는 그대로 돌려준다", () => {
    expect(placePlugin(dev(), "changelog", TOOLS_BEFORE, 1)).toBe(dev());
    expect(placePlugin(dev(), "memory", CONTEXT_IN, 2)).toBe(dev());
  });

  test("Drive 줄 첫 칸에 놓으면 스타트 Drive가 된다", () => {
    const out = placePlugin(dev(), "web-research", DRIVE, 0);
    expect(out.startDrive).toBe("web-research");
    expect(names(out, DRIVE)).toEqual(["web-research", "helm", "verifier"]);
  });

  test("한 칸 옮기기. 고정 앞이나 끝 밖으로는 가지 않는다", () => {
    expect(names(nudgePlugin(dev(), "repo-skills", -1), CONTEXT_IN)).toEqual([
      "memory",
      "repo-skills",
      "house-style",
    ]);
    expect(nudgePlugin(dev(), "house-style", -1)).toBe(dev());
    expect(nudgePlugin(dev(), "repo-skills", 1)).toBe(dev());
  });

  test("드래프트는 옮겨도 드래프트로 남는다", () => {
    const out = placePlugin(dev(), "commit-msg", TOOLS_BEFORE, 1);
    expect(out.drafts).toEqual(["commit-msg"]);
  });

  test("프로필 밖의 설치된 것", () => {
    const outside = outsideNames(
      dev(),
      CATALOG.map((p) => p.name),
    );
    expect(outside).toEqual(["web-research", "changelog", "test-runner"]);
  });
});

describe("묶음", () => {
  test("접힌 묶음은 지점 순서에서 먼저인 구성원 자리에 한 장으로 선다", () => {
    const group = dev().groups[0];
    if (group === undefined) throw new Error("group missing");
    expect(anchorOfGroup(dev(), group)).toBe("lint-on-edit");
    const collapsed = new Set(["quality"]);
    const after = cardsAt(dev(), { lane: "point", point: "tools", side: "after" }, collapsed);
    expect(after.map(cardKey)).toEqual(["group:quality"]);
    expect(cardsAt(dev(), DRIVE, collapsed).map(cardKey)).toEqual(["helm"]);
  });

  test("핸드오프 끝이 접힌 묶음 안이면 묶음 장으로 간다", () => {
    expect(handoffsOf(layoutOf(dev(), NONE, null))).toEqual([{ from: "helm", to: "verifier" }]);
    expect(handoffsOf(layoutOf(dev(), new Set(["quality"]), null))).toEqual([
      { from: "helm", to: "group:quality" },
    ]);
  });
});

describe("배치", () => {
  test("지점 여덟 개가 서고, 위 줄은 왼쪽에서 오른쪽, 아래 줄은 오른쪽에서 왼쪽", () => {
    const layout = layoutOf(dev(), NONE, null);
    const ids = layout.stations.map((s) => s.point);
    expect(ids.length).toBe(8);
    const x = (id: string): number => layout.stations.find((s) => s.point === id)?.rect.x ?? -1;
    expect(x("input-received") < x("context")).toBe(true);
    expect(x("context") < x("model")).toBe(true);
    expect(x("model") < x("tools")).toBe(true);
    expect(x("before-turn-end") < x("ask")).toBe(true);
  });

  test("쉴 때는 놓을 칸이 없고, 끌 때는 그 자리에만 칸이 생긴다", () => {
    expect(layoutOf(dev(), NONE, null).slots).toEqual([]);
    const drag = layoutOf(dev(), NONE, { place: CONTEXT_IN, hot: -1 });
    expect(drag.slots.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(drag.stations.filter((s) => s.open).map((s) => s.point)).toEqual(["context"]);
  });

  test("가장 가까운 칸을 고르고 멀면 -1", () => {
    const idle = layoutOf(dev(), NONE, { place: CONTEXT_IN, hot: -1 });
    const slot = idle.slots[1];
    if (slot === undefined) throw new Error("slot missing");
    const cx = slot.rect.x + slot.rect.w / 2;
    const cy = slot.rect.y + slot.rect.h / 2;
    expect(nearestSlot(idle, cx, cy)).toBe(2);
    expect(nearestSlot(idle, cx + 5000, cy)).toBe(-1);
  });
});

function pieceTypes(name: string): readonly string[] {
  const p = pluginOf(name);
  if (p === undefined) throw new Error(`${name} missing`);
  return [...new Set(planOf(p).pieces.map((x) => x.type))].toSorted();
}

describe("내부 그림", () => {
  const types = pieceTypes;

  test("helm은 자기 루프의 단계와 핸드오프 받는 쪽을 그린다. Drive라 지점 출구는 없다", () => {
    expect(types("helm")).toEqual([
      "entry",
      "frame",
      "ghost",
      "part",
      "permission",
      "settings",
      "step",
    ]);
  });

  test("Hook은 핸들러, 코드 없는 Inject는 내용 칸과 권한만", () => {
    expect(types("secret-guard").includes("hook")).toBe(true);
    expect(types("secret-guard").includes("pill")).toBe(true);
    expect(types("repo-skills").includes("step")).toBe(false);
    expect(types("repo-skills").includes("permission")).toBe(true);
  });
});

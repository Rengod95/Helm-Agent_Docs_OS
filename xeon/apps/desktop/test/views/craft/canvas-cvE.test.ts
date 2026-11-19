// cvE "궤도" 시안의 순수 모델과 기하: 같은 자리의 순서(가드 먼저), 넣기·옮기기·빼기, 놓을 수 있는 자리, 묶음 접기, 내부 판.
// 값은 표본(`cvE/sample.ts`, AGE-6 브리프의 프로필 "개발")에서 읽는다.
import { describe, expect, test } from "bun:test";
import { insideLayout, MINI_RING } from "../../../src/views/craft/canvas/cvE/inside-layout.ts";
import {
  dropTargets,
  layoutBoard,
  polar,
  STATION_ANGLE,
} from "../../../src/views/craft/canvas/cvE/layout.ts";
import {
  handoffs,
  insertAt,
  move,
  readingOrder,
  remove,
  setStart,
  stackAt,
} from "../../../src/views/craft/canvas/cvE/model.ts";
import {
  SAMPLE_DEFS,
  SAMPLE_PROFILE,
  SCALE_PROFILE,
} from "../../../src/views/craft/canvas/cvE/sample.ts";

const defs = SAMPLE_DEFS;
const dev = SAMPLE_PROFILE;

function byId(a: readonly string[], b: readonly string[]): number {
  return (a[0] ?? "").localeCompare(b[0] ?? "");
}

function sampleDef(id: string): (typeof SAMPLE_DEFS)[string] {
  // 없으면 빈 Inject가 되어 아래 기대 값이 틀린다
  return SAMPLE_DEFS[id] ?? { id, kind: "inject", parts: [] };
}

describe("같은 자리의 순서", () => {
  test("도구 호출 앞: 가드(secret-guard)가 프로필 순서와 상관없이 먼저다", () => {
    expect(stackAt(dev, defs, "tools.before")).toEqual(["secret-guard", "commit-msg"]);
  });
  test("고리 안(Inject)은 프로필 순서다", () => {
    expect(stackAt(dev, defs, "inside")).toEqual(["memory", "house-style", "repo-skills"]);
  });
  test("Drive 줄과 핸드오프", () => {
    expect(stackAt(dev, defs, "drive")).toEqual(["helm", "verifier"]);
    expect(handoffs(dev, defs)).toEqual([{ from: "helm", to: "verifier" }]);
  });
  test("키보드 순서는 Drive → 고리 안 → 지점 → 소켓 → 지점", () => {
    expect(readingOrder(dev, defs)).toEqual([
      "helm",
      "verifier",
      "memory",
      "house-style",
      "repo-skills",
      "cost-cap",
      "secret-guard",
      "commit-msg",
      "github-mcp",
      "lint-on-edit",
    ]);
  });
});

describe("고치기", () => {
  test("test-runner는 턴 종료 직전의 빈 자리에 들어간다", () => {
    const next = insertAt(dev, defs, "test-runner", 0);
    expect(stackAt(next, defs, "turnEnd")).toEqual(["test-runner"]);
    expect(next.entries.find((e) => e.id === "test-runner")).toEqual({
      id: "test-runner",
      base: false,
    });
  });
  test("맨 끝에 넣기(노드 30개 장면: 턴 종료 직전에 deploy-gate가 있다)", () => {
    expect(stackAt(insertAt(SCALE_PROFILE, defs, "test-runner", 1), defs, "turnEnd")).toEqual([
      "deploy-gate",
      "test-runner",
    ]);
    expect(stackAt(insertAt(SCALE_PROFILE, defs, "test-runner", 0), defs, "turnEnd")).toEqual([
      "test-runner",
      "deploy-gate",
    ]);
  });
  test("가드 아닌 것을 가드 앞으로 옮기지 않는다", () => {
    expect(move(dev, defs, "commit-msg", -1)).toEqual({ kind: "guard" });
    expect(move(dev, defs, "commit-msg", 1)).toEqual({ kind: "edge" });
  });
  test("Inject 순서 바꾸기", () => {
    const got = move(dev, defs, "repo-skills", -1);
    expect(got.kind).toBe("moved");
    if (got.kind === "moved") {
      expect(stackAt(got.profile, defs, "inside")).toEqual([
        "memory",
        "repo-skills",
        "house-style",
      ]);
    }
  });
  test("베이스는 빼지 않고, 스타트 Drive를 빼면 남은 Drive가 받는다", () => {
    expect(remove(dev, defs, "memory")).toEqual({ kind: "base" });
    const got = remove(dev, defs, "helm");
    expect(got.kind).toBe("removed");
    if (got.kind === "removed") {
      expect(got.profile.startDrive).toBe("verifier");
      expect(got.profile.entries.some((e) => e.id === "helm")).toBe(false);
    }
  });
  test("묶음 구성원을 빼면 묶음에서도 빠진다", () => {
    const got = remove(dev, defs, "lint-on-edit");
    expect(got.kind === "removed" ? got.profile.groups : null).toEqual([
      { id: "quality", key: "quality", members: ["verifier"] },
    ]);
  });
  test("스타트 Drive는 프로필 안의 Drive만 된다", () => {
    expect(setStart(dev, defs, "verifier").startDrive).toBe("verifier");
    expect(setStart(dev, defs, "web-research").startDrive).toBe("helm");
    expect(setStart(dev, defs, "memory").startDrive).toBe("helm");
  });
});

describe("놓을 수 있는 자리", () => {
  test("test-runner는 턴 종료 직전 한 자리, 이미 Hook이 있으면 앞의 바와 맨 끝 상자 둘", () => {
    expect(dropTargets(dev, defs, "test-runner").map((t) => [t.slot, t.index, t.shape])).toEqual([
      ["turnEnd", 0, "box"],
    ]);
    expect(
      dropTargets(SCALE_PROFILE, defs, "test-runner").map((t) => [t.slot, t.index, t.shape]),
    ).toEqual([
      ["turnEnd", 0, "bar"],
      ["turnEnd", 1, "box"],
    ]);
  });
  test("가드 아닌 Hook은 가드 뒤만 받는다", () => {
    expect(dropTargets(dev, defs, "commit-msg").map((t) => [t.slot, t.index, t.shape])).toEqual([
      ["tools.before", 1, "box"],
    ]);
  });
  test("Drive는 Drive 줄의 다음 빈 고리 하나", () => {
    expect(dropTargets(dev, defs, "web-research").map((t) => [t.slot, t.index, t.shape])).toEqual([
      ["drive", 2, "ring"],
    ]);
  });
});

describe("판 배치", () => {
  test("펼친 판: 노드 열과 붙음·커플링·핸드오프", () => {
    const board = layoutBoard(dev, defs, new Set());
    expect(board.nodes.map((n) => [n.id, n.shape]).toSorted(byId)).toEqual([
      ["commit-msg", "hook"],
      ["cost-cap", "hook"],
      ["github-mcp", "tool"],
      ["helm", "drive"],
      ["house-style", "inject"],
      ["lint-on-edit", "hook"],
      ["memory", "inject"],
      ["repo-skills", "inject"],
      ["secret-guard", "hook"],
      ["verifier", "drive"],
    ]);
    expect(board.tethers.filter((t) => t.coupling).map((t) => [t.id, t.latent])).toEqual([
      ["c:helm", false],
      ["c:verifier", true],
    ]);
    expect(board.handoffs.map((h) => [h.from, h.to])).toEqual([["helm", "verifier"]]);
    expect(board.groups.map((g) => [g.id, g.count, g.open])).toEqual([["quality", 2, true]]);
  });
  test("commit-msg는 secret-guard에 잇고(쌓임), secret-guard가 고리에 닿는다", () => {
    const board = layoutBoard(dev, defs, new Set());
    const guard = board.nodes.find((n) => n.id === "secret-guard");
    const draft = board.nodes.find((n) => n.id === "commit-msg");
    expect([guard?.order, draft?.order]).toEqual([0, 1]);
    const ringDist = (id: string): number => {
      const t = board.tethers.find((x) => x.id === `t:${id}`);
      return t === undefined ? -1 : Math.round(Math.hypot(t.to.x, t.to.y));
    };
    expect(ringDist("secret-guard")).toBe(190);
    expect(ringDist("commit-msg")).toBeGreaterThan(190);
  });
  test("접은 묶음: 구성원 대신 묶음 노드 하나, 핸드오프는 묶음으로 간다", () => {
    const board = layoutBoard(dev, defs, new Set(["quality"]));
    const ids = new Set(board.nodes.map((n) => n.id));
    expect(ids.has("lint-on-edit") || ids.has("verifier")).toBe(false);
    expect(board.nodes.find((n) => n.id === "quality")?.shape).toBe("bundle");
    expect(board.handoffs.map((h) => [h.from, h.to])).toEqual([["helm", "quality"]]);
    expect(board.tethers.some((t) => t.id === "c:verifier")).toBe(false);
  });
});

describe("플러그인 내부", () => {
  test("helm: 자기 루프의 단계 셋(탐색은 나란히 3), verifier로 핸드오프", () => {
    const inside = insideLayout(sampleDef("helm"));
    expect(inside.mode).toBe("drive");
    expect(inside.stages.map((s) => [s.key, s.stage.parallel ?? 1])).toEqual([
      ["diverge", 1],
      ["explore", 3],
      ["apply", 1],
    ]);
    expect(inside.exits.map((x) => x.to)).toEqual(["verifier"]);
    expect(inside.parts.map((p) => [p.part.kind, p.to === undefined])).toEqual([
      ["instruction", false],
      ["setting", true],
      ["setting", true],
      ["permission", true],
    ]);
  });
  test("repo-skills: 코드 없이 스킬 여섯이 컨텍스트 조립 정거장에 닿는다", () => {
    const inside = insideLayout(sampleDef("repo-skills"));
    const anchor = polar(MINI_RING, STATION_ANGLE.context);
    const skills = inside.parts.filter((p) => p.part.kind === "skill");
    expect(inside.mode).toBe("attach");
    expect(inside.slot).toBe("inside");
    expect(skills.length).toBe(6);
    expect(skills.every((p) => p.to?.x === anchor.x && p.to.y === anchor.y)).toBe(true);
    expect(inside.parts.find((p) => p.part.kind === "permission")?.part.risk).toBe(0);
  });
  test("secret-guard: 핸들러 하나(도구 호출 앞, 막기)", () => {
    const inside = insideLayout(sampleDef("secret-guard"));
    expect(inside.slot).toBe("tools.before");
    expect(
      inside.parts
        .filter((p) => p.part.kind === "handler")
        .map((p) => [p.part.point, p.part.decision]),
    ).toEqual([["tools.before", "block"]]);
  });
});

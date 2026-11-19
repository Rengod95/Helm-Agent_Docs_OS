import { describe, expect, test } from "bun:test";
import {
  addPlugin,
  canMove,
  dockRows,
  entriesOf,
  focusRect,
  fromShared,
  layoutProfile,
  movePlugin,
  pluginOf,
  relationsOf,
  removeGroup,
  removePlugin,
  setStartDrive,
  SLOTS,
  slotOf,
  tierOf,
  type CanvasProfile,
} from "../../../src/views/craft/canvas/cvH/model.ts";
import { SHARED_PROFILES } from "../../../src/views/craft/canvas/shared-sample.ts";

const dev: CanvasProfile = fromShared(SHARED_PROFILES.dev);
const scale: CanvasProfile = fromShared(SHARED_PROFILES.scale);
const empty: CanvasProfile = fromShared(SHARED_PROFILES.empty);
const installed = dev.groups;
const none: ReadonlySet<string> = new Set();

const slotName = (n: string): string => {
  const p = pluginOf(n);
  return p === undefined ? "?" : slotOf(p);
};

const relationKeys = (p: CanvasProfile): string[] =>
  relationsOf(p)
    .map((r) => `${r.kind}:${r.from}>${r.to ?? "-"}${r.unmet ? "!" : ""}`)
    .toSorted();

describe("cvH 선로: 프로필 조작", () => {
  test("베이스가 먼저 오고 같은 이름은 한 번만 든다", () => {
    expect(entriesOf(dev).slice(0, 3)).toEqual(["memory", "secret-guard", "house-style"]);
    expect(entriesOf(empty)).toEqual(["memory", "secret-guard"]);
  });

  test("묶음 구성원을 넣으면 묶음째로 들고, 따로 빼려 하면 이유를 돌려준다", () => {
    const added = addPlugin(empty, "verifier", installed);
    expect(added.plugins).toEqual(["lint-on-edit", "verifier"]);
    expect(added.groups.map((g) => g.id)).toEqual(["quality"]);
    expect(removePlugin(added, "verifier")).toEqual({ ok: false, why: "member" });
    expect(removePlugin(added, "memory")).toEqual({ ok: false, why: "base" });
    expect(removeGroup(added, "quality").plugins).toEqual([]);
  });

  test("빼면 스타트 Drive도 비고, 같은 지선 안에서만 순서를 바꾼다", () => {
    const r = removePlugin(dev, "helm");
    expect(r.ok ? r.profile.startDrive : "refused").toBe(null);
    expect(canMove(dev, "house-style", -1)).toBe(false);
    expect(movePlugin(dev, "house-style", 1).plugins.slice(0, 2)).toEqual([
      "repo-skills",
      "house-style",
    ]);
    expect(movePlugin(dev, "memory", 1)).toBe(dev);
    expect(setStartDrive(dev, "cost-cap").startDrive).toBe("helm");
  });

  test("종류마다 닿는 자리: Inject는 컨텍스트, 도구는 도구 실행, Drive는 입력 받기, Hook은 제 지점", () => {
    expect(
      ["house-style", "github-mcp", "helm", "secret-guard", "lint-on-edit"].map(slotName),
    ).toEqual(["context", "tools", "input-received", "tools.before", "tools.after"]);
  });
});

describe("cvH 선로: 관계", () => {
  test("개발 프로필은 엔진에 있는 관계만 그린다(F·G와 같은 표본)", () => {
    expect(relationKeys(dev)).toEqual([
      "creates:seed:commit-msg>commit-msg",
      "depends:helm>memory",
      "depends:verifier>lint-on-edit",
      "handoff:helm>verifier",
      "owns:group:quality>lint-on-edit",
      "owns:group:quality>verifier",
    ]);
  });

  test("묶음을 빼면 소유와 그 구성원의 관계가 함께 사라진다", () => {
    const keys = relationKeys(removeGroup(dev, "quality"));
    expect(
      keys.filter(
        (k) => k.includes("verifier") || k.includes("quality") || k.includes("lint-on-edit"),
      ),
    ).toEqual([]);
  });
});

describe("cvH 선로: 배치", () => {
  test("정거장은 코어 루프 순서대로 왼쪽에서 오른쪽으로 선다", () => {
    const layout = layoutProfile({ profile: dev, folded: none });
    expect(layout.stations.map((s) => s.id)).toEqual([...SLOTS]);
    const xs = layout.stations.map((s) => s.x);
    expect(xs.every((x, i) => i === 0 || x > (xs[i - 1] ?? 0))).toBe(true);
  });

  test("닿는 것이 없는 블록 정거장은 쓰이지 않음으로 표시된다", () => {
    const used = layoutProfile({ profile: dev, folded: none })
      .stations.filter((s) => s.used)
      .map((s) => s.id);
    expect(used).toEqual([
      "input-received",
      "context",
      "model.before",
      "tools.before",
      "tools",
      "tools.after",
    ]);
  });

  test("카드끼리 겹치지 않는다(30개에서도)", () => {
    for (const p of [dev, scale]) {
      const cards = layoutProfile({ profile: p, folded: none }).cards.filter(
        (c) => c.group === null,
      );
      const overlaps = cards.flatMap((a, i) =>
        cards
          .slice(i + 1)
          .filter(
            (b) =>
              a.rect.x < b.rect.x + b.rect.w &&
              b.rect.x < a.rect.x + a.rect.w &&
              a.rect.y < b.rect.y + b.rect.h &&
              b.rect.y < a.rect.y + a.rect.h,
          )
          .map((b) => `${a.name}/${b.name}`),
      );
      expect(overlaps).toEqual([]);
    }
  });

  test("접은 묶음은 환승역 하나가 되고 구성원을 고르면 그 역으로 간다", () => {
    const open = layoutProfile({ profile: dev, folded: none });
    const closed = layoutProfile({ profile: dev, folded: new Set(["quality"]) });
    expect(open.cards.filter((c) => c.name === "verifier").length).toBe(1);
    expect(closed.cards.filter((c) => c.name === "verifier").length).toBe(0);
    expect(focusRect(closed, "verifier")).toEqual(
      closed.groups.find((g) => g.id === "quality")?.rect,
    );
  });

  test("칸의 줄 수는 3에서 시작해 큰 칸이면 5까지 깊어진다", () => {
    expect([1, 6, 8, 9, 20].map(dockRows)).toEqual([3, 3, 4, 5, 5]);
  });

  test("확대 단계: 0.5 아래는 멀리, 0.78부터 가까이", () => {
    expect([0.3, 0.49, 0.5, 0.77, 0.78, 1].map(tierOf)).toEqual([
      "far",
      "far",
      "mid",
      "mid",
      "near",
      "near",
    ]);
  });
});

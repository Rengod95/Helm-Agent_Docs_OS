// cvG "깊이" 시안의 순수 모델과 배치: 효과 순서와 같은 자리 순서, 엔진에 있는 관계만, 묶음째 넣고 빼기,
// 베이스는 빠지지 않음, 같은 자리 안 순서 바꾸기, 판끼리 겹치지 않는 배치, 접은 묶음의 선 합치기.
// 값은 공용 표본(`shared-sample.ts`)과 cvG의 보탬(`cvG/sample-ext.ts`)에서 읽는다.
import { describe, expect, test } from "bun:test";
import { layoutProfile, type Rect } from "../../../src/views/craft/canvas/cvG/layout.ts";
import {
  addPlugin,
  canNudge,
  nudge,
  placedOf,
  profileFromSample,
  relationsOf,
  removeBundle,
  removePlugin,
  setStartDrive,
  type CanvasProfile,
} from "../../../src/views/craft/canvas/cvG/model.ts";

const names = (p: CanvasProfile): string[] =>
  p.entries.map((e) => (e.type === "plugin" ? e.name : `[${e.id}]`));

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("profileFromSample", () => {
  test("묶음 구성원은 첫 구성원 자리에 묶음 하나로 선다", () => {
    const dev = profileFromSample("dev");
    expect(names(dev)).toEqual([
      "house-style",
      "repo-skills",
      "[quality]",
      "cost-cap",
      "helm",
      "github-mcp",
      "commit-msg",
    ]);
    expect(dev.base).toEqual(["memory", "secret-guard"]);
    expect(dev.startDrive).toBe("helm");
  });
});

describe("placedOf", () => {
  test("베이스가 먼저, 같은 자리 안 호출 순서와 넣은 곳", () => {
    const rows = placedOf(profileFromSample("dev")).map(
      (x) =>
        `${x.plugin.name} ${x.plugin.anchor} ${String(x.order)}/${String(x.siblings)} ${x.source.type}`,
    );
    expect(rows).toEqual([
      "memory feed:context 1/3 base",
      "secret-guard before:tools 1/2 base",
      "house-style feed:context 2/3 profile",
      "repo-skills feed:context 3/3 profile",
      "lint-on-edit after:tools 1/1 bundle",
      "verifier drive 1/2 bundle",
      "cost-cap before:model 1/1 profile",
      "helm drive 2/2 profile",
      "github-mcp feed:tools 1/1 profile",
      "commit-msg before:tools 2/2 profile",
    ]);
  });
});

describe("relationsOf", () => {
  test("개발: 핸드오프, 의존, 기록 읽기, 빌더가 만든 드래프트", () => {
    const rel = relationsOf(profileFromSample("dev")).map(
      (r) => `${r.kind} ${r.from}>${r.to} ${r.label}`,
    );
    expect(rel.toSorted()).toEqual(
      [
        "creates @builder>commit-msg ",
        "depends verifier>lint-on-edit lint.report",
        "handoff helm>verifier ",
        "reads verifier>helm grp.helm.discovery.*",
      ].toSorted(),
    );
  });

  test("노드 30: 기능 의존과 내장 도구 대체가 더해진다", () => {
    const rel = relationsOf(profileFromSample("scale")).map((r) => `${r.kind} ${r.from}>${r.to}`);
    expect(rel).toContain("depends triage>github-mcp");
    expect(rel).toContain("replaces refactorer>tool:edit");
    expect(rel).toContain("handoff triage>planner");
    expect(rel).toContain("handoff planner>refactorer");
  });

  test("빈 프로필에는 관계가 없다", () => {
    expect(relationsOf(profileFromSample("empty"))).toEqual([]);
  });
});

describe("넣기와 빼기", () => {
  test("묶음 구성원 하나를 넣으면 묶음째 든다", () => {
    const next = addPlugin(profileFromSample("empty"), "verifier");
    expect(names(next)).toEqual(["[quality]"]);
    expect(placedOf(next).map((x) => x.plugin.name)).toEqual([
      "memory",
      "secret-guard",
      "lint-on-edit",
      "verifier",
    ]);
  });

  test("빈 프로필에 처음 넣은 Drive가 스타트가 된다", () => {
    expect(addPlugin(profileFromSample("empty"), "helm").startDrive).toBe("helm");
  });

  test("베이스는 뺄 수 없고, 묶음 구성원을 빼면 묶음째 빠진다", () => {
    const dev = profileFromSample("dev");
    expect(removePlugin(dev, "memory")).toEqual({ ok: false, reason: "base" });
    expect(removePlugin(dev, "web-research")).toEqual({ ok: false, reason: "absent" });
    const r = removePlugin(dev, "lint-on-edit");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toEqual(["lint-on-edit", "verifier"]);
    expect(names(r.profile)).not.toContain("[quality]");
    expect(names(removeBundle(dev, "quality"))).toEqual(names(r.profile));
  });

  test("스타트 Drive를 빼면 스타트가 비고, 다른 Drive로 바꿀 수 있다", () => {
    const dev = profileFromSample("dev");
    const r = removePlugin(dev, "helm");
    expect(r.ok && r.profile.startDrive).toBe(null);
    expect(setStartDrive(dev, "verifier").startDrive).toBe("verifier");
    expect(setStartDrive(dev, "cost-cap")).toBe(dev);
  });
});

describe("nudge", () => {
  test("같은 자리의 이웃과만 자리를 바꾼다", () => {
    const dev = profileFromSample("dev");
    expect(names(nudge(dev, "house-style", 1)).slice(0, 2)).toEqual(["repo-skills", "house-style"]);
    expect(canNudge(dev, "house-style", -1)).toBe(false);
    expect(canNudge(dev, "cost-cap", 1)).toBe(false);
    expect(canNudge(dev, "lint-on-edit", 1)).toBe(false);
  });
});

describe("layoutProfile", () => {
  test("노드 30에서도 판끼리 겹치지 않는다", () => {
    const l = layoutProfile(profileFromSample("scale"), new Set());
    expect(l.plates.length).toBe(30);
    const hits = l.plates.flatMap((a, i) =>
      l.plates
        .slice(i + 1)
        .flatMap((b) =>
          overlaps(a, b) ? [`${a.placed.plugin.name}×${b.placed.plugin.name}`] : [],
        ),
    );
    expect(hits).toEqual([]);
  });

  test("묶음을 접으면 구성원 판이 빠지고 더미 하나가 남는다", () => {
    const dev = profileFromSample("dev");
    const open = layoutProfile(dev, new Set());
    const folded = layoutProfile(dev, new Set(["quality"]));
    expect(open.plates.length).toBe(10);
    expect(folded.plates.length).toBe(8);
    expect(folded.bundles.map((b) => [b.id, b.collapsed])).toEqual([["quality", true]]);
  });
});

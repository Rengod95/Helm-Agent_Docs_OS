// 둘째 판 시안 F·G·H가 같은 플러그인 메타를 본다(AGE-31): G는 `shared-meta.ts`를 그대로, F·H는 자기 모양으로 바꿔 읽는다.
import { describe, expect, test } from "bun:test";
import * as f from "../../../src/views/craft/canvas/cvF/sample-ext.ts";
import * as h from "../../../src/views/craft/canvas/cvH/sample-ext.ts";
import { metaOf } from "../../../src/views/craft/canvas/shared-meta.ts";
import { ALL_SHARED_PLUGINS } from "../../../src/views/craft/canvas/shared-sample.ts";

function row(name: string): readonly unknown[] {
  const fx = f.extOf(name);
  const hx = h.extOf(name);
  return [
    fx.purpose,
    fx.version,
    fx.review.state,
    fx.origin.kind,
    fx.requires,
    fx.provides,
    hx?.purpose,
    hx?.version,
    hx?.review,
    hx?.origin.kind,
    hx?.requires.map((r) => r.id),
    hx?.provides.map((p) => p.id),
  ];
}

describe("F·G·H 공통 메타", () => {
  test("모든 표본 플러그인에서 F와 H가 G와 같은 목적·버전·출처·리뷰·의존을 본다", () => {
    for (const p of ALL_SHARED_PLUGINS) {
      const g = metaOf(p.name, p.kind);
      const review =
        g.review.state === "approved" && g.pending !== null ? "pending" : g.review.state;
      const fx = f.extOf(p.name);
      expect(row(p.name)).toEqual([
        g.purpose,
        g.version,
        review,
        g.origin,
        fx.requires,
        g.provides.map((c) => c.id),
        g.purpose,
        g.version,
        review,
        g.origin,
        fx.requires,
        g.provides.map((c) => c.id),
      ]);
    }
  });

  test("드래프트, 리뷰 대기, 플러그인끼리 의존이 세 시안에 같은 값으로 든다", () => {
    expect([
      f.extOf("commit-msg").review.state,
      f.extOf("commit-msg").origin.createdIn?.threadId,
      h.extOf("commit-msg")?.currentHash,
      h.extOf("commit-msg")?.origin.createdIn?.threadId,
    ]).toEqual(["draft", "thr_8q2n4w", "draft:drf_8k2q:5be7a0", "thr_8q2n4w"]);
    expect([
      f.extOf("lint-on-edit").review.state,
      f.extOf("lint-on-edit").review.pendingItemId,
      h.extOf("lint-on-edit")?.review,
    ]).toEqual(["pending", "rvw_4p1x8d", "pending"]);
    // 엔진이 주는 기능(agents.judge)만 바라는 의존은 플러그인끼리의 선이 아니다
    expect([f.extOf("verifier").requires, f.extOf("helm").requires]).toEqual([
      ["lint.report"],
      ["knowledge.memory"],
    ]);
    expect([h.extOf("secret-guard")?.hook, h.extOf("github-mcp")?.launch?.command]).toEqual([
      "guard.tool.before",
      "npx",
    ]);
    expect([h.GROUP_EXT["quality"]?.extension, f.groupExtOf("quality").version]).toEqual([
      "quality",
      "1.2.0",
    ]);
  });
});

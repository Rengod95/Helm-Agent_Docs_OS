// 시안 다섯이 같은 표본을 본다(AGE-31): 프로필마다 든 플러그인과 순서, 베이스, 드래프트의 결정이 시안 사이에서 같다.
import { describe, expect, test } from "bun:test";
import { effectiveOrder } from "../../../src/views/craft/canvas/cvA/model.ts";
import * as a from "../../../src/views/craft/canvas/cvA/sample.ts";
import * as b from "../../../src/views/craft/canvas/cvB/sample.ts";
import { effectiveNames } from "../../../src/views/craft/canvas/cvC/model.ts";
import * as c from "../../../src/views/craft/canvas/cvC/sample.ts";
import * as d from "../../../src/views/craft/canvas/cvD/sample.ts";
import * as e from "../../../src/views/craft/canvas/cvE/sample.ts";
import { SHARED_PROFILES } from "../../../src/views/craft/canvas/shared-sample.ts";

const DEV = [
  "memory",
  "secret-guard",
  "house-style",
  "repo-skills",
  "lint-on-edit",
  "cost-cap",
  "helm",
  "verifier",
  "github-mcp",
  "commit-msg",
];

function cProfile(id: string): readonly string[] {
  const found = c.sampleProfiles().find((p) => p.id === id);
  return found === undefined ? [] : effectiveNames(found);
}

function dProfile(id: string): readonly string[] {
  return d.SAMPLE_PROFILES.find((p) => p.id === id)?.entries.map((x) => x.plugin) ?? [];
}

describe("시안 다섯의 표본", () => {
  test("프로필 '개발': 베이스 둘이 앞에, 그다음 같은 순서", () => {
    expect(effectiveOrder(a.SAMPLE_PROFILE)).toEqual(DEV);
    expect(b.SAMPLE_PROFILE.entries.map((x) => x.plugin)).toEqual(DEV);
    expect(cProfile("dev")).toEqual(DEV);
    expect(dProfile("dev")).toEqual(DEV);
    expect(e.SAMPLE_PROFILE.entries.map((x) => x.id)).toEqual(DEV);
  });

  test("빈 프로필에는 베이스 둘만 든다", () => {
    const base = ["memory", "secret-guard"];
    expect(effectiveOrder(a.EMPTY_PROFILE)).toEqual(base);
    expect(b.EMPTY_PROFILE.entries.map((x) => x.plugin)).toEqual(base);
    expect(cProfile("blank")).toEqual(base);
    expect(dProfile("blank")).toEqual(base);
    expect(e.EMPTY_PROFILE.entries.map((x) => x.id)).toEqual(base);
  });

  test("노드 30개 장면은 다섯 모두 서른", () => {
    const counts = [
      effectiveOrder(a.SCALE_PROFILE).length,
      b.SCALE_PROFILE.entries.length,
      cProfile("scale").length,
      dProfile("scale").length,
      e.SCALE_PROFILE.entries.length,
    ];
    expect(counts).toEqual([30, 30, 30, 30, 30]);
    expect(SHARED_PROFILES.scale.base.length + SHARED_PROFILES.scale.plugins.length).toBe(30);
  });

  test("드래프트 commit-msg는 도구 실행 앞에서 대체한다(다섯 모두)", () => {
    expect([
      a.SCALE_PLUGINS.find((p) => p.name === "commit-msg")?.decision,
      b.SAMPLE_CATALOG.get("commit-msg")?.verb,
      c.pluginOf("commit-msg")?.decision,
      d.pluginById("commit-msg")?.decision,
      e.SAMPLE_DEFS["commit-msg"]?.decision,
    ]).toEqual(["replace", "replace", "replace", "replace", "replace"]);
    expect([
      a.SCALE_PLUGINS.find((p) => p.name === "commit-msg")?.port,
      d.pluginById("commit-msg")?.points,
      e.SAMPLE_DEFS["commit-msg"]?.point,
    ]).toEqual(["tools.before", ["before:tools"], "tools.before"]);
  });
});

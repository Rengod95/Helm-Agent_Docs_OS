import { expect, test } from "bun:test";
import {
  effectiveTrust,
  INSTALL_SOURCES,
  SOURCE_TRUST,
  TRUST_LEVELS,
  TRUST_MATRIX,
  trustRank,
} from "../../src/loading-trust/index.ts";

test("trust: a request above the install source is exceeded", () => {
  // 사용자 위치 매니페스트의 trust.level: "builtin"은 trust_exceeds_source다
  expect(effectiveTrust("user", "builtin")).toEqual({ ok: false, reason: "trust_exceeds_source" });
  expect(effectiveTrust("project", "builtin")).toEqual({
    ok: false,
    reason: "trust_exceeds_source",
  });
  expect(effectiveTrust("project", "user")).toEqual({ ok: false, reason: "trust_exceeds_source" });
  expect(effectiveTrust("managed", "builtin")).toEqual({
    ok: false,
    reason: "trust_exceeds_source",
  });
  expect(effectiveTrust("builtin", "builtin")).toEqual({ ok: true, level: "builtin" });
});

test("trust: effective level is min", () => {
  // project 위치 + 요청 user → 거부 대상이다. 요청이 낮은 쪽이면 그 값이 유효 등급이다
  expect(effectiveTrust("user", "project")).toEqual({ ok: true, level: "project" });
  expect(effectiveTrust("builtin", "user")).toEqual({ ok: true, level: "user" });
  expect(effectiveTrust("user", undefined)).toEqual({ ok: true, level: "user" });
  expect(effectiveTrust("project", undefined)).toEqual({ ok: true, level: "project" });
  expect(effectiveTrust("project", "untrusted")).toEqual({ ok: true, level: "untrusted" });
});

test("trust: levels, ranks and install sources", () => {
  expect(TRUST_LEVELS).toEqual(["builtin", "user", "project", "untrusted"]);
  expect(INSTALL_SOURCES).toEqual(["builtin", "managed", "user", "project"]);
  expect(TRUST_LEVELS.map(trustRank)).toEqual([0, 1, 2, 3]);
  expect(SOURCE_TRUST).toEqual({
    builtin: "builtin",
    managed: "user",
    user: "user",
    project: "project",
  });
});

test("trust: matrix rows", () => {
  expect(TRUST_MATRIX.untrusted).toEqual({
    load: false,
    on: false,
    onProjectTrust: false,
    post: false,
    drive: false,
    resources: false,
    storage: "none",
    isolation: "notLoaded",
  });
  expect(TRUST_MATRIX.project.onProjectTrust).toBe(false);
  expect(TRUST_MATRIX.builtin.isolation).toBe("forbidden");
});

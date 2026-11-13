import { expect, test } from "bun:test";
import { guideForcedOn, guideSkillRoots, guideWiringOf } from "../../src/assembly/guide.ts";

// 가이드 그룹의 켜짐 판정([결정: 2026-11-13 사용자]): 개발 모드(설정 또는 개발 실행)면 항상 켜지고 잠긴다. 그 밖에는 `ext.guide.enabled`를 따른다.

function wiring(options: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly devMode?: boolean;
  readonly enabled?: boolean;
}) {
  return guideWiringOf({
    env: options.env ?? {},
    resourceDir: "/nonexistent-resource-dir",
    devMode: () => options.devMode ?? false,
    enabledSetting: () => options.enabled ?? false,
  });
}

test("guide: off by default, on by the switch, forced on by dev mode or a dev run", () => {
  const off = wiring({});
  expect(off.active()).toBe(false);
  expect(off.forced()).toBe(false);
  expect(guideSkillRoots(off)).toEqual([]);
  expect(guideForcedOn(off, "guide")).toBeNull();

  const switched = wiring({ enabled: true });
  expect(switched.active()).toBe(true);
  expect(switched.forced()).toBe(false);
  expect(guideSkillRoots(switched).map((root) => root.extension)).toEqual(["guide"]);
  expect(guideSkillRoots(switched)[0]?.dir).toBe(switched.dir);

  for (const forced of [wiring({ devMode: true }), wiring({ env: { FRESNEL_DEV: "1" } })]) {
    expect(forced.active()).toBe(true);
    expect(forced.forced()).toBe(true);
    expect(guideForcedOn(forced, "guide")).toBe("devMode");
    expect(guideForcedOn(forced, "authoring")).toBeNull();
    expect(guideSkillRoots(forced).map((root) => root.extension)).toEqual(["guide"]);
  }
});

test("guide: only the exact value 1 of FRESNEL_DEV counts as a dev run", () => {
  for (const value of ["0", "true", "", undefined]) {
    expect(wiring({ env: { FRESNEL_DEV: value } }).forced()).toBe(false);
  }
});

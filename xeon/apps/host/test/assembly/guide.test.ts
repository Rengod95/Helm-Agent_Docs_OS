import { expect, test } from "bun:test";
import { guideForcedOn, guideSkillRoots, guideWiringOf } from "../../src/assembly/guide.ts";

// 가이드 그룹의 켜짐 판정([결정: 2026-11-13 사용자], M5c §4.1): 개발 모드(설정 또는 개발 실행)면 모든 대화에서 켜지고 잠긴다.
// 그 밖에는 그 대화가 쓰는 프로필(E(T))에 가이드가 있을 때만 켜진다. 사용자 범위의 `ext.guide.enabled` 스위치는 없다.

const IN_SET = "t-with-guide";
const OUT_OF_SET = "t-plain";

function wiring(options: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly devMode?: boolean;
  /** 참이면 `IN_SET` 대화의 프로필이 가이드를 넣었다 */
  readonly listed?: boolean;
}) {
  return guideWiringOf({
    env: options.env ?? {},
    resourceDir: "/nonexistent-resource-dir",
    devMode: () => options.devMode ?? false,
    inSet: (threadId) => options.listed === true && threadId === IN_SET,
  });
}

test("guide: off by default, on only for a thread whose profile lists it, forced on by dev mode or a dev run", () => {
  const off = wiring({});
  expect(off.active(IN_SET)).toBe(false);
  expect(off.active(undefined)).toBe(false);
  expect(off.forced()).toBe(false);
  expect(guideSkillRoots(off, IN_SET)).toEqual([]);
  expect(guideForcedOn(off, "guide")).toBeNull();

  // 프로필이 든 대화에서만 스킬이 나온다. 같은 호스트의 다른 대화에는 없다
  const listed = wiring({ listed: true });
  expect(listed.active(IN_SET)).toBe(true);
  expect(listed.forced()).toBe(false);
  expect(guideSkillRoots(listed, IN_SET).map((root) => root.extension)).toEqual(["guide"]);
  expect(guideSkillRoots(listed, IN_SET)[0]?.dir).toBe(listed.dir);
  expect(listed.active(OUT_OF_SET)).toBe(false);
  expect(guideSkillRoots(listed, OUT_OF_SET)).toEqual([]);
  expect(guideForcedOn(listed, "guide")).toBeNull();

  for (const forced of [wiring({ devMode: true }), wiring({ env: { FRESNEL_DEV: "1" } })]) {
    expect(forced.active(OUT_OF_SET)).toBe(true);
    expect(forced.active(undefined)).toBe(true);
    expect(forced.forced()).toBe(true);
    expect(guideForcedOn(forced, "guide")).toBe("devMode");
    expect(guideForcedOn(forced, "authoring")).toBeNull();
    expect(guideSkillRoots(forced, OUT_OF_SET).map((root) => root.extension)).toEqual(["guide"]);
  }
});

test("guide: only the exact value 1 of FRESNEL_DEV counts as a dev run", () => {
  for (const value of ["0", "true", "", undefined]) {
    expect(wiring({ env: { FRESNEL_DEV: value } }).forced()).toBe(false);
  }
});

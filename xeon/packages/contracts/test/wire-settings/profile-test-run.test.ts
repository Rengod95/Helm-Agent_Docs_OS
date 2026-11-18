import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  SETTING_WRITERS,
  ThreadCreateParamsSchema,
  ThreadSummarySchema,
  WIRE_METHODS,
  WIRE_NOTIFICATIONS,
} from "../../src/wire-settings/wire/index.ts";

function roundTrip(schema: TSchema, value: unknown): void {
  const result = parse(schema, value);
  expect(result.ok ? result.value : result.error).toEqual(value);
}

describe("Test run marker, trace and explain", () => {
  // 프로필 저장과 `profile.*` 메서드는 test/wire-settings/profile.test.ts가 본다(M5c-1)
  test("profile.changed carries commonChanged and is a notification", () => {
    expect(WIRE_NOTIFICATIONS["profile.changed"].stage).toBe("M4");
    roundTrip(WIRE_NOTIFICATIONS["profile.changed"].params, {
      rev: 6,
      ids: ["inquiry-heavy"],
      commonChanged: false,
    });
    expect(parse(WIRE_NOTIFICATIONS["profile.changed"].params, { rev: 6, ids: [] }).ok).toBe(false);
  });

  test("ThreadSummary.testRun and thread.create testRun round trip, trial is gone", () => {
    const marker = { profileId: "p", target: "helm", paused: true };
    expect(parse(ThreadSummarySchema.properties.testRun, marker).ok).toBe(true);
    expect(parse(ThreadSummarySchema.properties.testRun, { ...marker, paused: "yes" }).ok).toBe(
      false,
    );
    expect(parse(ThreadCreateParamsSchema, { testRun: true, profileId: "p" }).ok).toBe(true);
    expect(parse(ThreadCreateParamsSchema, { trial: true }).ok).toBe(false);
    expect(parse(ThreadCreateParamsSchema, { profileId: "" }).ok).toBe(false);
    expect(Object.keys(WIRE_METHODS).filter((name) => name.startsWith("trial."))).toEqual([]);
  });

  test("testRun controls, phase, trace and explain round trip", () => {
    expect(Object.keys(WIRE_METHODS).filter((name) => name.startsWith("testRun."))).toEqual([
      "testRun.start",
      "testRun.pause",
      "testRun.resume",
      "testRun.step",
      "testRun.phase",
      "testRun.compare",
    ]);
    roundTrip(WIRE_METHODS["testRun.pause"].result, { paused: true });
    roundTrip(WIRE_METHODS["testRun.phase"].result, {
      phase: "plan",
      group: "helm",
      seq: 9,
      paused: true,
      lock: { holder: "helm", status: "releasing", epoch: 4 },
      guardHits: 3,
      traceEnabled: true,
      boundaries: [
        { seq: 8, phase: "plan", paused: false },
        { seq: 9, phase: "plan", paused: true },
      ],
    });
    roundTrip(WIRE_METHODS["trace.turn"].result, {
      traceEnabled: true,
      retained: true,
      entries: [
        {
          seq: 1,
          hook: "input.user.before",
          step: 0,
          handlers: [
            {
              registrationId: "a",
              ms: 1.5,
              result: "passed",
              atMs: 0,
              size: 0,
              skippedBy: null,
              reason: null,
            },
            {
              registrationId: "b",
              ms: 2,
              result: "failed",
              atMs: 1.5,
              size: 0,
              skippedBy: null,
              reason: "timeout",
            },
          ],
        },
      ],
    });
    // 계측이 꺼졌거나 버퍼 밖이면 entries가 비고 retained가 거짓이다. 둘은 traceEnabled로 갈린다
    roundTrip(WIRE_METHODS["trace.turn"].result, {
      traceEnabled: false,
      retained: false,
      entries: [],
    });
    roundTrip(WIRE_METHODS["trace.turn"].result, {
      traceEnabled: true,
      retained: false,
      entries: [],
    });
    expect(
      parse(WIRE_METHODS["trace.turn"].result, {
        traceEnabled: true,
        retained: true,
        entries: [
          {
            seq: 1,
            hook: "h",
            step: 0,
            handlers: [
              {
                registrationId: "a",
                ms: 1,
                result: "boom",
                atMs: 0,
                size: 0,
                skippedBy: null,
                reason: null,
              },
            ],
          },
        ],
      }).ok,
    ).toBe(false);
    roundTrip(WIRE_METHODS["settings.explain"].result, {
      key: "k",
      value: 1,
      winningScope: "session",
      writer: "profile",
      profileId: "p",
    });
    expect(SETTING_WRITERS).toEqual(["default", "user", "profile", "testRun", "session"]);
  });

  test("testRun.phase carries pause, lock, guard hits and boundaries, all required", () => {
    const phase = WIRE_METHODS["testRun.phase"].result;
    const full = {
      phase: "plan",
      group: "helm",
      seq: 9,
      paused: true,
      lock: { holder: "helm", status: "active", epoch: 2 },
      guardHits: 1,
      traceEnabled: true,
      boundaries: [{ seq: 9, phase: "plan", paused: true }],
    };
    roundTrip(phase, full);
    // 커밋된 임대가 없으면 lock은 none이고 holder와 epoch는 null이다. 계측이 꺼져 있으면 traceEnabled가 거짓이다
    const none = {
      phase: null,
      group: null,
      seq: null,
      paused: false,
      lock: { holder: null, status: "none", epoch: null },
      guardHits: 0,
      traceEnabled: false,
      boundaries: [],
    };
    roundTrip(phase, none);
    // 경계 기록은 최대 200개다
    const atCap = Array.from({ length: 200 }, (_, index) => ({
      seq: index,
      phase: null,
      paused: false,
    }));
    roundTrip(phase, { ...none, boundaries: atCap });
    expect(
      parse(phase, { ...none, boundaries: [...atCap, { seq: 200, phase: null, paused: false }] })
        .ok,
    ).toBe(false);

    // 필드가 빠지거나 더 있으면 거절한다
    const { guardHits: _guardHits, ...missing } = full;
    expect(parse(phase, missing).ok).toBe(false);
    expect(parse(phase, { ...full, extra: 1 }).ok).toBe(false);
    expect(parse(phase, { ...full, lock: { ...full.lock, extra: 1 } }).ok).toBe(false);
    const { epoch: _epoch, ...lockWithoutEpoch } = full.lock;
    expect(parse(phase, { ...full, lock: lockWithoutEpoch }).ok).toBe(false);
    expect(
      parse(phase, { ...full, boundaries: [{ seq: 9, phase: null, paused: false, extra: 1 }] }).ok,
    ).toBe(false);
    // 임대 상태는 세 값만 받는다. drive lock의 released는 wire에 없다
    expect(parse(phase, { ...full, lock: { ...full.lock, status: "released" } }).ok).toBe(false);
    expect(parse(phase, { ...full, lock: { ...full.lock, status: "idle" } }).ok).toBe(false);
    for (const status of ["active", "releasing", "none"]) {
      expect(parse(phase, { ...full, lock: { ...full.lock, status } }).ok).toBe(true);
    }
    // 가드 계수는 0 이상의 정수다
    expect(parse(phase, { ...full, guardHits: -1 }).ok).toBe(false);
    expect(parse(phase, { ...full, guardHits: 1.5 }).ok).toBe(false);
  });
});

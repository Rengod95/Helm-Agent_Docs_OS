import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  ProfileSchema,
  ProfilesFileSchema,
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

const profile = {
  id: "inquiry-heavy",
  title: "Inquiry heavy",
  enable: ["helm"],
  disable: ["other"],
  settings: [{ key: "x.primitives.activeDriver", value: "helm" }],
  driver: "helm",
  updatedAt: "2026-10-31T00:00:00.000Z",
  rev: 2,
};

describe("profile storage and Test run marker", () => {
  test("Profile and ProfilesFile round trip by value, driver replaces driveGroup", () => {
    roundTrip(ProfileSchema, profile);
    roundTrip(ProfilesFileSchema, { schemaVersion: 1, profiles: [profile] });
    expect(parse(ProfileSchema, { ...profile, id: "Bad Id" }).ok).toBe(false);
    expect(parse(ProfileSchema, { ...profile, extra: 1 }).ok).toBe(false);
    const { driver: _driver, ...rest } = profile;
    expect(parse(ProfileSchema, { ...rest, driveGroup: "helm" }).ok).toBe(false);
    expect(parse(ProfilesFileSchema, { schemaVersion: 2, profiles: [] }).ok).toBe(false);
  });

  test("profile.put takes baseRev and no storage-owned fields", () => {
    const { updatedAt: _u, rev: _r, ...input } = profile;
    const params = WIRE_METHODS["profile.put"].params;
    expect(parse(params, { profile: input, baseRev: null }).ok).toBe(true);
    expect(parse(params, { profile: input, baseRev: 2 }).ok).toBe(true);
    expect(parse(params, { profile: input }).ok).toBe(false);
    expect(parse(params, { profile, baseRev: 2 }).ok).toBe(false);
  });

  test("profile.apply and preview take a layer and echo it", () => {
    const apply = WIRE_METHODS["profile.apply"].params;
    expect(parse(apply, { id: "p" }).ok).toBe(true);
    expect(parse(apply, { id: "p", layer: "thread", threadId: "thr_1" }).ok).toBe(true);
    expect(parse(apply, { id: "p", layer: "project" }).ok).toBe(true);
    expect(parse(apply, { id: "p", layer: "session" }).ok).toBe(false);
    roundTrip(WIRE_METHODS["profile.apply"].result, {
      written: ["a.b"],
      layer: "user",
      appliesAt: "nextStepBoundary",
    });
    expect(parse(WIRE_METHODS["profile.apply"].result, { written: [], appliesAt: "now" }).ok).toBe(
      false,
    );
    expect(parse(WIRE_METHODS["profile.preview"].params, { id: "p", layer: "user" }).ok).toBe(true);
    roundTrip(WIRE_METHODS["profile.preview"].result, {
      enabled: ["helm"],
      disabled: [],
      candidates: ["helm"],
      expectedHolder: "helm",
      overrides: [{ key: "k", value: 1 }],
      hookCount: 4,
      layer: "thread",
    });
  });

  test("profile.list round trips and profile.changed is a notification", () => {
    roundTrip(WIRE_METHODS["profile.list"].result, { profiles: [profile], rev: 5 });
    expect(WIRE_NOTIFICATIONS["profile.changed"].stage).toBe("M4");
    roundTrip(WIRE_NOTIFICATIONS["profile.changed"].params, { rev: 6, ids: ["inquiry-heavy"] });
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
      "testRun.pause",
      "testRun.resume",
      "testRun.step",
      "testRun.phase",
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

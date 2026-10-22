import { describe, expect, test } from "bun:test";
import type { LeaseOwnerInfo, LockBusy } from "@xeon/contracts/records";
import {
  createLockFallbackPolicy,
  threadLockedDetails,
  type LockFallbackContext,
  type LockFallbackDefault,
} from "../src/index.ts";

const OWNER: LeaseOwnerInfo = {
  holderId: "holder-1",
  kind: "service",
  pid: 4242,
  startedAt: 1_767_571_200_000,
  host: "dev-host",
  epoch: 3,
  heartbeatAt: 1_767_571_200_000,
  expiresAt: 1_767_571_230_000,
};

const BUSY: LockBusy = {
  kind: "lock_busy",
  resource: "session:thr_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  reason: "os_lock_held",
  owner: OWNER,
};

function context(overrides: Partial<LockFallbackContext> = {}): LockFallbackContext {
  return {
    busy: BUSY,
    serviceOwnsSession: false,
    interactive: true,
    requested: null,
    ...overrides,
  };
}

function policy(fallback: LockFallbackDefault = "ask") {
  return createLockFallbackPolicy({ default: fallback });
}

describe("lock fallback policy", () => {
  test("a session owned by the shared service is delegated", () => {
    expect(policy().decide(context({ serviceOwnsSession: true }))).toEqual({
      kind: "act",
      choice: "delegate",
    });
    // 비대화에서도 같다
    expect(
      policy("fork").decide(context({ serviceOwnsSession: true, interactive: false })),
    ).toEqual({ kind: "act", choice: "delegate" });
  });

  test("an interactive client is asked to choose observe or fork", () => {
    expect(policy().decide(context())).toEqual({
      kind: "ask",
      options: ["observe", "fork"],
      suggested: "observe",
    });
  });

  test("the configured default becomes the suggestion", () => {
    expect(policy("fork").decide(context())).toEqual({
      kind: "ask",
      options: ["observe", "fork"],
      suggested: "fork",
    });
  });

  test("a non-interactive caller acts on the configured default, observe when it says ask", () => {
    expect(policy("fork").decide(context({ interactive: false }))).toEqual({
      kind: "act",
      choice: "fork",
    });
    expect(policy("ask").decide(context({ interactive: false }))).toEqual({
      kind: "act",
      choice: "observe",
    });
  });

  test("an explicit choice wins over the default", () => {
    expect(policy("observe").decide(context({ requested: "fork" }))).toEqual({
      kind: "act",
      choice: "fork",
    });
    expect(policy().decide(context({ requested: "observe", interactive: false }))).toEqual({
      kind: "act",
      choice: "observe",
    });
  });

  test("delegating without a service that owns the session asks again", () => {
    expect(policy().decide(context({ requested: "delegate" }))).toEqual({
      kind: "ask",
      options: ["observe", "fork"],
      suggested: "observe",
    });
    expect(policy().decide(context({ requested: "delegate", serviceOwnsSession: true }))).toEqual({
      kind: "act",
      choice: "delegate",
    });
  });
});

describe("thread.locked details", () => {
  test("options equal the decision's choices and ownerKind comes from the lease row", () => {
    const asked = policy().decide(context());
    expect(threadLockedDetails(BUSY, asked)).toEqual({
      ownerKind: "service",
      options: ["observe", "fork"],
    });
    const acted = policy().decide(context({ serviceOwnsSession: true }));
    expect(threadLockedDetails(BUSY, acted)).toEqual({
      ownerKind: "service",
      options: ["delegate"],
    });
  });

  test("a missing lease row reports an unknown owner kind", () => {
    const gone: LockBusy = { ...BUSY, owner: null };
    expect(threadLockedDetails(gone, policy().decide(context({ busy: gone }))).ownerKind).toBe(
      "unknown",
    );
  });
});

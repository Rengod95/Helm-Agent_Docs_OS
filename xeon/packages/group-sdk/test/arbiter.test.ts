import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  LeaseArbiterPortKey,
  type LeaseArbiterPort,
  type LeaseCandidate,
  type ScopeId,
} from "@xeon/contracts/extensions";
import { withDriveDefaults } from "@xeon/ext-host";
import { createTestHost, type TestHost, type TestHostOptions } from "@xeon/ext-host/testing";
import {
  defaultDriveArbiter,
  defineGroup,
  leaseArbiterPort,
  type DriveCandidate,
  type GroupModule,
} from "../src/index.ts";
import { install } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

function candidate(scopeId: string, loadOrder: number, requestSeq: number | null): DriveCandidate {
  return { scopeId, groupId: scopeId, loadOrder, requestSeq };
}

test("arbiter.auto-first-request-wins", () => {
  const decision = defaultDriveArbiter.decide({
    candidates: [candidate("b", 1, 12), candidate("a", 0, 10), candidate("c", 2, 30)],
    holderSetting: null,
  });
  expect(decision).toEqual({ holder: "a", waiting: ["b", "c"], reason: "first-request" });
});

test("arbiter.auto-breaks-ties-by-load-order-and-puts-no-record-first", () => {
  const tie = defaultDriveArbiter.decide({
    candidates: [candidate("late", 3, 5), candidate("early", 1, 5)],
    holderSetting: null,
  });
  expect(tie.holder).toBe("early");
  // enabled 기록이 없는(null) 기본 켜짐 그룹은 기록이 있는 그룹보다 앞이다. null끼리는 loadOrder다
  const withNull = defaultDriveArbiter.decide({
    candidates: [candidate("recorded", 0, 4), candidate("n2", 2, null), candidate("n1", 1, null)],
    holderSetting: null,
  });
  expect(withNull).toMatchObject({ holder: "n1", waiting: ["n2", "recorded"] });
});

test("arbiter.named-holder-only", () => {
  const decision = defaultDriveArbiter.decide({
    candidates: [candidate("a", 0, 1), candidate("b", 1, 2), candidate("c", 2, 3)],
    holderSetting: "b",
  });
  expect(decision).toEqual({ holder: "b", waiting: ["a", "c"], reason: "named" });
});

test("arbiter.named-unavailable-grants-none", () => {
  const decision = defaultDriveArbiter.decide({
    candidates: [candidate("a", 0, 1), candidate("b", 1, 2)],
    holderSetting: "review",
  });
  expect(decision).toEqual({
    holder: null,
    waiting: ["a", "b"],
    reason: "named-unavailable",
  });
  expect(defaultDriveArbiter.decide({ candidates: [], holderSetting: null })).toEqual({
    holder: null,
    waiting: [],
    reason: "no-candidate",
  });
});

test("arbiter.decide-is-deterministic", () => {
  const input = {
    candidates: [candidate("x", 2, null), candidate("y", 0, 9), candidate("z", 1, 9)],
    holderSetting: null,
  };
  expect(defaultDriveArbiter.decide(input)).toEqual(defaultDriveArbiter.decide(input));
});

test("arbiter.port-maps-lease-candidates", async () => {
  const offered: LeaseCandidate[] = [
    { scopeId: "a", extension: "a", loadIndex: 1, defaultEnabled: true, enabledAtSeq: 8 },
    { scopeId: "b", extension: "b", loadIndex: 0, defaultEnabled: true, enabledAtSeq: 3 },
  ];
  const seen: DriveCandidate[][] = [];
  const port = leaseArbiterPort(
    {
      decide(input) {
        seen.push([...input.candidates]);
        return { holder: "a", waiting: ["b"], reason: "first-request" };
      },
    },
    { holderSetting: () => null },
  );
  const thread = (await createTestHost()).newThread();
  expect(port.choose(thread, offered)).toBe("a");
  expect(seen[0]).toEqual([
    { scopeId: "a", groupId: "a", loadOrder: 1, requestSeq: 8 },
    { scopeId: "b", groupId: "b", loadOrder: 0, requestSeq: 3 },
  ]);
  // requestSeq 조회를 바꿔 끼울 수 있다
  const custom = leaseArbiterPort(defaultDriveArbiter, {
    holderSetting: () => null,
    requestSeq: () => null,
  });
  expect(custom.choose(thread, offered)).toBe("b");
});

// ── 테스트 호스트와 함께 ────────────────────────────────────────────────────

interface Rig {
  readonly t: TestHost;
  readonly calls: string[];
  readonly asked: (readonly ScopeId[])[];
  setHolder(holder: ScopeId | null): void;
}

async function rig(): Promise<Rig> {
  let holder: ScopeId | null = null;
  const source: NonNullable<TestHostOptions["settingsSource"]> = {
    driveDefaultLimits: () => withDriveDefaults({}),
    driveLimits: () => ({}),
    activeDriveGroup: () => holder,
    capabilityProviders: () => ({}),
  };
  const t = await createTestHost({ settingsSource: source });
  const asked: (readonly ScopeId[])[] = [];
  const port = leaseArbiterPort(defaultDriveArbiter, {
    holderSetting: (_thread: ThreadId) => holder,
  });
  const counting: LeaseArbiterPort = {
    choose(threadId, candidates) {
      asked.push(candidates.map((entry) => entry.scopeId));
      return port.choose(threadId, candidates);
    },
  };
  await t.host.registerPlatform({
    name: "test-groups",
    setup(ctx) {
      ctx.providePort(LeaseArbiterPortKey, counting);
    },
  });
  return {
    t,
    calls: [],
    asked,
    setHolder(next) {
      holder = next;
    },
  };
}

function driveGroup(name: string, calls: string[], throwOnDrive = false): GroupModule {
  return defineGroup({
    manifest: groupManifestOf({
      name,
      points: ["tool.call.before"],
      usesPost: true,
      usesDrive: true,
    }),
    setup(g) {
      g.on("tool.call.before", (payload) =>
        payload.toolName === "danger" ? { block: true, reason: `${name} blocks` } : undefined,
      );
      g.drive(async (loop) => {
        calls.push(name);
        if (throwOnDrive) throw new TypeError(`${name} drive failed`);
        await loop.turn({ input: { kind: "user", content: name } });
      });
    },
  });
}

function leasedScopes(t: TestHost, thread: ThreadId, kind: string): readonly unknown[] {
  return t.records
    .events(thread)
    .filter((event) => event.kind === kind)
    .map((event) => event.payload);
}

test("arbiter.auto-keeps-holder", async () => {
  const r = await rig();
  await install(r.t, driveGroup("grp-a", r.calls), 0);
  await install(r.t, driveGroup("grp-b", r.calls), 1);
  const thread = r.t.newThread();
  await r.t.host.openThread(thread);
  await r.t.settled();
  expect(r.t.host.leaseOf(thread)).toMatchObject({ scopeId: "grp-a" });
  const asked = r.asked.length;

  // 새 그룹을 켜도 임대가 있는 동안 X는 중재자를 다시 묻지 않는다
  await install(r.t, driveGroup("grp-c", r.calls), 2);
  await r.t.boundary(thread).turnSettled();
  await r.t.settled();
  expect(r.asked).toHaveLength(asked);
  expect(r.t.host.leaseOf(thread)).toMatchObject({ scopeId: "grp-a" });
});

test("arbiter.waiting-group-keeps-on-handlers", async () => {
  const r = await rig();
  await install(r.t, driveGroup("grp-a", r.calls), 0);
  await install(r.t, driveGroup("grp-b", r.calls), 1);
  const thread = r.t.newThread();
  await r.t.host.openThread(thread);
  await r.t.settled();
  // 대기 그룹 B의 drive 함수는 호출되지 않는다
  expect(r.calls.filter((name) => name === "grp-b")).toEqual([]);
  expect(r.calls).toContain("grp-a");
  expect(r.t.host.scopes().find((scope) => scope.id === "grp-b")?.drive).toBe("registered");

  // 그래도 B의 on 핸들러는 계속 동작한다
  const outcome = await r.t.host.dispatch(
    "tool.call.before",
    { toolCallId: "c1", toolName: "danger", input: {} },
    { threadId: thread, dispatchKey: "tc-1" },
  );
  expect(outcome.decision).toMatchObject({ block: true });
});

test("arbiter.excludes-drive-error", async () => {
  const r = await rig();
  await install(r.t, driveGroup("grp-a", r.calls, true), 0);
  await install(r.t, driveGroup("grp-b", r.calls), 1);
  const thread = r.t.newThread();
  await r.t.host.openThread(thread);
  await r.t.settled();
  // A의 drive가 던져 임대가 error로 반납되고, 이후 후보에는 B만 있다
  expect(leasedScopes(r.t, thread, "lease.released")).toMatchObject([
    { scopeId: "grp-a", reason: "error" },
  ]);
  expect(r.t.host.scopes().find((scope) => scope.id === "grp-a")?.drive).toBe("error");
  expect(r.asked.at(-1)).toEqual(["grp-b"]);
  expect(r.t.host.leaseOf(thread)).toMatchObject({ scopeId: "grp-b" });
});

test("arbiter.named-swap-revokes-at-the-next-boundary", async () => {
  const r = await rig();
  await install(r.t, driveGroup("grp-a", r.calls), 0);
  await install(r.t, driveGroup("grp-b", r.calls), 1);
  const thread = r.t.newThread();
  await r.t.host.openThread(thread);
  await r.t.settled();
  expect(r.t.host.leaseOf(thread)).toMatchObject({ scopeId: "grp-a" });

  // 이름 지정은 현재 임대를 즉시 끊지 않고 다음 경계에서 revoked로 반납한다(X.primitives.spec §4.4.1 5번)
  r.setHolder("grp-b");
  expect(r.t.host.leaseOf(thread)).toMatchObject({ scopeId: "grp-a", status: "active" });
  await r.t.boundary(thread).turnSettled();
  await r.t.settled();
  expect(leasedScopes(r.t, thread, "lease.released")).toMatchObject([
    { scopeId: "grp-a", reason: "revoked" },
  ]);
  expect(leasedScopes(r.t, thread, "lease.acquired")).toMatchObject([
    { scopeId: "grp-a" },
    { scopeId: "grp-b" },
  ]);
  expect(r.t.host.leaseOf(thread)).toMatchObject({ scopeId: "grp-b" });
});

test("arbiter.named-unavailable-leaves-the-thread-without-a-lease", async () => {
  const r = await rig();
  r.setHolder("grp-missing");
  await install(r.t, driveGroup("grp-a", r.calls), 0);
  const thread = r.t.newThread();
  await r.t.host.openThread(thread);
  await r.t.settled();
  expect(r.calls).toEqual([]);
  expect(r.t.host.leaseOf(thread)).toBeNull();
});

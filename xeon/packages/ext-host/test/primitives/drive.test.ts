import { expect, test } from "bun:test";
import { PrimitiveError } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

async function setup(options: Parameters<typeof createTestHost>[0] = {}) {
  const t = await createTestHost(options);
  const thread = t.newThread();
  return { t, thread };
}

function kindsOf(
  t: Awaited<ReturnType<typeof createTestHost>>,
  thread: Parameters<Awaited<ReturnType<typeof createTestHost>>["records"]["events"]>[0],
): string[] {
  return t.records.events(thread).map((event) => event.kind);
}

test("lease is granted once the thread is open and the drive function runs", async () => {
  const { t, thread } = await setup();
  const calls: number[] = [];
  await t.host.install(
    makeGroupUnit({ name: "drv-basic" }, (g) => {
      g.drive(async (loop) => {
        calls.push(1);
        await loop.turn({ input: { kind: "user", content: "go" } });
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(calls).toEqual([1]);
  expect(kindsOf(t, thread)).toEqual(["scope.changed", "lease.acquired"]);
  expect(t.loop.turns[0]?.requestId).toMatch(/^evt_[0-9A-Z]{26}:0\.0$/);
  expect(t.loop.turns[0]?.leaseEpoch).toBe(1);
});

test("reinvoke replays committed turn", async () => {
  const { t, thread } = await setup();
  const outcomes: boolean[] = [];
  await t.host.install(
    makeGroupUnit({ name: "drv-replay" }, (g) => {
      g.drive(async (loop) => {
        await loop.turn({ input: { kind: "user", content: "go" } });
        outcomes.push(true);
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(t.loop.turns.length).toBe(1);
  const firstKey = t.loop.turns[0]?.requestId;
  // 같은 상태 판(0)으로 다시 불린다: turn_settled가 호출 조건이다
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(outcomes.length).toBe(2);
  // 같은 기본 requestId → 포트가 replayed를 돌려주므로 새 turn은 실행되지 않는다
  expect(t.loop.turns.length).toBe(1);
  expect(t.loop.turns[0]?.requestId).toBe(firstKey);
});

test("idle twice releases", async () => {
  const { t, thread } = await setup();
  let calls = 0;
  await t.host.install(
    makeGroupUnit({ name: "drv-idle" }, (g) => {
      g.drive(() => {
        calls += 1;
        return Promise.resolve();
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(calls).toBe(1);
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(calls).toBe(2);
  const released = t.records
    .events(thread)
    .filter((event) => event.kind === "lease.released")
    .map((event) => event.payload);
  expect(released).toHaveLength(1);
  expect(released[0]).toMatchObject({ reason: "idle", scopeId: "drv-idle" });
  // 반납된 뒤에는 같은 판에서 다시 부여하지 않는다(쿨다운)
  await t.boundary(thread).idle();
  await t.settled();
  expect(calls).toBe(2);
  expect(kindsOf(t, thread).filter((kind) => kind === "lease.acquired")).toHaveLength(1);
});

test("throw releases and keeps handlers", async () => {
  const { t, thread } = await setup();
  const handlerCalls: string[] = [];
  let driveCalls = 0;
  await t.host.install(
    makeGroupUnit({ name: "drv-throw", points: ["boundary.settle.after"] }, (g) => {
      g.on("boundary.settle.after", () => {
        handlerCalls.push("handler");
      });
      g.drive(() => {
        driveCalls += 1;
        return Promise.reject(new Error("drive broke"));
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(driveCalls).toBe(1);
  const released = t.records.events(thread).find((event) => event.kind === "lease.released");
  expect(released?.payload).toMatchObject({ reason: "error" });
  expect(t.host.scopes()[0]?.drive).toBe("error");
  // on 핸들러는 계속 실행되고, 토글 전에는 다시 부여·호출하지 않는다
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
  expect(handlerCalls).toEqual(["handler"]);
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(driveCalls).toBe(1);
});

test("third turn rejected at turns 2", async () => {
  const { t, thread } = await setup();
  const errors: unknown[] = [];
  await t.host.install(
    makeGroupUnit({ name: "drv-budget" }, (g) => {
      g.drive(
        async (loop) => {
          await loop.turn({ input: { kind: "user", content: "1" } });
          await loop.turn({ input: { kind: "user", content: "2" } });
          try {
            await loop.turn({ input: { kind: "user", content: "3" } });
          } catch (error) {
            errors.push(error);
          }
        },
        { limits: { maxTurns: 2 } },
      );
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(t.loop.turns.length).toBe(2);
  expect(errors[0] instanceof PrimitiveError && errors[0].code).toBe("lease_budget");
  const released = t.records.events(thread).find((event) => event.kind === "lease.released");
  expect(released?.payload).toMatchObject({ reason: "budget" });
});

test("limits clamp to settings", async () => {
  const { t, thread } = await setup({ settings: { driveLimits: { maxTurns: 5 } } });
  await t.host.install(
    makeGroupUnit({ name: "drv-clamp" }, (g) => {
      g.drive(() => Promise.resolve(), { limits: { maxTurns: 10, maxTokens: 100 } });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  const acquired = t.records.events(thread).find((event) => event.kind === "lease.acquired");
  expect(acquired?.payload).toMatchObject({ limits: { maxTurns: 5, maxTokens: 100 } });
  expect(t.diagnostics.some((diagnostic) => diagnostic.code === "drive_limits_clamped")).toBe(true);
});

async function acquiredLimits(
  settings: NonNullable<Parameters<typeof createTestHost>[0]>["settings"],
  requested?: { maxTurns?: number; maxSpawns?: number; maxTokens?: number },
): Promise<unknown> {
  const { t, thread } = await setup(settings === undefined ? {} : { settings });
  await t.host.install(
    makeGroupUnit({ name: "drv-limits" }, (g) => {
      g.drive(() => Promise.resolve(), requested === undefined ? undefined : { limits: requested });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  return t.records.events(thread).find((event) => event.kind === "lease.acquired")?.payload;
}

// U-12: 상한을 명시하지 않은 임대는 일반 기본값(4/8/400000)을 받는다
test("a lease without explicit limits gets the default caps", async () => {
  expect(await acquiredLimits(undefined)).toMatchObject({
    limits: { maxTurns: 4, maxSpawns: 8, maxTokens: 400000 },
  });
});

test("a group request overrides the default per field and the others keep the default", async () => {
  expect(await acquiredLimits(undefined, { maxTurns: 2 })).toMatchObject({
    limits: { maxTurns: 2, maxSpawns: 8, maxTokens: 400000 },
  });
});

test("a partial user default replaces only its own fields; the others keep the built-in default (U-12)", async () => {
  expect(await acquiredLimits({ driveDefaultLimits: { maxTurns: 9 } })).toMatchObject({
    limits: { maxTurns: 9, maxSpawns: 8, maxTokens: 400000 },
  });
});

test("the defaults and the ceiling are read for the thread that receives the lease", async () => {
  const state: { quiet: string | undefined } = { quiet: undefined };
  const asked: string[] = [];
  const t = await createTestHost({
    settingsSource: {
      driveDefaultLimits(threadId) {
        asked.push(`default:${threadId}`);
        return threadId === state.quiet
          ? { maxTurns: 1, maxSpawns: 0, maxTokens: 10 }
          : { maxTurns: 4 };
      },
      driveLimits(threadId) {
        asked.push(`ceiling:${threadId}`);
        return threadId === state.quiet ? { maxTurns: 1 } : {};
      },
      activeDriveGroup: () => null,
      capabilityProviders: () => ({}),
    },
  });
  await t.host.install(
    makeGroupUnit({ name: "drv-session-scope" }, (g) => {
      g.drive(() => Promise.resolve());
    }),
  );
  const other = t.newThread();
  const quiet = t.newThread();
  state.quiet = quiet;
  await t.host.openThread(other);
  await t.host.openThread(quiet);
  await t.settled();
  const payloadOf = (threadId: typeof quiet): unknown =>
    t.records.events(threadId).find((event) => event.kind === "lease.acquired")?.payload;
  expect(payloadOf(other)).toMatchObject({ limits: { maxTurns: 4 } });
  expect(payloadOf(quiet)).toMatchObject({ limits: { maxTurns: 1, maxSpawns: 0, maxTokens: 10 } });
  expect(asked).toContain(`default:${quiet}`);
  expect(asked).toContain(`ceiling:${quiet}`);
});

test("the ceiling cuts the default too, and it also caps a field that has no default", async () => {
  expect(
    await acquiredLimits({ driveDefaultLimits: { maxTurns: 9 }, driveLimits: { maxTurns: 3 } }),
  ).toMatchObject({ limits: { maxTurns: 3 } });
  expect(
    await acquiredLimits({ driveDefaultLimits: {}, driveLimits: { maxTokens: 1000 } }),
  ).toMatchObject({ limits: { maxTokens: 1000 } });
});

test("single lease among two groups", async () => {
  const { t, thread } = await setup({ settings: { activeDriveGroup: "drv-two" } });
  const calls: string[] = [];
  await eachInOrder(
    [
      ["drv-one", 0],
      ["drv-two", 1],
    ] as const,
    async ([name, loadIndex]) => {
      await t.host.install(
        makeGroupUnit({ name, loadIndex }, (g) => {
          g.drive(() => {
            calls.push(name);
            return Promise.resolve();
          });
        }),
      );
      return "continue";
    },
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(calls).toEqual(["drv-two"]);
  const acquired = t.records.events(thread).filter((event) => event.kind === "lease.acquired");
  expect(acquired).toHaveLength(1);
  expect(acquired[0]?.payload).toMatchObject({ scopeId: "drv-two" });
});

test("two drive groups without a selection get no lease", async () => {
  const { t, thread } = await setup();
  const calls: string[] = [];
  await eachInOrder(
    [
      ["drv-a", 0],
      ["drv-b", 1],
    ] as const,
    async ([name, loadIndex]) => {
      await t.host.install(
        makeGroupUnit({ name, loadIndex }, (g) => {
          g.drive(() => {
            calls.push(name);
            return Promise.resolve();
          });
        }),
      );
      return "continue";
    },
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(calls).toEqual([]);
  expect(t.diagnostics.some((diagnostic) => diagnostic.code === "drive_conflict")).toBe(true);
});

test("drive registration rules", async () => {
  const { t } = await setup();
  const codes: string[] = [];
  const attempt = (
    name: string,
    run: (g: Parameters<Parameters<typeof makeGroupUnit>[1]>[0]) => void,
  ) =>
    t.host.install(
      makeGroupUnit({ name }, (g) => {
        try {
          run(g);
        } catch (error) {
          if (error instanceof PrimitiveError) codes.push(error.code);
          throw error;
        }
      }),
    );
  await attempt("drv-dup", (g) => {
    g.drive(() => Promise.resolve());
    g.drive(() => Promise.resolve());
  });
  expect(codes).toEqual(["drive_duplicate"]);
});

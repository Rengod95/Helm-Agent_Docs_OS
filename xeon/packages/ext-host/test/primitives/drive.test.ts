import { expect, test } from "bun:test";
import { Type } from "typebox";
import type { AskCard, DriveCommand, StepResult } from "@fresnel/contracts/extensions";
import { MAX_CHAINED_REINVOKES } from "../../src/primitives/lease.ts";
import { PrimitiveError } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

/** 상태가 없는 그룹의 명령. S가 never인 명령은 어떤 상태 타입의 단계 함수에도 그대로 들어간다 */
type Command = DriveCommand<never>;

function yieldOf(): Command {
  return { do: "yield" };
}

function turnOf(content: string): Command {
  return { do: "turn", input: { kind: "user", content } };
}

function handoffOf(): Command {
  // E2 엔진도 handoff는 `command_unavailable`로 거부한다(E3). 효과가 없는 명령의 본보기로 쓴다
  return { do: "handoff", to: "other", input: null };
}

const questionCard: AskCard = {
  questions: [
    {
      id: "go",
      header: "Go",
      text: "Go?",
      options: [],
      multiSelect: false,
      allowFreeText: true,
    },
  ],
};

function askOf(): Command {
  return { do: "ask", card: questionCard, requestId: "drv-ask:gate:1" };
}

type Counter = { readonly n: number };

function commitOf(n: number): DriveCommand<Counter> {
  return { do: "commit", state: { n }, next: { do: "yield" } };
}

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
      g.drive(({ last }) => {
        // 한 호출의 첫 단계(last가 null)만 센다. 그 뒤 단계는 명령 결과를 받는다
        if (last === null) calls.push(1);
        return Promise.resolve(last === null ? turnOf("go") : yieldOf());
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(calls).toEqual([1]);
  expect(kindsOf(t, thread)).toEqual(["scope.changed", "lease.acquired", "drive.command_settled"]);
  expect(t.loop.turns[0]?.requestId).toMatch(/^evt_[0-9A-Z]{26}:0\.0$/);
  expect(t.loop.turns[0]?.leaseEpoch).toBe(1);
});

test("reinvoke replays committed turn", async () => {
  const { t, thread } = await setup();
  const outcomes: boolean[] = [];
  await t.host.install(
    makeGroupUnit({ name: "drv-replay" }, (g) => {
      g.drive(({ last }) => {
        if (last === null) return Promise.resolve(turnOf("go"));
        outcomes.push(true);
        return Promise.resolve(yieldOf());
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
        return Promise.resolve(yieldOf());
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
    makeGroupUnit({ name: "drv-throw", hooks: ["boundary.settle.after"] }, (g) => {
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
  expect(t.host.registrations()[0]?.drive).toBe("error");
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
  let issued = 0;
  await t.host.install(
    makeGroupUnit({ name: "drv-budget" }, (g) => {
      // 단계마다 turn을 하나씩 낸다. 세 번째 시도는 예산이 없어 거부되고 임대가 budget으로 반납된다
      g.drive(
        () => {
          issued += 1;
          return Promise.resolve(turnOf(String(issued)));
        },
        { limits: { maxTurns: 2 } },
      );
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(t.loop.turns.length).toBe(2);
  expect(issued).toBe(3);
  const released = t.records.events(thread).find((event) => event.kind === "lease.released");
  expect(released?.payload).toMatchObject({ reason: "budget" });
});

test("turn is rejected once maxTokens is spent (default usage 10 tokens per turn)", async () => {
  const { t, thread } = await setup();
  let issued = 0;
  await t.host.install(
    makeGroupUnit({ name: "drv-tokens" }, (g) => {
      g.drive(
        () => {
          issued += 1;
          return Promise.resolve(turnOf(String(issued)));
        },
        { limits: { maxTokens: 15 } },
      );
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(t.loop.turns.length).toBe(2);
  expect(issued).toBe(3);
  const released = t.records.events(thread).find((event) => event.kind === "lease.released");
  expect(released?.payload).toMatchObject({ reason: "budget" });
});

test("limits clamp to settings", async () => {
  const { t, thread } = await setup({ settings: { driveLimits: { maxTurns: 5 } } });
  await t.host.install(
    makeGroupUnit({ name: "drv-clamp" }, (g) => {
      g.drive(() => Promise.resolve(yieldOf()), { limits: { maxTurns: 10, maxTokens: 100 } });
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
      g.drive(
        () => Promise.resolve(yieldOf()),
        requested === undefined ? undefined : { limits: requested },
      );
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
      driveRequiresGroup: () => true,
      activeDriver: () => null,
      capabilityProviders: () => ({}),
    },
  });
  await t.host.install(
    makeGroupUnit({ name: "drv-session-scope" }, (g) => {
      g.drive(() => Promise.resolve(yieldOf()));
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
  const { t, thread } = await setup({ settings: { activeDriver: "drv-two" } });
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
            return Promise.resolve(yieldOf());
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
            return Promise.resolve(yieldOf());
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
    g.drive(() => Promise.resolve(yieldOf()));
    g.drive(() => Promise.resolve(yieldOf()));
  });
  expect(codes).toEqual(["drive_duplicate"]);
});

const CounterSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });
const counterDef = { state: { schema: CounterSchema, initial: { n: 0 }, version: 1 } };

test("a drive that only commits state is called again with the new state at each boundary until it stops", async () => {
  const { t, thread } = await setup();
  const seen: number[] = [];
  await t.host.install(
    makeGroupUnit({ name: "drv-commit-only", def: counterDef }, (g) => {
      g.drive(({ state }) => {
        seen.push(state.n);
        return Promise.resolve(state.n < 3 ? commitOf(state.n + 1) : yieldOf());
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  // 커밋의 next가 yield라 이 호출은 여기서 끝난다. 상태는 새 판이고, 다음 경계에 새 판으로 다시 묻는다
  expect(seen).toEqual([0]);
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(seen).toEqual([0, 1]);
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(seen).toEqual([0, 1, 2]);
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(seen).toEqual([0, 1, 2, 3]);
  expect(t.loop.turns).toEqual([]);
});

test("a drive whose commands have no effect is called again at most the chain limit without a boundary", async () => {
  const { t, thread } = await setup();
  const seen: number[] = [];
  await t.host.install(
    makeGroupUnit({ name: "drv-noop-forever", def: counterDef }, (g) => {
      g.drive(({ state }) => {
        seen.push(state.n);
        return Promise.resolve(handoffOf());
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  // 효과 없는 명령이 상한만큼 이어지면 엔진이 yield로 끝낸다. 첫 호출을 포함해 상한 번 부른다
  expect(seen).toEqual(Array.from({ length: MAX_CHAINED_REINVOKES }, () => 0));
  expect(
    t.diagnostics.filter((entry) => entry.code === "scope_notice").map((entry) => entry.scopeId),
  ).toEqual(["drv-noop-forever"]);
  // 다음 경계가 오면 이어서 부른다
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(seen.length).toBe(2 * MAX_CHAINED_REINVOKES);
});

test("loop.ask without the approval port is refused as port_unavailable and the drive sees the refusal", async () => {
  const { t, thread } = await setup();
  const results: StepResult[] = [];
  await t.host.install(
    makeGroupUnit({ name: "drv-ask" }, (g) => {
      g.drive(({ last }) => {
        if (last === null) return Promise.resolve(askOf());
        results.push(last);
        return Promise.resolve(yieldOf());
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  // 거부는 예외가 아니라 `refused` 결과로 다음 단계에 온다. 승인 포트가 없으므로 임대와 기록은 그대로다
  expect(results).toEqual([{ kind: "refused", code: "port_unavailable" }]);
  expect(kindsOf(t, thread)).toEqual(["scope.changed", "lease.acquired"]);
});

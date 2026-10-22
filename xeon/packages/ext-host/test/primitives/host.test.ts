import { expect, test } from "bun:test";
import {
  InputQueuePortKey,
  ProjectorRegistryPortKey,
  RecordCommitPortKey,
  ScopedStorePortKey,
} from "@xeon/contracts/extensions";
import { ExtHostPortKey, hostOf, PrimitiveError } from "../../src/primitives/index.ts";
import {
  createTestHost,
  flushMicrotasks,
  memoryProjectorRegistry,
  memoryRecordStore,
  memoryScopedStore,
} from "../../src/testing/index.ts";
import { makeUnit, rejectionOf, unsafeInput } from "./fixtures/support.ts";

const NOOP = (): void => {};

/** 테스트가 열 때까지 닫혀 있는 문 */
function holdOpen(): { readonly promise: Promise<void>; readonly open: () => void } {
  let open = NOOP;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

test("install maps setup outcomes", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);

  // setup의 선언 밖 on은 failed(point_undeclared)이고 등록은 남지 않는다
  const undeclared = await t.host.install(
    makeUnit({ name: "host-undecl", points: ["tool_call"] }, (g) => {
      g.on("tool_call", () => undefined);
      g.on("turn_end", () => undefined);
    }),
  );
  expect(undeclared.setups[0]).toMatchObject({
    status: "failed",
    failure: { kind: "threw", code: "point_undeclared" },
  });
  expect(undeclared.entryError).toBeUndefined();

  // 엔트리 본문 예외는 entryError, scopes는 비어 있다
  const entryThrew = await t.host.install({
    ...makeUnit({ name: "host-entry" }, () => {}),
    entry: () => {
      throw new Error("entry broke");
    },
  });
  expect(entryThrew.scopes).toEqual([]);
  expect(entryThrew.entryError).toBeInstanceOf(Error);
  expect(t.host.scope("host-entry")).toBeUndefined();

  // setup이 그 밖의 예외를 던지면 threw
  const threw = await t.host.install(
    makeUnit({ name: "host-threw" }, () => {
      throw new Error("setup broke");
    }),
  );
  expect(threw.setups[0]).toMatchObject({ status: "failed", failure: { kind: "threw" } });

  // 실행 중 thread가 있으면 deferred
  t.loop.setRunning(thread, true);
  const deferred = await t.host.install(
    makeUnit({ name: "host-defer", points: ["tool_call"] }, (g) => {
      g.on("tool_call", () => undefined);
    }),
  );
  expect(deferred.setups[0]?.status).toBe("deferred");
  // 실행 중에는 단계 경계가 켜기를 적용한다
  await t.boundary(thread).stepEnd();
  expect(t.host.scope("host-defer")?.status).toBe("enabled");
  t.loop.setRunning(thread, false);
});

test("setup that outlives its budget fails with timeout and its late registrations are dropped", async () => {
  const t = await createTestHost({ setupBudgetMs: 100 });
  const gate = holdOpen();
  const lateErrors: unknown[] = [];
  const pending = t.host.install(
    makeUnit({ name: "host-slow", points: ["tool_call"] }, async (g) => {
      await gate.promise;
      try {
        g.on("tool_call", () => undefined);
      } catch (error) {
        lateErrors.push(error);
      }
    }),
  );
  await flushMicrotasks(200);
  await t.timers.advance(150);
  const outcome = await pending;
  expect(outcome.setups[0]).toMatchObject({ status: "failed", failure: { kind: "timeout" } });
  gate.open();
  await t.settled();
  expect(lateErrors[0] instanceof PrimitiveError && lateErrors[0].code).toBe("scope_inactive");
});

test("registerPlatform provides ports and surfaces setup errors", async () => {
  const t = await createTestHost({ without: ["records", "queue"] });
  const registry = memoryProjectorRegistry();
  const store = memoryScopedStore(() => {
    throw new Error("not needed");
  });
  const records = memoryRecordStore();
  const disposed: string[] = [];
  await t.host.registerPlatform({
    name: "platform-fake",
    setup(ctx) {
      ctx.providePort(ScopedStorePortKey, store);
      // xeon.session의 두 하위 포트는 한 서비스로 묶여 제공된다
      ctx.providePort(RecordCommitPortKey, records);
      ctx.providePort(ProjectorRegistryPortKey, registry);
      ctx.onDispose(() => {
        disposed.push("one");
      });
      ctx.onDispose(() => {
        disposed.push("two");
      });
    },
  });
  expect(t.host.ports.get(ScopedStorePortKey)).toBe(store);
  expect(t.host.ports.get(RecordCommitPortKey)).toBe(records);
  expect(t.host.ports.get(ProjectorRegistryPortKey)).toBe(registry);
  expect(t.host.ports.get(InputQueuePortKey)).toBeUndefined();
  expect(t.host.ports.get(ExtHostPortKey)).toBe(t.host);

  const broken = await rejectionOf(() =>
    t.host.registerPlatform({
      name: "platform-broken",
      setup() {
        throw new Error("platform failed");
      },
    }),
  );
  expect(broken instanceof Error && broken.message).toBe("platform failed");

  await t.host.dispose();
  expect(disposed).toEqual(["two", "one"]);
  expect(t.host.ports.get(ScopedStorePortKey)).toBeUndefined();
});

test("duplicate port provision is rejected", async () => {
  const t = await createTestHost({ without: ["records"] });
  const error = await rejectionOf(() =>
    t.host.registerPlatform({
      name: "platform-dup",
      setup(ctx) {
        ctx.providePort(RecordCommitPortKey, memoryRecordStore());
        ctx.providePort(RecordCommitPortKey, memoryRecordStore());
      },
    }),
  );
  expect(error).toBeInstanceOf(PrimitiveError);
});

test("only built-in extensions reach ports", async () => {
  const t = await createTestHost();
  const store = memoryScopedStore(() => {
    throw new Error("not needed");
  });
  const codes: (string | undefined)[] = [];
  const probe = (name: string, builtin: boolean) =>
    t.host.install(
      makeUnit({ name, builtin }, (g) => {
        for (const run of [
          () => hostOf(g).port(RecordCommitPortKey),
          () => hostOf(g).providePort(ScopedStorePortKey, store),
        ]) {
          try {
            run();
            codes.push("ok");
          } catch (error) {
            codes.push(error instanceof PrimitiveError ? error.code : "other");
          }
        }
      }),
    );
  await probe("port-external", false);
  await probe("port-builtin", true);
  expect(codes).toEqual(["service_reserved", "service_reserved", "ok", "ok"]);
});

test("hostOf rejects a foreign ScopeApi", async () => {
  expect(() => hostOf(unsafeInput({}))).toThrow(PrimitiveError);
});

test("uninstall removes definitions and handlers", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "host-gone", points: ["tool_call"] }, (g) => {
      g.on("tool_call", () => undefined);
    }),
  );
  await t.boundary(thread).stepEnd();
  await t.host.uninstall("host-gone");
  expect(t.host.scope("host-gone")).toBeUndefined();
  const drafts = await t.boundary(thread).stepEnd();
  expect(drafts.map((draft) => draft.payload)).toEqual([
    { scopeId: "host-gone", status: "disabled" },
  ]);
});

test("install stops waiting for an entry when its signal aborts", async () => {
  const t = await createTestHost();
  const gate = holdOpen();
  const controller = new AbortController();
  const unit = makeUnit({ name: "host-cancel" }, () => {});
  const slow = { ...unit, entry: async () => gate.promise };
  const pending = t.host.install(slow, { signal: controller.signal });
  await flushMicrotasks(20);
  controller.abort();
  const result = await pending;
  expect(result.scopes).toEqual([]);
  expect(result.entryError).toBeInstanceOf(PrimitiveError);
  expect(result.entryError instanceof PrimitiveError && result.entryError.code).toBe(
    "scope_setup_failed",
  );
  gate.open();
  // 중단된 설치의 이름은 다시 쓸 수 있다
  const again = await t.host.install(makeUnit({ name: "host-cancel" }, () => {}));
  expect(again.entryError).toBeUndefined();
});

// vendored Cordis(df4431e, 4.0.0-rc.11)의 동작을 고정한다(eng.testing.guide TS-01 contract).
// 판본을 바꾸면 가장 먼저 실패해야 하는 파일이다. 결과가 바뀌면 X.primitives.spec §4.3 표를 다시 확인한다.
import { expect, test } from "bun:test";
import { Context } from "@xeon/vendor-cordis";
import { rejectionOf } from "./fixtures/support.ts";

test("bail treats zero as decision", () => {
  const ctx = new Context();
  const event = Symbol("probe.zero");
  ctx.on(event, () => 0);
  ctx.on(event, () => "second");
  const result: unknown = ctx.bail(event);
  expect(result).toBe(0);
});

test("waterfall next twice throws", () => {
  const ctx = new Context();
  const event = Symbol("probe.waterfall");
  ctx.on(event, (next: () => unknown) => {
    next();
    next();
  });
  expect(() => {
    ctx.waterfall(event, () => "inner");
  }).toThrow("next() called multiple times");
});

test("emit does not isolate errors", () => {
  const ctx = new Context();
  const event = Symbol("probe.emit");
  const calls: string[] = [];
  ctx.on(event, () => {
    calls.push("first");
    throw new Error("listener failed");
  });
  ctx.on(event, () => {
    calls.push("second");
  });
  expect(() => ctx.emit(event)).toThrow("listener failed");
  expect(calls).toEqual(["first"]);
});

test("on in pending fiber does not throw", async () => {
  const root = new Context();
  const event = Symbol("probe.pending");
  const fiber = root.plugin({
    name: "needs-service",
    inject: ["missing-service"],
    apply: () => {},
  });
  // inject한 서비스가 없어 PENDING인 fiber 위에서 on을 불러도 던지지 않는다
  expect(() => fiber.ctx.on(event, () => {})).not.toThrow();
  await fiber;
});

test("provide disposer returns promise", async () => {
  const root = new Context();
  const holder: { dispose?: () => unknown } = {};
  const fiber = root.plugin({
    name: "provider",
    inject: [],
    apply: (ctx: Context) => {
      holder.dispose = ctx.provide("probe-service", { value: 1 });
    },
  });
  await fiber;
  const result = holder.dispose?.();
  expect(result).toBeInstanceOf(Promise);
  await result;
  expect(root.reflect.get("probe-service")).toBeUndefined();
});

test("effects dispose concurrently", async () => {
  const root = new Context();
  const log: string[] = [];
  const gates: (() => void)[] = [];
  const fiber = root.plugin({
    name: "effects",
    inject: [],
    apply: (ctx: Context) => {
      ctx.effect(() => async () => {
        log.push("first:start");
        await new Promise<void>((resolve) => gates.push(resolve));
        log.push("first:end");
      });
      ctx.effect(() => async () => {
        log.push("second:start");
        await new Promise<void>((resolve) => gates.push(resolve));
        log.push("second:end");
      });
    },
  });
  await fiber;
  const disposing = fiber.dispose();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  // 두 해제가 모두 시작되었다: 하나가 끝나기를 기다리지 않는다
  expect(log.filter((entry) => entry.endsWith(":start")).toSorted()).toEqual([
    "first:start",
    "second:start",
  ]);
  for (const open of gates) open();
  await disposing;
});

test("a failing apply leaves the fiber failed and its effects disposed", async () => {
  const root = new Context();
  const log: string[] = [];
  const fiber = root.plugin({
    name: "failing",
    inject: [],
    apply: (ctx: Context) => {
      ctx.effect(() => () => {
        log.push("disposed");
      });
      throw new Error("apply failed");
    },
  });
  const error = await rejectionOf(() => fiber);
  expect(error instanceof Error && error.message).toBe("apply failed");
  expect(log).toEqual(["disposed"]);
  await fiber.dispose();
});

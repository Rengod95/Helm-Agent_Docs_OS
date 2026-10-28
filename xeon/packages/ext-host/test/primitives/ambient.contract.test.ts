// Bun의 AsyncLocalStorage 동작을 고정한다(X.primitives.plan P-05). 맥락이 끊기면 state()·commit()·post가 no_thread로 실패한다.
import { expect, test } from "bun:test";
import { ambient, withAmbient, withoutAmbient } from "../../src/primitives/ambient.ts";
import { fixedIdFactory } from "../../src/testing/index.ts";

const ids = fixedIdFactory();

function context() {
  return {
    threadId: ids.next("thr"),
    scopeId: "ctx-scope",
    point: null,
    dispatchKey: "key",
    counter: 0,
    drive: null,
    handler: null,
  };
}

test("context survives await", async () => {
  const value = context();
  const seen: unknown[] = [];
  await withAmbient(value, async () => {
    await Promise.resolve();
    seen.push(ambient());
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    seen.push(ambient());
    // 런타임 동작 확인을 위해 실제 타이머를 0ms로 한 번만 쓴다 (eng.testing.guide TS-03 예외)
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    seen.push(ambient());
    queueMicrotask(() => {
      seen.push(ambient());
    });
    await Promise.resolve();
  });
  expect(seen).toEqual([value, value, value, value]);
  expect(ambient()).toBeUndefined();
});

test("nested contexts shadow and withoutAmbient hides", async () => {
  const outer = context();
  const inner = context();
  await withAmbient(outer, async () => {
    await withAmbient(inner, () => {
      expect(ambient()).toBe(inner);
      return Promise.resolve();
    });
    expect(ambient()).toBe(outer);
    expect(withoutAmbient(() => ambient())).toBeUndefined();
    expect(ambient()).toBe(outer);
  });
});

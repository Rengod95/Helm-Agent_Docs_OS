import { expect, test } from "bun:test";
import { err } from "@fresnel/contracts";
import type { PluginStoreError } from "@fresnel/contracts/extensions";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { openTestStore, type TestStore } from "@fresnel/platform-store/testing";
import { latePluginStorePort } from "../../src/assembly/plugin-data-port.ts";

// 플러그인 전용 저장소의 조립 자리(X.primitives §4.6.7). ext-host는 포트를 만들 때 받고 저장소는 그 뒤에 열리므로,
// 열기 전에는 `storage_unavailable`이고 열린 뒤에는 저장소 포트에 그대로 위임한다.

const UNAVAILABLE = err<PluginStoreError>({ kind: "storage_unavailable" });

test("before the store opens every operation answers storage_unavailable, and after it opens they reach the store", async () => {
  const slot: { store: TestStore | undefined } = { store: undefined };
  const port = latePluginStorePort(() => slot.store?.opened.pluginStore);

  expect(await port.get("acme", "k")).toEqual(UNAVAILABLE);
  expect(await port.put("acme", "k", '"v"')).toEqual(UNAVAILABLE);
  expect(await port.delete("acme", "k")).toEqual(UNAVAILABLE);
  expect(await port.list("acme", "")).toEqual(UNAVAILABLE);
  expect(await port.usage("acme")).toEqual(UNAVAILABLE);
  expect(await port.clear("acme")).toEqual(UNAVAILABLE);

  const clock = { now: (): number => 1_000 };
  const store = await openTestStore({ clock, ids: fixedIdFactory(1) });
  slot.store = store;
  try {
    expect(await port.put("acme", "k", '"v"')).toEqual({ ok: true, value: undefined });
    expect(await port.get("acme", "k")).toEqual({ ok: true, value: '"v"' });
    expect(await port.usage("acme")).toEqual({ ok: true, value: { keys: 1, bytes: 3 } });
    expect(await port.clear("acme")).toEqual({ ok: true, value: undefined });
    expect(await port.get("acme", "k")).toEqual({ ok: true, value: null });
  } finally {
    await store[Symbol.asyncDispose]();
  }
});

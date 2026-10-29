import { describe, expect, test } from "bun:test";
import type { ProviderUnavailableReason } from "@xeon/contracts/capabilities";
import { createProbeCache } from "../src/search/probe-cache.ts";
import { fakeSearchProvider } from "../src/testing/fake-providers.ts";
import { manualClock } from "./support/clock.ts";
import { each } from "./support/seq.ts";

const SIGNAL = new AbortController().signal;
const MINUTE = 60_000;

describe("availability", () => {
  test("unavailable reasons", async () => {
    const reasons: readonly ProviderUnavailableReason[] = [
      "no-key",
      "unreachable",
      "json-disabled",
      "org-disabled",
      "unsupported-model",
    ];
    const cache = createProbeCache(manualClock());
    await each(reasons, async (reason) => {
      const provider = fakeSearchProvider(`plugin:web-${reason.replace(/[^a-z]/g, "")}`, {
        availability: { ok: false, reason },
      });
      expect(await cache.probe(provider, SIGNAL)).toEqual({ ok: false, reason });
    });
  });

  test("probe cache ttl", async () => {
    const clock = manualClock();
    const cache = createProbeCache(clock);
    const good = fakeSearchProvider("searxng");
    expect(await cache.probe(good, SIGNAL)).toEqual({ ok: true });
    clock.advance(4 * MINUTE + 59_000);
    await cache.probe(good, SIGNAL);
    expect(good.probes()).toBe(1);
    clock.advance(2_000);
    await cache.probe(good, SIGNAL);
    expect(good.probes()).toBe(2);

    const bad = fakeSearchProvider("plugin:web-bad", {
      availability: { ok: false, reason: "unreachable" },
    });
    await cache.probe(bad, SIGNAL);
    clock.advance(29_000);
    await cache.probe(bad, SIGNAL);
    expect(bad.probes()).toBe(1);
    // 실패는 30초만 기억하므로 복구가 곧 반영된다
    bad.setAvailability({ ok: true });
    clock.advance(2_000);
    expect(await cache.probe(bad, SIGNAL)).toEqual({ ok: true });
    expect(bad.probes()).toBe(2);
  });

  test("forget clears the memory when the configuration changes", async () => {
    const cache = createProbeCache(manualClock());
    const provider = fakeSearchProvider("plugin:web-key", {
      availability: { ok: false, reason: "no-key" },
    });
    await cache.probe(provider, SIGNAL);
    provider.setAvailability({ ok: true });
    expect(await cache.probe(provider, SIGNAL)).toEqual({ ok: false, reason: "no-key" });
    cache.forget("plugin:web-key");
    expect(await cache.probe(provider, SIGNAL)).toEqual({ ok: true });
    cache.forget();
    await cache.probe(provider, SIGNAL);
    expect(provider.probes()).toBe(3);
  });

  test("a cancelled probe is not remembered", async () => {
    const cache = createProbeCache(manualClock());
    const provider = fakeSearchProvider("plugin:web-key", {
      availability: { ok: false, reason: "no-key" },
    });
    const gone = new AbortController();
    gone.abort();
    await cache.probe(provider, gone.signal);
    provider.setAvailability({ ok: true });
    expect(await cache.probe(provider, SIGNAL)).toEqual({ ok: true });
  });

  test("a probe that throws becomes an unreachable failure instead of rejecting the call", async () => {
    const provider = fakeSearchProvider("plugin:web-throws");
    const throwing = {
      ...provider,
      isAvailable: (): Promise<never> => Promise.reject(new Error("socket hang up")),
    };
    const cache = createProbeCache(manualClock());
    expect(await cache.probe(throwing, SIGNAL)).toEqual({
      ok: false,
      reason: "unreachable",
      detail: "probe threw",
    });
  });
});

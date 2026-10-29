import { afterEach, describe, expect, test } from "bun:test";
import { CapabilityError } from "@xeon/contracts/capabilities";
import { planChain } from "../src/search/chain.ts";
import { fakeCatalog, fakeSearchProvider, searchCandidate } from "../src/testing/fake-providers.ts";
import { releaseStores } from "./support/store.ts";
import { makeWebWorld } from "./support/web-world.ts";

afterEach(releaseStores);

async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  const caught = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(caught instanceof CapabilityError)) throw new Error("expected a CapabilityError");
  return caught;
}

function capabilityError(code: string, extra: { retryAfterMs?: number } = {}): CapabilityError {
  return new CapabilityError({
    capability: "web.search",
    method: "search",
    code,
    message: `${code} from the provider`,
    retryable: code !== "invalid_input",
    ...extra,
  });
}

const A = fakeSearchProvider("plugin:web-a");
const B = fakeSearchProvider("plugin:web-b");
const SEARXNG = fakeSearchProvider("searxng");
const WRAPPER = fakeSearchProvider("builtin-wrapper");
const ALL = [
  searchCandidate(A, "plugin"),
  searchCandidate(B, "plugin"),
  searchCandidate(SEARXNG, "detected"),
  searchCandidate(WRAPPER, "builtin"),
];

describe("search chain", () => {
  test("chain order table", () => {
    const table: readonly {
      name: string;
      candidates: typeof ALL;
      call: string | undefined;
      setting: string;
      listing: readonly string[];
      selectedBy: string;
      order: readonly string[];
    }[] = [
      {
        name: "the user's order list comes first, then searxng, the wrapper, and unlisted plugins last",
        candidates: ALL,
        call: undefined,
        setting: "auto",
        listing: ["plugin:web-b", "plugin:web-a"],
        selectedBy: "auto",
        order: ["plugin:web-b", "plugin:web-a", "searxng", "builtin-wrapper"],
      },
      {
        name: "a built-in tool can be dragged ahead of plugins, unknown ids are skipped",
        candidates: ALL,
        call: undefined,
        setting: "auto",
        listing: ["builtin-wrapper", "plugin:not-installed", "plugin:web-b"],
        selectedBy: "auto",
        order: ["builtin-wrapper", "plugin:web-b", "searxng", "plugin:web-a"],
      },
      {
        name: "plugins are last by default, in byte order",
        candidates: ALL,
        call: undefined,
        setting: "auto",
        listing: [],
        selectedBy: "auto",
        order: ["searxng", "builtin-wrapper", "plugin:web-a", "plugin:web-b"],
      },
      {
        name: "no plugin: searxng then the wrapper",
        candidates: [searchCandidate(SEARXNG, "detected"), searchCandidate(WRAPPER, "builtin")],
        call: undefined,
        setting: "auto",
        listing: [],
        selectedBy: "auto",
        order: ["searxng", "builtin-wrapper"],
      },
      {
        name: "only the wrapper",
        candidates: [searchCandidate(WRAPPER, "builtin")],
        call: undefined,
        setting: "auto",
        listing: [],
        selectedBy: "auto",
        order: ["builtin-wrapper"],
      },
      {
        name: "a call argument selects one provider",
        candidates: ALL,
        call: "searxng",
        setting: "plugin:web-a",
        listing: [],
        selectedBy: "call",
        order: ["searxng"],
      },
      {
        name: "the setting selects one provider",
        candidates: ALL,
        call: undefined,
        setting: "plugin:web-b",
        listing: ["plugin:web-a"],
        selectedBy: "setting",
        order: ["plugin:web-b"],
      },
      {
        name: "an unknown explicit provider has no order",
        candidates: ALL,
        call: "plugin:ghost",
        setting: "auto",
        listing: [],
        selectedBy: "call",
        order: [],
      },
      {
        name: "no candidates at all",
        candidates: [],
        call: undefined,
        setting: "auto",
        listing: [],
        selectedBy: "auto",
        order: [],
      },
    ];
    for (const row of table) {
      const plan = planChain(row.candidates, row.call, row.setting, row.listing);
      expect([row.name, plan.selectedBy, plan.order]).toEqual([
        row.name,
        row.selectedBy,
        row.order,
      ]);
    }
  });

  test("explicit provider does not fall back", async () => {
    const down = fakeSearchProvider("plugin:web-down", {
      availability: { ok: false, reason: "no-key" },
    });
    const other = fakeSearchProvider("builtin-wrapper");
    const world = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(down, "plugin"), searchCandidate(other, "builtin")]),
    });
    const failure = await rejection(world.search({ query: "xeon", provider: "plugin:web-down" }));
    expect(failure.data.code).toBe("unavailable");
    expect(failure.data.detail).toMatchObject({ reason: "no-key" });
    expect(other.searches.length).toBe(0);
    expect(other.probes()).toBe(0);
    // 설정으로 고른 provider도 같다
    world.setSettings({
      ...world.settings(),
      search: { ...world.settings().search, provider: "plugin:web-down" },
    });
    const bySetting = await rejection(world.search({ query: "xeon" }));
    expect(bySetting.data.detail).toMatchObject({ reason: "no-key" });
    expect(other.searches.length).toBe(0);
    // 등록되지 않은 ID
    const unknown = await rejection(world.search({ query: "xeon", provider: "plugin:ghost" }));
    expect(unknown.data.detail).toMatchObject({ reason: "unknown_provider" });
  });

  test("auto chain records fallbacks", async () => {
    const keyless = fakeSearchProvider("plugin:web-x", {
      availability: { ok: false, reason: "no-key" },
    });
    const searx = fakeSearchProvider("searxng", {
      availability: { ok: false, reason: "unreachable" },
    });
    const wrapper = fakeSearchProvider("builtin-wrapper");
    const world = await makeWebWorld({
      settings: { search: { order: ["plugin:web-x"] } },
      catalog: fakeCatalog([
        searchCandidate(keyless, "plugin"),
        searchCandidate(searx, "detected"),
        searchCandidate(wrapper, "builtin"),
      ]),
    });
    const output = await world.search({ query: "xeon agents" });
    expect(output.meta.provider).toBe("builtin-wrapper");
    expect(output.meta.selectedBy).toBe("auto");
    expect(output.meta.fallbacks).toEqual([
      { provider: "plugin:web-x", stage: "probe", reason: "no-key" },
      { provider: "searxng", stage: "probe", reason: "unreachable" },
    ]);
    expect(keyless.searches.length + searx.searches.length).toBe(0);
    expect(wrapper.searches.length).toBe(1);
  });

  test("searxng is used when detected and the wrapper stays untouched", async () => {
    const searx = fakeSearchProvider("searxng");
    const wrapper = fakeSearchProvider("builtin-wrapper");
    const world = await makeWebWorld({
      catalog: fakeCatalog([
        searchCandidate(searx, "detected"),
        searchCandidate(wrapper, "builtin"),
      ]),
    });
    const output = await world.search({ query: "xeon" });
    expect(output.meta.provider).toBe("searxng");
    expect(output.meta.fallbacks).toEqual([]);
    expect(wrapper.probes()).toBe(0);
  });

  test("call error falls back only for safe methods", async () => {
    const limited = fakeSearchProvider("plugin:web-limited");
    limited.failWith(capabilityError("rate_limited", { retryAfterMs: 2000 }));
    const wrapper = fakeSearchProvider("builtin-wrapper");
    const world = await makeWebWorld({
      settings: { search: { order: ["plugin:web-limited"] } },
      catalog: fakeCatalog([
        searchCandidate(limited, "plugin"),
        searchCandidate(wrapper, "builtin"),
      ]),
    });
    const fellBack = await world.search({ query: "xeon" });
    expect(fellBack.meta.provider).toBe("builtin-wrapper");
    expect(fellBack.meta.fallbacks).toEqual([
      { provider: "plugin:web-limited", stage: "call", reason: "rate_limited" },
    ]);

    // invalid_input은 다른 provider를 부르지 않고 바로 실패한다
    limited.failWith(capabilityError("invalid_input"));
    const before = wrapper.searches.length;
    const failure = await rejection(world.search({ query: "xeon two" }));
    expect(failure.data.code).toBe("invalid_input");
    expect(wrapper.searches.length).toBe(before);

    // 명시 선택이면 rate_limited도 retryAfterMs와 함께 그대로 거부한다
    limited.failWith(capabilityError("rate_limited", { retryAfterMs: 2000 }));
    const explicit = await rejection(
      world.search({ query: "xeon three", provider: "plugin:web-limited" }),
    );
    expect(explicit.data.code).toBe("rate_limited");
    expect(explicit.data.retryAfterMs).toBe(2000);
    expect(wrapper.searches.length).toBe(before);
  });

  test("a provider that throws something unexpected is an upstream error and falls back", async () => {
    const broken = fakeSearchProvider("plugin:web-broken");
    broken.failWith(new Error("socket hang up"));
    const wrapper = fakeSearchProvider("builtin-wrapper");
    const world = await makeWebWorld({
      settings: { search: { order: ["plugin:web-broken"] } },
      catalog: fakeCatalog([
        searchCandidate(broken, "plugin"),
        searchCandidate(wrapper, "builtin"),
      ]),
    });
    const output = await world.search({ query: "xeon" });
    expect(output.meta.fallbacks).toEqual([
      { provider: "plugin:web-broken", stage: "call", reason: "upstream_error" },
    ]);
    expect(world.logs.some((log) => log.event === "web.search_provider_failed")).toBe(true);
  });

  test("every candidate failing is unavailable with the whole record", async () => {
    const one = fakeSearchProvider("plugin:web-one", {
      availability: { ok: false, reason: "no-key" },
    });
    const two = fakeSearchProvider("builtin-wrapper", {
      availability: { ok: false, reason: "unsupported-model" },
    });
    const world = await makeWebWorld({
      settings: { search: { order: ["plugin:web-one"] } },
      catalog: fakeCatalog([searchCandidate(one, "plugin"), searchCandidate(two, "builtin")]),
    });
    const failure = await rejection(world.search({ query: "xeon" }));
    expect(failure.data.code).toBe("unavailable");
    expect(failure.data.detail).toMatchObject({
      reason: "all_failed",
      fallbacks: [
        { provider: "plugin:web-one", stage: "probe", reason: "no-key" },
        { provider: "builtin-wrapper", stage: "probe", reason: "unsupported-model" },
      ],
    });
    const empty = await makeWebWorld({ catalog: fakeCatalog() });
    const none = await rejection(empty.search({ query: "xeon" }));
    expect(none.data.detail).toMatchObject({ reason: "no_provider" });
  });
});

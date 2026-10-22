import { expect, test } from "bun:test";
import { attempt, err, ok } from "@xeon/contracts";
import {
  createExtensionLoader,
  LoadAbortError,
  verdictOfInstall,
  type LoadDiagnosticCode,
} from "../../src/loading-trust/index.ts";
import { hostInternalsOf, type InstallResult } from "../../src/primitives/index.ts";
import { flushMicrotasks } from "../../src/testing/index.ts";
import { rejectionOf } from "../primitives/fixtures/support.ts";
import { createLoaderHarness, moduleOf } from "./support/harness.ts";

test("pipeline: undeclared point fails load", async () => {
  const harness = await createLoaderHarness();
  const report = await harness.loader.loadAll(
    harness.options([
      moduleOf({ name: "pipe-undecl", points: ["tool_call"] }, (g) => {
        g.on("tool_call", () => undefined);
        g.on("turn_end", () => undefined);
      }),
    ]),
  );
  const info = report.extensions[0];
  expect(info?.state).toBe("error");
  const usage = info?.diagnostics.find((entry) => entry.code === "usage_invalid");
  expect(usage?.issues?.[0]?.code).toBe("point_undeclared");
  // 그 확장의 다른 등록도 남지 않는다
  expect(hostInternalsOf(harness.t.host).core.registry.size()).toBe(0);
  expect(harness.t.host.scope("pipe-undecl")).toBeUndefined();
  expect(harness.policy.tiers.get("pipe-undecl")).toBeUndefined();
});

test("pipeline: one throwing extension does not block others", async () => {
  const harness = await createLoaderHarness();
  const bad = moduleOf({ name: "pipe-b" }, () => {});
  const modules = [
    moduleOf({ name: "pipe-a", points: ["tool_call"] }, (g) => {
      g.on("tool_call", () => undefined);
    }),
    {
      ...bad,
      extension: () => {
        throw new Error("entry exploded");
      },
    },
    moduleOf({ name: "pipe-c" }),
  ];
  const report = await harness.loader.loadAll(harness.options(modules));
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["pipe-a", "active"],
    ["pipe-b", "error"],
    ["pipe-c", "active"],
  ]);
  expect(report.diagnostics.map((entry) => entry.code)).toContain("entry_threw");
  expect(harness.t.host.scope("pipe-b")).toBeUndefined();
});

test("pipeline: essential failure aborts start", async () => {
  const harness = await createLoaderHarness();
  const essential = moduleOf({ name: "pipe-core", layer: "L1", essential: true });
  const error = await rejectionOf(() =>
    harness.loader.loadAll(
      harness.options([
        {
          ...essential,
          extension: () => {
            throw new Error("core broke");
          },
        },
      ]),
    ),
  );
  expect(error).toBeInstanceOf(LoadAbortError);
  if (error instanceof LoadAbortError) {
    expect(error.diagnostics.map((entry) => entry.code)).toContain("essential_failed");
  }
});

test("pipeline: an invalid manifest is rejected and the others continue", async () => {
  const harness = await createLoaderHarness();
  const broken = moduleOf({ name: "pipe-broken" });
  const modules = [
    { ...broken, manifest: { ...broken.manifest, version: "not-a-version" } },
    moduleOf({ name: "pipe-fine" }),
  ];
  const report = await harness.loader.loadAll(harness.options(modules));
  expect(
    report.extensions
      .map((info) => [info.name, info.state])
      .toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ).toEqual([
    ["pipe-broken", "rejected"],
    ["pipe-fine", "active"],
  ]);
  const rejected = report.diagnostics.find((entry) => entry.code === "manifest_invalid");
  expect(rejected?.issues?.some((issue) => issue.code === "version_invalid")).toBe(true);
});

test("pipeline: unknown key warning kept", async () => {
  const harness = await createLoaderHarness();
  const report = await harness.loader.loadAll(
    harness.options([moduleOf({ name: "pipe-warn", extraManifest: { surprise: true } })]),
  );
  expect(report.extensions[0]?.state).toBe("active");
  const warning = report.diagnostics.find((entry) => entry.severity === "warning");
  expect(warning?.code).toBe("manifest_invalid");
  expect(warning?.issues?.[0]?.code).toBe("unknown_key");
});

test("pipeline: duplicate names reject both", async () => {
  const harness = await createLoaderHarness();
  const report = await harness.loader.loadAll(
    harness.options([
      moduleOf({ name: "pipe-dup" }),
      moduleOf({ name: "pipe-dup" }),
      moduleOf({ name: "pipe-solo" }),
    ]),
  );
  expect(report.extensions.filter((info) => info.state === "rejected")).toHaveLength(2);
  expect(report.diagnostics.filter((entry) => entry.code === "name_conflict")).toHaveLength(2);
  expect(report.extensions.find((info) => info.name === "pipe-solo")?.state).toBe("active");
});

test("pipeline: post during setup rejected", async () => {
  const harness = await createLoaderHarness();
  const report = await harness.loader.loadAll(
    harness.options([
      moduleOf({ name: "pipe-post", usesPost: true }, async (g) => {
        await g.post({ kind: "user", content: "hi" }, { when: "next", requestId: "x" });
      }),
    ]),
  );
  expect(report.extensions[0]?.state).toBe("error");
  expect(report.diagnostics.map((entry) => entry.code)).toEqual(["setup_action"]);
});

test("pipeline: late registration after timeout dropped", async () => {
  const harness = await createLoaderHarness({ settings: { budgets: { setup: 100 } } });
  const gate = Promise.withResolvers<void>();
  const loading = harness.loader.loadAll(
    harness.options([
      moduleOf({ name: "pipe-slow", points: ["tool_call"] }, async (g) => {
        await gate.promise;
        // 세대가 닫혀 있어 거부된다. 거부는 값으로 받고 확인은 아래 단언이 한다
        const late = attempt(() => g.on("tool_call", () => undefined));
        expect(late.ok).toBe(false);
      }),
    ]),
  );
  await flushMicrotasks(200);
  await harness.t.timers.advance(100);
  const report = await loading;
  expect(report.extensions[0]?.state).toBe("error");
  expect(report.diagnostics.map((entry) => entry.code)).toEqual(["setup_timeout"]);
  gate.resolve();
  await harness.t.settled();
  expect(hostInternalsOf(harness.t.host).core.registry.size()).toBe(0);
});

test("pipeline: runtime undeclared on rejected only", async () => {
  const harness = await createLoaderHarness();
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  const codes: string[] = [];
  const report = await harness.loader.loadAll(
    harness.options([
      moduleOf({ name: "pipe-runtime", points: ["agent_settled"] }, (g) => {
        g.on("agent_settled", () => {
          try {
            g.on("turn_end", () => undefined);
          } catch (error) {
            codes.push(error instanceof Error && "code" in error ? String(error.code) : "other");
          }
        });
      }),
    ]),
  );
  expect(report.extensions[0]?.state).toBe("active");
  await harness.t.host.dispatch(
    "agent_settled",
    { turnId: harness.t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
  expect(codes).toEqual(["point_undeclared"]);
  expect(harness.loader.list()[0]?.state).toBe("active");
});

function resultOf(partial: Partial<InstallResult>): InstallResult {
  return { name: "map-ext", scopes: ["map-ext"], setups: [], issues: [], ...partial };
}

test("pipeline: install delegation and error mapping", () => {
  const table: readonly [Partial<InstallResult>, LoadDiagnosticCode][] = [
    [{ entryError: new Error("x"), scopes: [] }, "entry_threw"],
    [{ scopes: [] }, "usage_invalid"],
    [
      {
        setups: [
          {
            scopeId: "map-ext",
            status: "failed",
            failure: { kind: "threw", code: "point_undeclared" },
            issues: [],
          },
        ],
      },
      "usage_invalid",
    ],
    [
      {
        setups: [
          {
            scopeId: "map-ext",
            status: "failed",
            failure: { kind: "threw", code: "no_thread" },
            issues: [],
          },
        ],
      },
      "setup_action",
    ],
    [
      {
        setups: [
          { scopeId: "map-ext", status: "failed", failure: { kind: "timeout" }, issues: [] },
        ],
      },
      "setup_timeout",
    ],
    [
      {
        setups: [
          {
            scopeId: "map-ext",
            status: "failed",
            failure: { kind: "threw", error: new Error("y") },
            issues: [],
          },
        ],
      },
      "setup_threw",
    ],
    [
      {
        setups: [
          {
            scopeId: "map-ext",
            status: "failed",
            failure: { kind: "threw", code: "capability_unavailable" },
            issues: [],
          },
        ],
      },
      "capability_missing",
    ],
  ];
  for (const [partial, code] of table) {
    const verdict = verdictOfInstall(resultOf(partial));
    expect(verdict.ok).toBe(false);
    expect(verdict.diagnostics[0]?.code).toBe(code);
  }
  // 경고 이슈는 usage_warning이고 실패가 아니다
  const warned = verdictOfInstall(
    resultOf({
      setups: [
        {
          scopeId: "map-ext",
          status: "applied",
          issues: [
            { severity: "warning", code: "point_unused", path: "/points/0", message: "unused" },
          ],
        },
      ],
    }),
  );
  expect(warned.ok).toBe(true);
  expect(warned.diagnostics[0]?.code).toBe("usage_warning");
});

test("pipeline: install failure maps through a fake host and the loader never imports Cordis", async () => {
  const installed: string[] = [];
  const uninstalled: string[] = [];
  const forgotten: string[] = [];
  const harness = await createLoaderHarness();
  const fakeHost = {
    ...harness.t.host,
    install: (unit: { manifest: { name: string } }) => {
      installed.push(unit.manifest.name);
      return Promise.resolve(
        resultOf({
          name: unit.manifest.name,
          setups: [
            {
              scopeId: unit.manifest.name,
              status: "failed",
              failure: { kind: "timeout" as const },
              issues: [],
            },
          ],
        }),
      );
    },
    uninstall: (name: string) => {
      uninstalled.push(name);
      return Promise.resolve();
    },
  };
  const loader = createExtensionLoader({
    host: fakeHost,
    policy: {
      admit: (info) => {
        installed.push(`admit:${info.name}`);
        return ok("builtin");
      },
      forget: (name) => {
        forgotten.push(name);
      },
    },
    fs: {
      readText: () => Promise.resolve(null),
      listDir: () => Promise.resolve(null),
      exists: () => Promise.resolve(false),
      realpath: (p) => Promise.resolve(p),
    },
    paths: { userDir: "/u", managedDir: null, homeDir: "/h" },
    trustBackend: {
      read: () => Promise.resolve({ ok: true, text: null }),
      update: () => Promise.resolve(),
    },
    clock: { now: () => 0 },
  });
  const report = await loader.loadAll(harness.options([moduleOf({ name: "fake-host-ext" })]));
  expect(installed).toEqual(["admit:fake-host-ext", "fake-host-ext"]);
  expect(uninstalled).toEqual(["fake-host-ext"]);
  expect(forgotten).toEqual(["fake-host-ext"]);
  expect(report.diagnostics.map((entry) => entry.code)).toEqual(["setup_timeout"]);
});

test("pipeline: admit rejection skips install", async () => {
  const installed: string[] = [];
  const harness = await createLoaderHarness({
    policy: {
      admit: (info) => {
        installed.push(info.name);
        return err({ kind: "untrusted", name: info.name });
      },
      forget: () => {},
    },
  });
  const report = await harness.loader.loadAll(harness.options([moduleOf({ name: "pipe-tier" })]));
  expect(installed).toEqual(["pipe-tier"]);
  expect(report.extensions[0]?.state).toBe("error");
  expect(report.diagnostics.map((entry) => entry.code)).toEqual(["tier_rejected"]);
  expect(harness.t.host.scope("pipe-tier")).toBeUndefined();
});

test("pipeline: an aborted signal stops loadAll before the next install", async () => {
  const harness = await createLoaderHarness();
  const controller = new AbortController();
  const installed: string[] = [];
  const track = (name: string): ReturnType<typeof moduleOf> => {
    const base = moduleOf({ name });
    return {
      ...base,
      extension: (...args: Parameters<typeof base.extension>) => {
        installed.push(name);
        // 첫 확장을 설치하는 도중에 취소가 온다
        controller.abort();
        return base.extension(...args);
      },
    };
  };
  const options = harness.options([track("cancel-a"), track("cancel-b")]);
  const error = await rejectionOf(() =>
    harness.loader.loadAll({ ...options, signal: controller.signal }),
  );
  expect(error).toBeInstanceOf(LoadAbortError);
  // 진행 중인 설치는 끝까지 가고 다음 확장은 시작하지 않는다
  expect(installed).toEqual(["cancel-a"]);
});

test("pipeline: ensureLoaded with an aborted signal installs nothing and can be retried", async () => {
  const harness = await createLoaderHarness();
  harness.settings.enabled.set("cancel-late", false);
  let entryCalls = 0;
  const late = moduleOf({ name: "cancel-late" });
  await harness.loader.loadAll(
    harness.options([
      {
        ...late,
        extension: (...args: Parameters<typeof late.extension>) => {
          entryCalls += 1;
          return late.extension(...args);
        },
      },
    ]),
  );
  harness.settings.enabled.set("cancel-late", true);
  const controller = new AbortController();
  controller.abort();
  const error = await rejectionOf(() =>
    harness.loader.ensureLoaded("cancel-late", controller.signal),
  );
  expect(error).toBeInstanceOf(LoadAbortError);
  expect(entryCalls).toBe(0);
  const info = await harness.loader.ensureLoaded("cancel-late", new AbortController().signal);
  expect(info.state).toBe("active");
  expect(entryCalls).toBe(1);
});

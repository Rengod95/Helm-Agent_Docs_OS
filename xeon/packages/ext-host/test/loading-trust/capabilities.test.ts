import { expect, test } from "bun:test";
import type { ServiceKey } from "@xeon/contracts/capabilities";
import { satisfiesRange } from "../../src/loading-trust/index.ts";
import { hostOf } from "../../src/primitives/index.ts";
import { createLoaderHarness, moduleOf } from "./support/harness.ts";

interface Echo {
  echo(): string;
}
const echoKey: ServiceKey<Echo> = { capability: "demo.echo", version: "1.0.0" };

test("capabilities: missing capability provider diagnosed", async () => {
  const harness = await createLoaderHarness();
  let entryCalls = 0;
  const consumer = moduleOf({ name: "cap-user", requires: [{ id: "demo.echo", range: "^1.0.0" }] });
  const report = await harness.loader.loadAll(
    harness.options([
      {
        ...consumer,
        extension: () => {
          entryCalls += 1;
        },
      },
    ]),
  );
  expect(entryCalls).toBe(0);
  expect(report.extensions[0]?.state).toBe("error");
  const diagnostic = report.diagnostics.find((entry) => entry.code === "capability_missing");
  expect(diagnostic?.message).toContain("demo.echo");
  expect(diagnostic?.message).toContain("^1.0.0");
});

test("capabilities: a provider outside the required range does not count", async () => {
  const harness = await createLoaderHarness();
  const report = await harness.loader.loadAll(
    harness.options([
      moduleOf(
        { name: "cap-old", layer: "L2", provides: [{ id: "demo.echo", version: "1.4.0" }] },
        (g) => {
          hostOf(g).provide(echoKey, { echo: () => "old" });
        },
      ),
      moduleOf({
        name: "cap-new-user",
        layer: "L3",
        kind: "group",
        requires: [{ id: "demo.echo", range: "^2.0.0" }],
      }),
    ]),
  );
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["cap-old", "active"],
    ["cap-new-user", "error"],
  ]);
  expect(report.diagnostics.map((entry) => entry.code)).toEqual(["capability_missing"]);
});

test("capabilities: a provider in range feeds the consumer, in load order", async () => {
  const harness = await createLoaderHarness();
  const answers: string[] = [];
  const report = await harness.loader.loadAll(
    harness.options([
      // 입력 순서는 소비자가 먼저지만 로드 순서는 층이 정한다(L2 → L3)
      moduleOf(
        {
          name: "cap-consumer",
          layer: "L3",
          kind: "group",
          requires: [{ id: "demo.echo", range: "^1.0.0" }],
        },
        (g) => {
          answers.push(g.capability(echoKey).echo());
        },
      ),
      moduleOf(
        { name: "cap-provider", layer: "L2", provides: [{ id: "demo.echo", version: "1.2.0" }] },
        (g) => {
          hostOf(g).provide(echoKey, { echo: () => "from provider" });
        },
      ),
    ]),
  );
  expect(report.extensions.map((info) => [info.name, info.state, info.loadIndex])).toEqual([
    ["cap-provider", "active", 0],
    ["cap-consumer", "active", 1],
  ]);
  expect(answers).toEqual(["from provider"]);
});

test("capabilities: a core capability satisfies a requirement", async () => {
  const harness = await createLoaderHarness({ core: new Map([["core.models", "1.0.0"]]) });
  const report = await harness.loader.loadAll(
    harness.options([
      moduleOf(
        { name: "cap-core-user", requires: [{ id: "core.models", range: "^1.0.0" }] },
        () => {},
      ),
    ]),
  );
  // 코어 능력은 레지스트리에 있지만 서비스는 아직 없다: 엔트리는 실행되고 setup이 능력 부재로 실패한다
  expect(report.diagnostics.some((entry) => entry.code === "capability_missing")).toBe(true);
  expect(report.diagnostics.some((entry) => entry.stage === "capabilities")).toBe(false);
});

test("capabilities: provider failure cascades", async () => {
  const harness = await createLoaderHarness();
  let consumerEntry = 0;
  const consumer = moduleOf({
    name: "cap-casc-user",
    layer: "L3",
    kind: "group",
    requires: [{ id: "demo.echo", range: "^1.0.0" }],
  });
  const report = await harness.loader.loadAll(
    harness.options([
      moduleOf(
        {
          name: "cap-casc-provider",
          layer: "L2",
          provides: [{ id: "demo.echo", version: "1.0.0" }],
        },
        () => {
          throw new Error("provider setup failed");
        },
      ),
      {
        ...consumer,
        extension: (host) => {
          consumerEntry += 1;
          return consumer.extension(host);
        },
      },
    ]),
  );
  expect(report.extensions.map((info) => [info.name, info.state])).toEqual([
    ["cap-casc-provider", "error"],
    ["cap-casc-user", "error"],
  ]);
  expect(report.diagnostics.map((entry) => entry.code)).toEqual([
    "setup_threw",
    "capability_provider_failed",
  ]);
  expect(consumerEntry).toBe(0);
});

test("capabilities: optional capabilities are not checked", async () => {
  const harness = await createLoaderHarness();
  const report = await harness.loader.loadAll(
    harness.options([
      moduleOf({ name: "cap-opt", optional: [{ id: "demo.echo", range: "^1.0.0" }] }),
    ]),
  );
  expect(report.extensions[0]?.state).toBe("active");
});

test("capabilities: range arithmetic", () => {
  const cases: readonly [string, string, boolean][] = [
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    ["1.2.9", "^1.2.3", true],
    ["1.3.0", "^1.2.3", true],
    ["2.0.0", "^1.2.3", false],
    ["1.2.2", "^1.2.3", false],
    ["0.2.5", "^0.2.3", true],
    ["0.3.0", "^0.2.3", false],
    ["0.0.3", "^0.0.3", true],
    ["0.0.4", "^0.0.3", false],
    ["1.2.9", "~1.2.3", true],
    ["1.3.0", "~1.2.3", false],
    ["3.0.0", ">=2.1.0", true],
    ["2.0.9", ">=2.1.0", false],
    ["2.5.0", ">=2.1.0 <3.0.0", true],
    ["3.0.0", ">=2.1.0 <3.0.0", false],
    ["1.0.0-beta.1", "^1.0.0", false],
    ["nonsense", "^1.0.0", false],
    ["1.0.0", "1.x", false],
  ];
  for (const [version, range, expected] of cases) {
    expect(satisfiesRange(version, range)).toBe(expected);
  }
});

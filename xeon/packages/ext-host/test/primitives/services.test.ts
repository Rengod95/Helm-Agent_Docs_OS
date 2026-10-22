import { expect, test } from "bun:test";
import type { ServiceKey } from "@xeon/contracts/capabilities";
import {
  capabilityServiceName,
  hostOf,
  isReservedServiceName,
  providerServiceName,
  PrimitiveError,
} from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { makeUnit } from "./fixtures/support.ts";

interface Echo {
  echo(text: string): string;
}
const echoKey: ServiceKey<Echo> = { capability: "demo.echo", version: "1.0.0" };

function echoNamed(name: string): Echo {
  return { echo: () => name };
}

test("service names", async () => {
  expect(capabilityServiceName("web.search")).toBe("cap:web.search");
  expect(providerServiceName("web.search", "web-exa")).toBe("cap:web.search@web-exa");
  expect(isReservedServiceName("cap:web.search")).toBe(true);
  expect(isReservedServiceName("xeon.loop")).toBe(true);
  expect(isReservedServiceName("_private")).toBe(true);
  expect(isReservedServiceName("my-service")).toBe(false);
});

test("a provider binds its capability and a consumer reads it", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "demo-provider", provides: [{ id: "demo.echo", version: "1.2.0" }] }, (g) => {
      hostOf(g).provide(echoKey, { echo: (text) => `echo:${text}` });
    }),
  );
  const answers: string[] = [];
  const outcome = await t.host.install(
    makeUnit(
      {
        name: "demo-consumer",
        points: ["agent_settled"],
        requires: [{ id: "demo.echo", range: "^1.0.0" }],
        loadIndex: 1,
      },
      (g) => {
        g.on("agent_settled", () => {
          answers.push(g.capability(echoKey).echo("hi"));
        });
      },
    ),
  );
  expect(outcome.setups[0]?.status).toBe("applied");
  await t.host.dispatch(
    "agent_settled",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
  expect(answers).toEqual(["echo:hi"]);
});

test("two providers do not collide in Cordis, but need a selection", async () => {
  const t = await createTestHost();
  await eachInOrder(
    [
      ["demo-p1", 0],
      ["demo-p2", 1],
    ] as const,
    async ([name, loadIndex]) => {
      const outcome = await t.host.install(
        makeUnit({ name, loadIndex, provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
          hostOf(g).provide(echoKey, echoNamed(name));
        }),
      );
      expect(outcome.setups[0]?.status).toBe("applied");
      return "continue";
    },
  );
  await t.settled();
  expect(t.diagnostics.some((diagnostic) => diagnostic.code === "capability_ambiguous")).toBe(true);
  const outcome = await t.host.install(
    makeUnit(
      { name: "demo-user", loadIndex: 2, requires: [{ id: "demo.echo", range: "^1.0.0" }] },
      () => {},
    ),
  );
  expect(outcome.setups[0]).toMatchObject({
    status: "failed",
    failure: { kind: "threw", code: "capability_unavailable" },
  });
  expect(t.host.scopes().find((scope) => scope.id === "demo-user")?.waiting).toEqual(["demo.echo"]);
});

test("a provider with a different major version is not bound", async () => {
  const t = await createTestHost();
  await t.host.install(
    makeUnit({ name: "demo-v2", provides: [{ id: "demo.echo", version: "2.0.0" }] }, (g) => {
      hostOf(g).provide(echoKey, { echo: () => "v2" });
    }),
  );
  await t.settled();
  const outcome = await t.host.install(
    makeUnit(
      { name: "demo-v1-user", loadIndex: 1, requires: [{ id: "demo.echo", range: "^1.0.0" }] },
      () => {},
    ),
  );
  expect(outcome.setups[0]?.status).toBe("failed");
});

test("capability rules: undeclared, optional-missing, provide without declaration", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const codes: (string | undefined)[] = [];
  await t.host.install(
    makeUnit(
      {
        name: "cap-rules",
        points: ["agent_settled"],
        optional: [{ id: "demo.echo", range: "^1.0.0" }],
      },
      (g) => {
        g.on("agent_settled", () => {
          for (const run of [
            () =>
              g.capability({
                capability: "demo.other",
                version: "1.0.0",
              } satisfies ServiceKey<Echo>),
            () => g.capability(echoKey),
            () => hostOf(g).provide(echoKey, { echo: () => "x" }),
          ]) {
            try {
              run();
              codes.push(undefined);
            } catch (error) {
              codes.push(error instanceof PrimitiveError ? error.code : "other");
            }
          }
        });
      },
    ),
  );
  await t.host.dispatch(
    "agent_settled",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
  expect(codes).toEqual([
    "capability_undeclared",
    "capability_unavailable",
    "capability_undeclared",
  ]);
});

test("a disabled provider takes its capability away", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "demo-gone", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
      hostOf(g).provide(echoKey, { echo: () => "here" });
    }),
  );
  await t.settled();
  const first = await t.host.install(
    makeUnit(
      { name: "demo-first", loadIndex: 1, requires: [{ id: "demo.echo", range: "^1.0.0" }] },
      () => {},
    ),
  );
  expect(first.setups[0]?.status).toBe("applied");
  t.host.scope("demo-gone")?.disable();
  await t.settled();
  const second = await t.host.install(
    makeUnit(
      { name: "demo-second", loadIndex: 2, requires: [{ id: "demo.echo", range: "^1.0.0" }] },
      () => {},
    ),
  );
  expect(second.setups[0]?.status).toBe("failed");
});

async function installTwoProviders(t: Awaited<ReturnType<typeof createTestHost>>): Promise<void> {
  await eachInOrder(
    [
      ["demo-p1", 0],
      ["demo-p2", 1],
    ] as const,
    async ([name, loadIndex]) => {
      await t.host.install(
        makeUnit({ name, loadIndex, provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
          hostOf(g).provide(echoKey, echoNamed(name));
        }),
      );
      return "continue";
    },
  );
  await t.settled();
}

async function answerOf(
  t: Awaited<ReturnType<typeof createTestHost>>,
  name: string,
): Promise<string | undefined> {
  const thread = t.newThread();
  await t.host.openThread(thread);
  const answers: string[] = [];
  const outcome = await t.host.install(
    makeUnit(
      {
        name,
        loadIndex: 9,
        points: ["agent_settled"],
        requires: [{ id: "demo.echo", range: "^1.0.0" }],
      },
      (g) => {
        g.on("agent_settled", () => {
          answers.push(g.capability(echoKey).echo("x"));
        });
      },
    ),
  );
  if (outcome.setups[0]?.status !== "applied") return undefined;
  await t.host.dispatch(
    "agent_settled",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
  return answers[0];
}

test("capabilityProviders picks one of several providers", async () => {
  const t = await createTestHost({ settings: { capabilityProviders: { "demo.echo": "demo-p2" } } });
  await installTwoProviders(t);
  expect(t.diagnostics.some((diagnostic) => diagnostic.code === "capability_ambiguous")).toBe(
    false,
  );
  expect(await answerOf(t, "demo-picked")).toBe("demo-p2");
});

test("capabilityProviders naming an absent provider keeps the capability ambiguous", async () => {
  const t = await createTestHost({ settings: { capabilityProviders: { "demo.echo": "demo-p3" } } });
  await installTwoProviders(t);
  const ambiguous = t.diagnostics.filter(
    (diagnostic) => diagnostic.code === "capability_ambiguous",
  );
  expect(ambiguous.at(-1)?.message).toContain("demo-p3");
  expect(await answerOf(t, "demo-unpicked")).toBeUndefined();
});

test("the selection moves to the other provider when the chosen one is disabled", async () => {
  const t = await createTestHost({ settings: { capabilityProviders: { "demo.echo": "demo-p2" } } });
  await installTwoProviders(t);
  expect(await answerOf(t, "demo-before")).toBe("demo-p2");
  // 고른 공급자가 내려가면 남은 하나가 후보다. 선택이 없는 공급자 하나는 그대로 바인딩된다
  t.host.scope("demo-p2")?.disable();
  await t.settled();
  expect(await answerOf(t, "demo-after")).toBe("demo-p1");
});

test("a provider of another major version is reported and excluded", async () => {
  const t = await createTestHost();
  await t.host.install(
    makeUnit({ name: "demo-v2", provides: [{ id: "demo.echo", version: "2.0.0" }] }, (g) => {
      hostOf(g).provide(echoKey, { echo: () => "v2" });
    }),
  );
  await t.settled();
  expect(
    t.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "capability_unavailable" && diagnostic.extension === "demo-v2",
    ),
  ).toBe(true);
});

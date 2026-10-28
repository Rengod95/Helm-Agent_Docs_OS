import { expect, test } from "bun:test";
import { FIRST_DENY } from "@xeon/contracts/extensions";
import {
  assignTier,
  compareOrderKey,
  GUARD_EXTENSIONS,
  orderKeyOf,
  ownerKey,
  TIERS,
} from "../../src/operations/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

const toolCall = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };

test("tier: guard handler always runs first", async () => {
  const harness = await createOperationsHarness();
  const { t, policy } = harness;
  const thread = t.newThread();
  await t.host.openThread(thread);
  const calls: string[] = [];
  // 사용자 확장을 먼저 싣고 먼저 등록해도 가드가 앞선다
  policy.admit({ name: "tier-user", source: "user", trust: "user", essential: false }, "plugin");
  policy.admit({ name: "core-tools", source: "builtin", trust: "builtin", essential: true }, "L1");
  policy.admit(
    { name: "tier-builtin", source: "builtin", trust: "builtin", essential: false },
    "L2",
  );
  await eachInOrder(
    [
      ["tier-user", 0],
      ["tier-builtin", 1],
      ["core-tools", 2],
    ] as const,
    async ([name, loadIndex]) => {
      await t.host.install(
        makeUnit(
          {
            name,
            points: ["tool.call.before"],
            loadIndex,
            layer: name === "core-tools" ? "L1" : "plugin",
          },
          (g) => {
            g.on("tool.call.before", () => {
              calls.push(name);
              return undefined;
            });
          },
        ),
      );
      return "continue";
    },
  );
  await t.host.dispatch("tool.call.before", toolCall, { threadId: thread, dispatchKey: "k" });
  expect(calls).toEqual(["core-tools", "tier-user", "tier-builtin"]);
});

test("tier: first fold stops at outer guard deny", async () => {
  const harness = await createOperationsHarness();
  const { t, policy } = harness;
  const thread = t.newThread();
  await t.host.openThread(thread);
  const calls: string[] = [];
  policy.admit({ name: "tier-inner", source: "user", trust: "user", essential: false }, "plugin");
  policy.admit({ name: "core-tools", source: "builtin", trust: "builtin", essential: true }, "L1");
  await t.host.install(
    makeUnit({ name: "tier-inner", points: ["tool.call.before"], loadIndex: 0 }, (g) => {
      g.on("tool.call.before", () => {
        calls.push("user");
        return undefined;
      });
    }),
  );
  await t.host.install(
    makeUnit(
      { name: "core-tools", points: ["tool.call.before"], loadIndex: 1, layer: "L1" },
      (g) => {
        g.on("tool.call.before", () => {
          calls.push("guard");
          return { block: true, reason: "denied by rule" };
        });
      },
    ),
  );
  const outcome = await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.decision).toEqual({ block: true, reason: "denied by rule" });
  expect(outcome.decision).not.toEqual(FIRST_DENY["tool.call.before"]);
  expect(calls).toEqual(["guard"]);
});

test("tier: lexicographic order within tier", async () => {
  const harness = await createOperationsHarness();
  const { t, policy } = harness;
  const thread = t.newThread();
  await t.host.openThread(thread);
  const calls: string[] = [];
  await eachInOrder(
    [
      ["tier-b", 5],
      ["tier-a", 2],
    ] as const,
    async ([name, loadIndex]) => {
      policy.admit({ name, source: "user", trust: "user", essential: false }, "plugin");
      await t.host.install(
        makeUnit({ name, points: ["tool.call.before"], loadIndex }, (g) => {
          g.on("tool.call.before", () => {
            calls.push(`${name}#1`);
            return undefined;
          });
          g.on("tool.call.before", () => {
            calls.push(`${name}#2`);
            return undefined;
          });
        }),
      );
      return "continue";
    },
  );
  await t.host.dispatch("tool.call.before", toolCall, { threadId: thread, dispatchKey: "k" });
  expect(calls).toEqual(["tier-a#1", "tier-a#2", "tier-b#1", "tier-b#2"]);
});

test("tier: order keys sort by (tier, loadIndex, registrationIndex)", () => {
  const owner = { type: "extension", name: "x-ext", scopeId: "x-ext" } as const;
  const keys = [
    orderKeyOf({ owner, tier: "core", loadIndex: 0, registrationIndex: 0 }),
    orderKeyOf({ owner, tier: "user", loadIndex: 3, registrationIndex: 1 }),
    orderKeyOf({ owner, tier: "user", loadIndex: 3, registrationIndex: 0 }),
    orderKeyOf({ owner, tier: "guard", loadIndex: 9, registrationIndex: 9 }),
  ];
  expect(keys.toSorted(compareOrderKey)).toEqual([
    [0, 9, 9],
    [1, 3, 0],
    [1, 3, 1],
    [4, 0, 0],
  ]);
  expect(TIERS).toEqual(["guard", "user", "project", "builtin", "core"]);
  expect(ownerKey({ type: "hook", hookId: "audit" })).toBe("hook:audit");
  expect(ownerKey(owner)).toBe("ext:x-ext");
});

test("tier: assignTier table", () => {
  expect(
    assignTier({ name: "core-tools", source: "builtin", trust: "builtin", layer: "L1" }),
  ).toEqual({ ok: true, value: "guard" });
  expect(
    assignTier({ name: "core-loop", source: "builtin", trust: "builtin", layer: "L1" }),
  ).toEqual({ ok: true, value: "core" });
  expect(assignTier({ name: "cap-web", source: "builtin", trust: "builtin", layer: "L2" })).toEqual(
    { ok: true, value: "builtin" },
  );
  expect(
    assignTier({ name: "group-helm", source: "builtin", trust: "builtin", layer: "L3" }),
  ).toEqual({ ok: true, value: "builtin" });
  expect(
    assignTier({ name: "some-plugin", source: "builtin", trust: "builtin", layer: "plugin" }),
  ).toEqual({ ok: true, value: "builtin" });
  expect(
    assignTier({ name: "org-policy", source: "managed", trust: "user", layer: "plugin" }),
  ).toEqual({ ok: true, value: "guard" });
  expect(assignTier({ name: "mine", source: "user", trust: "user", layer: "plugin" })).toEqual({
    ok: true,
    value: "user",
  });
  expect(
    assignTier({ name: "proj", source: "project", trust: "project", layer: "plugin" }),
  ).toEqual({ ok: true, value: "project" });
  // 허용 목록 밖은 guard를 받지 못한다
  expect(GUARD_EXTENSIONS.has("some-plugin")).toBe(false);
  expect(
    assignTier({ name: "some-plugin", source: "builtin", trust: "builtin", layer: "L1" }),
  ).toEqual({ ok: true, value: "core" });
  // 설치 위치보다 높은 등급을 요청하면 source_trust_mismatch다
  expect(
    assignTier({ name: "proj", source: "project", trust: "builtin", layer: "plugin" }),
  ).toEqual({
    ok: false,
    error: { kind: "source_trust_mismatch", name: "proj" },
  });
  expect(assignTier({ name: "mine", source: "user", trust: "builtin", layer: "plugin" }).ok).toBe(
    false,
  );
  expect(
    assignTier({ name: "bad", source: "project", trust: "untrusted", layer: "plugin" }),
  ).toEqual({
    ok: false,
    error: { kind: "untrusted", name: "bad" },
  });
  // 허용 목록을 직접 넘겨 가드를 더할 수 있다
  expect(
    assignTier(
      { name: "extra", source: "builtin", trust: "builtin", layer: "L2" },
      new Set(["extra"]),
    ),
  ).toEqual({ ok: true, value: "guard" });
});

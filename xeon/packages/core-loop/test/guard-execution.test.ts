import { expect, test } from "bun:test";
import {
  defineManifest,
  type ExtensionEntry,
  type GuardOutputPayload,
} from "@xeon/contracts/extensions";
import type { ExtensionUnit } from "@xeon/ext-host";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createHarness } from "./support/harness.ts";

// M3-REQ-109 / B2-ART: guard.output.before의 target "execution". 산출물 적용 직전에 L2가 loop.guardExecution으로 부른다.

type Mode = "pass" | "block" | "throw";

function guardUnit(mode: Mode, seen: GuardOutputPayload[]): ExtensionUnit {
  const manifest = defineManifest({
    schemaVersion: 1,
    name: "execution-guard",
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./index.ts",
    points: ["guard.output.before"],
    usesDrive: false,
  });
  const entry: ExtensionEntry = ({ manifest: own, scope }) => {
    scope(own.name, {}, (g) => {
      g.on("guard.output.before", (payload) => {
        seen.push(payload);
        if (mode === "throw") throw new Error("guard exploded");
        return mode === "block" ? { block: true, reason: "not for execution" } : undefined;
      });
    });
  };
  return { manifest, entry, loadIndex: 5, builtin: false };
}

const turnId = fixedIdFactory(3_000_000).next("trn");

async function fire(mode: Mode, requestId = "exec-1") {
  const h = await createHarness({ script: [] });
  const seen: GuardOutputPayload[] = [];
  await h.host.host.install(guardUnit(mode, seen));
  await h.host.settled();
  const outcome = await h.loop.guardExecution({
    threadId: h.threadId,
    turnId,
    content: "--- a/x\n+++ b/x\n",
    requestId,
  });
  return { outcome, seen, threadId: h.threadId };
}

test("guardExecution fires guard.output.before with target execution and passes when no handler objects", async () => {
  const { outcome, seen, threadId } = await fire("pass");
  expect(outcome).toEqual({ ok: true, value: { status: "allowed" } });
  expect(seen).toEqual([{ threadId, turnId, target: "execution", content: "--- a/x\n+++ b/x\n" }]);
});

test("a blocking guard makes guardExecution return blocked with the reason", async () => {
  const { outcome } = await fire("block");
  expect(outcome).toEqual({ ok: true, value: { status: "blocked", reason: "not for execution" } });
});

test("a throwing guard blocks the execution (fail closed)", async () => {
  const { outcome } = await fire("throw");
  expect(outcome).toEqual({
    ok: true,
    value: { status: "blocked", reason: "extension handler failed" },
  });
});

test("a requestId outside 1-64 characters is an input error and nothing is fired", async () => {
  const { outcome, seen } = await fire("pass", "");
  expect(outcome.ok).toBe(false);
  expect(seen).toEqual([]);
});

import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { ItemRecordedPayloadSchema } from "@xeon/contracts/records";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  defineManifest,
  type AgentSettledPayload,
  type AgentStartPayload,
  type ExtensionEntry,
  type GuardOutputPayload,
  type LoopTurnRequest,
  type PointName,
} from "@xeon/contracts/extensions";
import type { ChildTurnRequest } from "@xeon/contracts/services";
import type { ExtensionUnit } from "@xeon/ext-host";
import { originOfSource } from "../src/turn-start.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { firstOfKind } from "./support/inspect.ts";

// M3-REQ-77(M3-13) 입력 출처 origin, M3-REQ-109 guard.output.before

const answer = (value: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});
const read = (id: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "toolCall", id, name: "read", arguments: {} }],
  stopReason: "toolUse",
});

interface Seen {
  readonly starts: AgentStartPayload[];
  readonly settles: AgentSettledPayload[];
  readonly guards: GuardOutputPayload[];
}

type GuardMode = "pass" | "block" | "throw";

function watcher(mode: GuardMode): { unit: ExtensionUnit; seen: Seen } {
  const seen: {
    starts: AgentStartPayload[];
    settles: AgentSettledPayload[];
    guards: GuardOutputPayload[];
  } = { starts: [], settles: [], guards: [] };
  const points: PointName[] = [
    "boundary.turn.before",
    "boundary.settle.after",
    "guard.output.before",
  ];
  const manifest = defineManifest({
    schemaVersion: 1,
    name: "origin-watch",
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./index.ts",
    points,
    usesDrive: false,
  });
  const entry: ExtensionEntry = ({ manifest: own, scope }) => {
    scope(own.name, {}, (g) => {
      g.on("boundary.turn.before", (payload) => {
        seen.starts.push(payload);
      });
      g.on("boundary.settle.after", (payload) => {
        seen.settles.push(payload);
      });
      g.on("guard.output.before", (payload) => {
        seen.guards.push(payload);
        if (mode === "throw") throw new Error("guard exploded");
        return mode === "block" ? { block: true, reason: "not for display" } : undefined;
      });
    });
  };
  return { unit: { manifest, entry, loadIndex: 5, builtin: false }, seen };
}

function assistantTexts(h: Harness, threadId: ThreadId = h.threadId): string[] {
  return h.fake.events(threadId).flatMap((event) => {
    if (event.kind !== "item.recorded") return [];
    const parsed = parse(ItemRecordedPayloadSchema, event.payload);
    if (!parsed.ok || parsed.value.item.kind !== "assistant") return [];
    return parsed.value.item.message.content.flatMap((block) =>
      block.type === "text" ? [block.text] : [],
    );
  });
}

function lastAssistantItemId(h: Harness): string | undefined {
  const ids = h.fake.events(h.threadId).flatMap((event) => {
    if (event.kind !== "item.recorded") return [];
    const parsed = parse(ItemRecordedPayloadSchema, event.payload);
    return parsed.ok && parsed.value.item.kind === "assistant" ? [parsed.value.item.itemId] : [];
  });
  return ids.at(-1);
}

test("the user path records origin user on turn.started and the agent start and settled payloads", async () => {
  const h = await createHarness({ script: [answer("hello")] });
  const { unit, seen } = watcher("pass");
  await h.host.host.install(unit);
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  expect(firstOfKind(h.fake.events(h.threadId), "turn.started")?.payload).toMatchObject({
    origin: "user",
  });
  expect(seen.starts.map((start) => start.origin)).toEqual(["user"]);
  expect(seen.settles).toHaveLength(1);
  expect(seen.settles[0]).toMatchObject({
    aborted: false,
    origin: "user",
    status: "completed",
    hasFinalAnswer: true,
    lastItemId: lastAssistantItemId(h),
  });
});

test("a failed turn settles with status error and no final answer", async () => {
  const h = await createHarness({ script: [{ kind: "error", message: "provider down" }] });
  const { unit, seen } = watcher("pass");
  await h.host.host.install(unit);
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  expect(seen.settles[0]).toMatchObject({ status: "error", hasFinalAnswer: false, aborted: false });
});

test("a drive turn records origin drive", async () => {
  const h = await createHarness({ script: [answer("driven")] });
  const { unit, seen } = watcher("pass");
  await h.host.host.install(unit);
  await h.host.settled();
  const request: LoopTurnRequest = {
    threadId: h.threadId,
    scopeId: "smoke-group",
    leaseId: "lease-1",
    leaseEpoch: 1,
    requestId: "lease-1:0.0",
    input: { kind: "user", content: "drive this" },
    signal: new AbortController().signal,
  };
  await h.loop.runTurn(request);
  expect(firstOfKind(h.fake.events(h.threadId), "turn.started")?.payload).toMatchObject({
    origin: "drive",
  });
  expect(seen.starts.map((start) => start.origin)).toEqual(["drive"]);
});

test("a child turn records origin delegation on turn.started and no input.queued", async () => {
  const h = await createHarness({ script: [answer("child done")] });
  const threadId = h.fake.startThread();
  await h.host.host.openThread(threadId);
  const scope = h.tasks.service.openScope(h.tasks.service.root, { kind: "subagent", id: threadId });
  const request: ChildTurnRequest = {
    threadId,
    requestId: "child-req-1",
    input: { kind: "user", content: "do it" },
    systemPrompt: "child prompt",
    model: "subagent",
    tools: {
      caller: "subagent:explorer",
      depth: 1,
      interactive: false,
      surfaceThreadId: threadId,
      ceiling: { caller: "main", depth: 0, mode: "default" },
    },
    signal: new AbortController().signal,
    scope,
  };
  const result = await h.loop.runChildTurn(request);
  expect(result.ok).toBe(true);
  expect(firstOfKind(h.fake.events(threadId), "turn.started")?.payload).toMatchObject({
    origin: "delegation",
  });
});

test("originOfSource maps each input source to a turn origin", async () => {
  const h = await createHarness({ script: [] });
  expect(originOfSource({ type: "user", via: "interactive" })).toBe("user");
  expect(originOfSource({ type: "user", via: "rpc" })).toBe("user");
  expect(originOfSource({ type: "delegation", childThreadId: h.threadId })).toBe("delegation");
  expect(originOfSource({ type: "schedule", timerId: "t1" })).toBe("scheduled");
  expect(originOfSource({ type: "extension", scopeId: "g" })).toBe("other");
});

test("guard.output.before sees the final answer, and a pass leaves it as it was", async () => {
  const h = await createHarness({ script: [answer("the answer")] });
  const { unit, seen } = watcher("pass");
  await h.host.host.install(unit);
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  expect(seen.guards).toHaveLength(1);
  expect(seen.guards[0]).toMatchObject({ target: "display", content: "the answer" });
  expect(assistantTexts(h)).toEqual(["the answer"]);
});

test("a guard.output.before block withholds the answer and the reason is recorded in the conversation", async () => {
  const h = await createHarness({ script: [answer("secret answer")] });
  const { unit } = watcher("block");
  await h.host.host.install(unit);
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  expect(assistantTexts(h)).toEqual(["[xeon:withheld_by_guard] not for display"]);
});

test("a throwing guard.output.before handler also withholds the answer (fail closed)", async () => {
  const h = await createHarness({ script: [answer("secret answer")] });
  const { unit } = watcher("throw");
  await h.host.host.install(unit);
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  expect(assistantTexts(h)).toEqual(["[xeon:withheld_by_guard] extension handler failed"]);
});

test("a step with tool calls is not an output: the guard only sees the final answer", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [read("c1"), answer("done")],
  });
  const { unit, seen } = watcher("pass");
  await h.host.host.install(unit);
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  expect(seen.guards.map((guard) => guard.content)).toEqual(["done"]);
});

test("a turn aborted while the output guard runs ends aborted and the answer is not shown as withheld", async () => {
  const h = await createHarness({ script: [answer("answer under guard")] });
  const threadId = h.fake.startThread();
  await h.host.host.openThread(threadId);
  const scope = h.tasks.service.openScope(h.tasks.service.root, { kind: "subagent", id: threadId });
  const controller = new AbortController();
  const manifest = defineManifest({
    schemaVersion: 1,
    name: "abort-guard",
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./index.ts",
    points: ["guard.output.before"],
    usesDrive: false,
  });
  const entry: ExtensionEntry = ({ manifest: own, scope: group }) => {
    group(own.name, {}, (g) => {
      g.on("guard.output.before", () => {
        controller.abort();
        return undefined;
      });
    });
  };
  await h.host.host.install({ manifest, entry, loadIndex: 5, builtin: false });
  await h.host.settled();
  const request: ChildTurnRequest = {
    threadId,
    requestId: "child-req-abort",
    input: { kind: "user", content: "go" },
    systemPrompt: "child prompt",
    model: "subagent",
    tools: {
      caller: "subagent:explorer",
      depth: 1,
      interactive: false,
      surfaceThreadId: threadId,
      ceiling: { caller: "main", depth: 0, mode: "default" },
    },
    signal: controller.signal,
    scope,
  };
  const result = await h.loop.runChildTurn(request);
  expect(result.ok && result.value.outcome.status).toBe("aborted");
  expect(assistantTexts(h, threadId)).toEqual([]);
});

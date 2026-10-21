import { expect, test } from "bun:test";
import { join } from "node:path";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import type { ExtensionUnit } from "@xeon/ext-host";
import { createHarness } from "./support/harness.ts";
import { createRecorder } from "./support/recorder.ts";
import { countKind } from "./support/inspect.ts";

// agent-core 1.3.0 계약: 훅 순서, 이벤트 순서, 모든 turn이 runAgentLoop([], …) 하나라는 점(L1.loop.plan §5)

const answer = {
  kind: "message",
  content: [{ type: "text", text: "hello" }],
  stopReason: "stop",
} as const;

test("extension_points_fire_in_the_documented_order_around_the_commits", async () => {
  const h = await createHarness({ script: [answer] });
  const recorder = createRecorder(h.fake);
  const installed = await h.host.host.install(recorder.unit);
  expect(installed.entryError).toBeUndefined();
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();

  expect(recorder.order()).toEqual([
    "input",
    "before_agent_start",
    "agent_start",
    "turn_start",
    "message_start",
    "message_update",
    "message_end",
    "turn_end",
    "agent_before_settle",
    "agent_end",
    "agent_settled",
  ]);
  const lastKindAt = (point: string): string | undefined =>
    recorder.sightings.find((sighting) => sighting.point === point)?.lastKind;
  // tap은 커밋 뒤, chain은 커밋 전
  expect(lastKindAt("turn_start")).toBe("step.started");
  expect(lastKindAt("message_end")).toBe("step.started");
  expect(lastKindAt("turn_end")).toBe("item.recorded");
  expect(lastKindAt("agent_before_settle")).toBe("item.recorded");
  expect(lastKindAt("agent_end")).toBe("turn.completed");
  expect(lastKindAt("agent_settled")).toBe("turn.completed");
});

test("turn_end_fires_on_each_step_boundary_and_agent_before_settle_only_when_settling", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [
      {
        kind: "message",
        content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
        stopReason: "toolUse",
      },
      answer,
    ],
  });
  const recorder = createRecorder(h.fake);
  await h.host.host.install(recorder.unit);
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const count = (point: string): number =>
    recorder.sightings.filter((sighting) => sighting.point === point).length;
  expect(count("turn_start")).toBe(2);
  expect(count("turn_end")).toBe(2);
  expect(count("agent_before_settle")).toBe(1);
  expect(count("agent_end")).toBe(1);
});

test("the_wrapper_calls_only_runAgentLoop_with_an_empty_prompt_list", async () => {
  const source = await Bun.file(join(import.meta.dir, "../src/agent-wrapper.ts")).text();
  expect(source).not.toContain("runAgentLoopContinue");
  expect(source).not.toContain("agentLoopContinue");
  expect(source).not.toContain("getDefaultStreamFn");
  expect(source).not.toContain("setDefaultStreamFn");
  expect(source).not.toContain("streamProxy");
  expect(source).toMatch(/runAgentLoop\(\s*\[\]/);
  // Agent 클래스와 pi-ai는 import하지 않는다(DR-07)
  expect(source).not.toMatch(/from "@earendil-works\/pi-ai"/);
});

test("core_loop_imports_no_other_core_package_and_no_cordis", async () => {
  const glob = new Bun.Glob("**/*.ts");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: join(import.meta.dir, "../src") })) files.push(file);
  expect(files.length).toBeGreaterThan(5);
  const texts = await Promise.all(
    files.map((file) => Bun.file(join(import.meta.dir, "../src", file)).text()),
  );
  for (const [index, source] of texts.entries()) {
    const file = files[index] ?? "";
    expect(source, file).not.toMatch(/from "@xeon\/core-/);
    expect(source, file).not.toMatch(/from "cordis/);
    expect(source, file).not.toMatch(/from "@xeon\/platform-/);
    expect(source, file).not.toMatch(/from "@earendil-works\/pi-ai"/);
    // 시간·난수·ID는 주입받는다(TX-06)
    expect(source, file).not.toMatch(/Date\.now\(|Math\.random\(|crypto\.randomUUID\(/);
  }
});

function inputGroup(handler: Parameters<typeof makeEntry>[0]): ExtensionUnit {
  return {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "input-filter",
      version: "0.1.0",
      layer: "plugin",
      kind: "plugin",
      entry: "./index.ts",
      points: ["input"],
      usesDrive: false,
    }),
    entry: makeEntry(handler),
    loadIndex: 1,
    builtin: false,
  };
}

function makeEntry(
  handler: (
    text: string,
  ) => { action: "handled" } | { action: "transform"; text: string } | undefined,
): ExtensionEntry {
  return ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      g.on("input", (payload) => handler(payload.text));
    });
  };
}

test("admit_fires_input_before_enqueue_and_handled_records_nothing", async () => {
  const h = await createHarness({ script: [answer] });
  await h.host.host.install(
    inputGroup((text) => (text === "/help" ? { action: "handled" } : undefined)),
  );
  await h.host.settled();
  const handled = await h.loop.admit({
    threadId: h.threadId,
    content: "/help",
    via: "interactive",
  });
  expect(handled.ok && handled.value.status).toBe("handled");
  expect(countKind(h.fake.events(h.threadId), "input.queued")).toBe(0);
  expect(h.fake.commitCalls).toBe(1); // thread.started 하나뿐
});

test("admit_input_transform_puts_the_changed_text_in_the_queue", async () => {
  const h = await createHarness({ script: [answer] });
  await h.host.host.install(
    inputGroup((text) => ({ action: "transform", text: `${text} (expanded)` })),
  );
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "run it", via: "interactive" });
  await h.settle();
  const queued = h.fake.events(h.threadId).find((event) => event.kind === "input.queued");
  expect(queued?.payload).toMatchObject({ item: { kind: "user", content: "run it (expanded)" } });
  expect(h.models.requests[0]?.messages.at(-1)).toMatchObject({ content: "run it (expanded)" });
});

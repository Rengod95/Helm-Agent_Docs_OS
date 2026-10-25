import { expect, test } from "bun:test";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import type { ExtensionUnit } from "@xeon/ext-host";
import { environmentText, promptAddition } from "../src/loop/environment.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";
import { createHarness } from "./support/harness.ts";

// M2 마감 G2-03(감사 L1-03). `before_agent_start`가 바꾼 시스템 프롬프트는 접두에 굳지 않고 요청마다 volatile로 넘어간다.
// 조립 대역은 volatile을 메시지에 붙이지 않고 받은 값만 기록한다. 대화 끝에 붙는 위치는 core-context 시험이 본다.

const read: ScriptedResponse = {
  kind: "message",
  content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
  stopReason: "toolUse",
};
const done: ScriptedResponse = {
  kind: "message",
  content: [{ type: "text", text: "done" }],
  stopReason: "stop",
};

/** turn마다 다른 안내를 기본 프롬프트 뒤에 붙이는 핸들러. `next`가 돌려줄 문자열을 호출 순서대로 쓴다 */
function advertiser(outputs: readonly (string | ((base: string) => string))[]): ExtensionUnit {
  let call = 0;
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      g.on("before_agent_start", (_payload, current) => {
        const output = outputs[Math.min(call, outputs.length - 1)];
        call += 1;
        const text = typeof output === "function" ? output(current.systemPrompt) : output;
        return text === undefined ? undefined : { systemPrompt: text };
      });
    });
  };
  return {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "advertiser",
      version: "0.1.0",
      layer: "plugin",
      kind: "plugin",
      entry: "./index.ts",
      points: ["before_agent_start"],
      usesDrive: false,
    }),
    entry,
    loadIndex: 4,
    builtin: false,
  };
}

const BASE = "You are a test assistant.";

test("a_prompt_change_of_the_second_turn_reaches_the_request_and_never_the_prefix", async () => {
  const h = await createHarness({ script: [done, done] });
  await h.host.host.install(
    advertiser([(base) => `${base}\n\ncommands: /one`, (base) => `${base}\n\ncommands: /one /two`]),
  );
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "first", via: "interactive" });
  await h.settle();
  await h.loop.admit({ threadId: h.threadId, content: "second", via: "interactive" });
  await h.settle();

  expect(h.context.assembled.map((a) => a.volatile["instructions"])).toEqual([
    "commands: /one",
    "commands: /one /two",
  ]);
  // 접두는 두 요청 모두 기본 프롬프트 그대로다. 첫 turn의 안내가 접두에 굳지 않는다
  expect(h.models.requests.map((r) => r.messages[0])).toMatchObject([
    { role: "system", content: BASE },
    { role: "system", content: BASE },
  ]);
});

test("the_prompt_addition_is_sent_on_every_step_of_the_turn", async () => {
  const h = await createHarness({ tools: [{ name: "read" }], script: [read, done] });
  await h.host.host.install(advertiser([(base) => `${base}\n\nnote: stay short`]));
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  expect(h.context.assembled).toHaveLength(2);
  expect(h.context.assembled.map((a) => a.volatile["instructions"])).toEqual([
    "note: stay short",
    "note: stay short",
  ]);
});

test("a_handler_that_replaces_the_base_prompt_sends_the_whole_replacement_and_no_handler_sends_nothing", async () => {
  const replaced = await createHarness({ script: [done] });
  await replaced.host.host.install(advertiser(["Totally different prompt."]));
  await replaced.host.settled();
  await replaced.loop.admit({ threadId: replaced.threadId, content: "go", via: "interactive" });
  await replaced.settle();
  expect(replaced.context.assembled[0]?.volatile["instructions"]).toBe("Totally different prompt.");
  expect(replaced.context.assembled[0]?.basePrompt).toBe(BASE);

  const plain = await createHarness({ script: [done] });
  await plain.loop.admit({ threadId: plain.threadId, content: "go", via: "interactive" });
  await plain.settle();
  expect(Object.keys(plain.context.assembled[0]?.volatile ?? {})).toEqual(["environment"]);
});

test("the_environment_block_carries_date_working_directory_and_platform_each_step", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [read, done],
    workingDirectory: () => "/work/helm",
    platform: "darwin/arm64",
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const date = new Date(h.clock.now()).toISOString().slice(0, 10);
  const expected = `date: ${date} (UTC)\nworking_directory: /work/helm\nplatform: darwin/arm64`;
  expect(h.context.assembled.map((a) => a.volatile["environment"])).toEqual([expected, expected]);
});

test("environmentText_and_promptAddition_are_pure", () => {
  expect(
    environmentText({
      now: Date.UTC(2026, 9, 25, 23, 59),
      workingDirectory: undefined,
      platform: undefined,
    }),
  ).toBe("date: 2026-10-25 (UTC)");
  expect(environmentText({ now: 0, workingDirectory: "", platform: "linux/x64" })).toBe(
    "date: 1970-01-01 (UTC)\nplatform: linux/x64",
  );
  expect(promptAddition("base", "base")).toBe("");
  expect(promptAddition("base", "base\n\nmore")).toBe("more");
  expect(promptAddition("base", "other")).toBe("other");
});

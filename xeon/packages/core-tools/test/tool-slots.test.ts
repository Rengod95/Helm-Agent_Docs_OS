import { expect, test } from "bun:test";
import type { AgentTool } from "@xeon/contracts/conversation";
import {
  callTool,
  createHarness,
  directTool,
  expectOk,
  until,
  type Harness,
} from "./support/harness.ts";

// L1A.5: 태스크 엔진 M2(TL-17). `tools` 풀 슬롯은 키 잠금 뒤에 얻고, 자식을 기다리는 도구는 슬롯을 내려놓고 기다린다.

interface Gated {
  readonly started: string[];
  readonly finished: string[];
  open(id: string): void;
}

/** 시작하면 열릴 때까지 기다리는 도구 하나를 등록한다 */
function addGated(
  h: Harness,
  name: string,
  extra?: Partial<Pick<AgentTool, "executionMode">>,
): Gated {
  const gates = new Map<string, PromiseWithResolvers<void>>();
  const gated: Gated = {
    started: [],
    finished: [],
    open: (id) => {
      gates.get(id)?.resolve();
    },
  };
  expectOk(
    h.runtime.tools.register({
      kind: "direct",
      orderKey: "ext.slots",
      tool: directTool(
        name,
        async (toolCallId) => {
          gated.started.push(toolCallId);
          const gate = Promise.withResolvers<void>();
          gates.set(toolCallId, gate);
          await gate.promise;
          gated.finished.push(toolCallId);
          return { content: [{ type: "text", text: `done ${toolCallId}` }], details: null };
        },
        extra,
      ),
      policy: { risk: "read" },
    }),
  );
  return gated;
}

test("tools_pool_cap_waits_after_lock: with one slot the second call starts only after the first releases it", async () => {
  const h = await createHarness({ toolsCapacity: 1 });
  const gated = addGated(h, "slow");
  const first = callTool(h.runtime.tools, h.run(), { id: "s1", name: "slow", args: {} });
  await until(() => gated.started.includes("s1"));
  const second = callTool(h.runtime.tools, h.run(), { id: "s2", name: "slow", args: {} });
  await until(() => h.session.commits.some((commit) => commit.requestId === "tool:s2:intent"));
  expect(h.tasks.slotsInUse()).toBe(1);
  // 두 번째는 슬롯을 기다린다: 실행 표시(effect.exec)도 아직 없다
  expect(gated.started).toEqual(["s1"]);
  expect(h.session.commits.filter((commit) => commit.requestId === "tool:s2:exec")).toHaveLength(0);
  gated.open("s1");
  await first;
  await until(() => gated.started.includes("s2"));
  expect(gated.finished).toEqual(["s1"]);
  gated.open("s2");
  await second;
  expect(gated.finished).toEqual(["s1", "s2"]);
  expect(h.tasks.slotsInUse()).toBe(0);
  expect(h.tasks.trace).toEqual(["slot:s1", "release:s1", "slot:s2", "release:s2"]);
});

test("with room for both, two calls run together", async () => {
  const h = await createHarness({ toolsCapacity: 2 });
  const gated = addGated(h, "slow");
  const first = callTool(h.runtime.tools, h.run(), { id: "p1", name: "slow", args: {} });
  const second = callTool(h.runtime.tools, h.run(), { id: "p2", name: "slow", args: {} });
  await until(() => gated.started.length === 2);
  expect(h.tasks.slotsInUse()).toBe(2);
  gated.open("p1");
  gated.open("p2");
  await Promise.all([first, second]);
  expect(h.tasks.slotsInUse()).toBe(0);
});

test("slot_wait_abort_leaves_no_exec: cancelling the turn while waiting for a slot records no effect.exec and releases nothing it never held", async () => {
  const h = await createHarness({ toolsCapacity: 1 });
  const gated = addGated(h, "slow");
  const run = h.run();
  const first = callTool(h.runtime.tools, run, { id: "a1", name: "slow", args: {} });
  await until(() => gated.started.includes("a1"));
  const waiting = callTool(h.runtime.tools, run, { id: "a2", name: "slow", args: {} });
  await until(() => h.session.commits.some((commit) => commit.requestId === "tool:a2:intent"));
  h.tasks.abortTurn(run.turnId);
  const out = await waiting;
  expect(out.result?.content).toEqual([
    { type: "text", text: expect.stringContaining("cancelled while waiting for a tool slot") },
  ]);
  expect(h.session.commits.some((commit) => commit.requestId === "tool:a2:exec")).toBe(false);
  expect(gated.started).toEqual(["a1"]);
  gated.open("a1");
  await first;
  expect(h.tasks.slotsInUse()).toBe(0);
});

test("suspendWhile hands the slot back while the call waits for a child and takes a slot again afterwards", async () => {
  const h = await createHarness({ toolsCapacity: 1 });
  const child = Promise.withResolvers<string>();
  const afterSuspend: string[] = [];
  expectOk(
    h.runtime.tools.register({
      kind: "direct",
      orderKey: "core.agents",
      tool: directTool("agent", async (toolCallId) => {
        const answer = await h.runtime.tools.suspendWhile(h.thread, toolCallId, child.promise);
        afterSuspend.push(`slots:${h.tasks.slotsInUse()}`);
        return { content: [{ type: "text", text: answer }], details: null };
      }),
      policy: { risk: "read" },
    }),
  );
  const other = addGated(h, "slow");
  const parent = callTool(h.runtime.tools, h.run(), { id: "agent_1", name: "agent", args: {} });
  // 부모 도구가 자식을 기다리는 동안 슬롯이 비어 다른 호출이 돈다
  await until(() => h.tasks.trace.includes("release:agent_1"));
  expect(h.tasks.slotsInUse()).toBe(0);
  const peer = callTool(h.runtime.tools, h.run(), { id: "peer_1", name: "slow", args: {} });
  await until(() => other.started.includes("peer_1"));
  child.resolve("child answered");
  // 슬롯은 peer가 놓은 뒤에 다시 얻는다
  other.open("peer_1");
  await peer;
  const result = await parent;
  expect(result.result?.content).toEqual([{ type: "text", text: "child answered" }]);
  expect(afterSuspend).toEqual(["slots:1"]);
  expect(h.tasks.slotsInUse()).toBe(0);
});

test("suspendWhile for a call that holds no slot just waits", async () => {
  const h = await createHarness();
  expect(await h.runtime.tools.suspendWhile(h.thread, "no_such_call", Promise.resolve(7))).toBe(7);
});

test("without a task service no slot is taken and the call still runs", async () => {
  const h = await createHarness({ withTasks: false, toolsCapacity: 1 });
  const gated = addGated(h, "slow");
  const done = callTool(h.runtime.tools, h.run(), { id: "n1", name: "slow", args: {} });
  await until(() => gated.started.includes("n1"));
  gated.open("n1");
  expect((await done).blocked).toBeUndefined();
  expect(h.tasks.trace).toEqual([]);
});

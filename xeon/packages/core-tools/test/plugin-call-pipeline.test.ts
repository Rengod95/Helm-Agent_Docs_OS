import { expect, test } from "bun:test";
import type { PluginCallRequest } from "@fresnel/contracts/services";
import { createToolRuntime } from "../src/runtime.ts";
import {
  callTool,
  createHarness,
  installHandlers,
  layer,
  registerWorkspace,
  until,
  type Harness,
} from "./support/harness.ts";

// hooks-core-boundary §4.6·§5.3(U-3, U-4, U-6, U-7, U-8, U-12): 플러그인 기능 호출은 모델 도구 호출과 같은 파이프라인을 지나고
// 호출 주체는 `plugin:<이름>`이며 대화 항목을 남기지 않는다.

function callOf(h: Harness, patch: Partial<PluginCallRequest> = {}): PluginCallRequest {
  return {
    threadId: h.thread,
    plugin: { name: "p1", scopeId: "scope-p1" },
    via: "method",
    target: { kind: "tool", name: "read" },
    input: { path: "a.txt" },
    requestId: "req-1",
    ...patch,
  };
}

test("a plugin's read call runs the pipeline: the result comes back and tool.call.before sees caller plugin:p1", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const seen: string[] = [];
  await installHandlers(h, "watcher", ["tool.call.before"], (g) => {
    g.on("tool.call.before", (payload) => {
      seen.push(`${payload.toolName}:${payload.caller ?? "none"}`);
      return undefined;
    });
  });
  const result = await h.runtime.tools.executeForPlugin(callOf(h));
  expect(result).toMatchObject({
    ok: true,
    value: { isError: false, structuredContent: { text: "hello" } },
  });
  expect(seen).toEqual(["read:plugin:p1"]);
  expect(probe.calls).toHaveLength(1);
  // 플러그인 호출의 결과는 대화 항목을 남기지 않는다(효과 기록만)
  expect(h.session.events.map((event) => event.kind)).not.toContain("item.recorded");
});

test("a policy deny rule refuses the plugin call with a denied error and runs nothing", async () => {
  const h = await createHarness({
    layers: [
      layer("managed", {
        "l1.tools.rules": [
          { id: "m.no-read", action: "tool.call", resource: { tool: "read" }, effect: "deny" },
        ],
      }),
    ],
  });
  const probe = registerWorkspace(h);
  const result = await h.runtime.tools.executeForPlugin(callOf(h));
  expect(result).toMatchObject({ ok: false, error: { kind: "denied" } });
  expect(probe.calls).toEqual([]);
  expect(h.session.events).toEqual([]);
});

test("a tool.call.before block from another plugin returns blocked with the reason", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "guard", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ block: true, reason: "no reads today" }));
  });
  const result = await h.runtime.tools.executeForPlugin(callOf(h));
  expect(result).toMatchObject({
    ok: false,
    error: { kind: "blocked", message: "[fresnel:denied_by_extension] no reads today" },
  });
  expect(probe.calls).toEqual([]);
});

test("the same requestId from the same plugin scope executes once and returns the same result", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const first = await h.runtime.tools.executeForPlugin(callOf(h, { requestId: "same" }));
  const second = await h.runtime.tools.executeForPlugin(callOf(h, { requestId: "same" }));
  expect(second).toEqual(first);
  expect(probe.calls).toHaveLength(1);
  // 다른 플러그인 스코프의 같은 요청 id는 다른 호출이다
  const other = await h.runtime.tools.executeForPlugin(
    callOf(h, { plugin: { name: "p2", scopeId: "scope-p2" }, requestId: "same" }),
  );
  expect(other).toMatchObject({ ok: true });
  expect(probe.calls).toHaveLength(2);
});

test("the calling plugin's own tool.call.before handler is not invoked for its own call", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const fired: string[] = [];
  await installHandlers(h, "p1", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => {
      fired.push("p1");
      return { block: true, reason: "p1 blocks itself" };
    });
  });
  const result = await h.runtime.tools.executeForPlugin(callOf(h));
  expect(fired).toEqual([]);
  expect(result).toMatchObject({ ok: true, value: { isError: false } });
  expect(probe.calls).toHaveLength(1);
});

test("a hook depth above the limit is refused with hook_depth; the default limit is 3 and the setting moves it", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  expect(
    await h.runtime.tools.executeForPlugin(callOf(h, { hookDepth: 4, requestId: "deep" })),
  ).toMatchObject({ ok: false, error: { kind: "hook_depth" } });
  expect(probe.calls).toEqual([]);
  expect(
    await h.runtime.tools.executeForPlugin(callOf(h, { hookDepth: 3, requestId: "edge" })),
  ).toMatchObject({ ok: true });

  const lowered = await createHarness({
    layers: [layer("user", { "l1.tools.pluginCallDepth": 1 })],
  });
  const loweredProbe = registerWorkspace(lowered);
  expect(
    await lowered.runtime.tools.executeForPlugin(
      callOf(lowered, { hookDepth: 2, requestId: "lowered" }),
    ),
  ).toMatchObject({ ok: false, error: { kind: "hook_depth" } });
  expect(loweredProbe.calls).toEqual([]);
});

test("in default mode a plugin's bash call opens an approval card for caller plugin:p1 and runs after allow", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const pending = h.runtime.tools.executeForPlugin(
    callOf(h, {
      target: { kind: "tool", name: "bash" },
      input: { command: "echo hi" },
      requestId: "ask-1",
    }),
  );
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(request?.origin.caller).toBe("plugin:p1");
  expect(probe.calls).toEqual([]);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "allow" });
  expect(await pending).toMatchObject({ ok: true, value: { isError: false } });
  expect(probe.calls).toHaveLength(1);
});

test("after a restart the same requestId returns the recorded result and does not run the tool again", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const first = await h.runtime.tools.executeForPlugin(callOf(h, { requestId: "durable" }));
  expect(first).toMatchObject({ ok: true, value: { isError: false } });
  // 재시작 흉내: 같은 세션 위에 새 서비스를 세운다. 새 서비스에는 `read` 도구가 없으므로 실행했다면 실패했다
  const restarted = createToolRuntime(h.deps);
  expect(restarted.tools.meta("read")).toBeUndefined();
  const replayed = await restarted.tools.executeForPlugin(callOf(h, { requestId: "durable" }));
  expect(replayed).toMatchObject({
    ok: true,
    value: { isError: false, structuredContent: { text: "hello" } },
  });
  expect(probe.calls).toHaveLength(1);
});

test("an intent without a recorded result is unknown_outcome and is never run again", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  // 결과 커밋만 실패시킨다: 의도와 실행 표시는 남고 결과는 남지 않는다
  h.session.setFault((request) =>
    request.requestId.endsWith(":result") ? { kind: "disk_full" } : undefined,
  );
  const first = await h.runtime.tools.executeForPlugin(callOf(h, { requestId: "unknown" }));
  expect(first).toMatchObject({ ok: false, error: { kind: "storage" } });
  h.session.setFault(undefined);
  const second = await h.runtime.tools.executeForPlugin(callOf(h, { requestId: "unknown" }));
  expect(second).toMatchObject({ ok: false, error: { kind: "unknown_outcome" } });
  expect(probe.calls).toHaveLength(1);
});

test("an approval inherited from the parent call skips the card; an unknown approval id does not (U-11)", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  // 바깥 도구 호출(bash)이 사용자 승인을 받는다
  const parent = callTool(h.runtime.tools, h.run(), {
    id: "parent-1",
    name: "bash",
    args: { command: "echo parent" },
  });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [parentRequest] = h.runtime.approvals.pending(h.thread);
  const approvalId = parentRequest?.approvalId ?? "";
  await h.runtime.approvals.respond(approvalId, { decision: "allow" });
  expect(await parent).toMatchObject({ isError: false });

  // 같은 대화, 같은 바깥 호출, 위험 등급이 같은 자식 호출은 카드를 다시 띄우지 않는다
  const inherited = await h.runtime.tools.executeForPlugin(
    callOf(h, {
      target: { kind: "tool", name: "bash" },
      input: { command: "echo child" },
      requestId: "inherit-ok",
      parentToolCallId: "parent-1",
      inheritApproval: { approvalId, risk: "exec" },
    }),
  );
  expect(inherited).toMatchObject({ ok: true, value: { isError: false } });
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
  expect(probe.calls).toHaveLength(2);

  // 기록에 없는 승인 id는 물려받지 못한다: 보통의 카드가 뜬다
  const forged = h.runtime.tools.executeForPlugin(
    callOf(h, {
      target: { kind: "tool", name: "bash" },
      input: { command: "echo forged" },
      requestId: "inherit-forged",
      parentToolCallId: "parent-1",
      inheritApproval: { approvalId: "evt_forged", risk: "exec" },
    }),
  );
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [card] = h.runtime.approvals.pending(h.thread);
  expect(card?.origin.caller).toBe("plugin:p1");
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  expect(await forged).toMatchObject({ ok: true });
  expect(probe.calls).toHaveLength(3);
});

test("a plugin's pending approval is read back after a restart with caller plugin:p1", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const pending = h.runtime.tools.executeForPlugin(
    callOf(h, {
      target: { kind: "tool", name: "bash" },
      input: { command: "echo restart" },
      requestId: "restore-1",
    }),
  );
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const restarted = createToolRuntime(h.deps);
  const restored = await restarted.approvals.restore(h.thread);
  expect(restored).toMatchObject({ ok: true, value: [{ origin: { caller: "plugin:p1" } }] });
  // 정리: 원래 서비스에서 대기 중인 카드를 거부해 호출을 끝낸다
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "deny" });
  expect(await pending).toMatchObject({ ok: false, error: { kind: "denied" } });
});

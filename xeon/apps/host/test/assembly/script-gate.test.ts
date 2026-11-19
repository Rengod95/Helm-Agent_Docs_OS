import { expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  ScriptCard,
  ScriptDraftCall,
  ScriptRunFailure,
  ScriptRunResult,
  ToolsPort,
} from "@fresnel/contracts/extensions";
import type { PluginCallRequest, ToolError, ToolResultView } from "@fresnel/contracts/services";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createScriptDraftGate } from "../../src/assembly/plugins/script-gate.ts";
import type { FixedDraftMark } from "../../src/assembly/m4/plugin-set.ts";

// 초안 스크립트의 승인 문(AGE-58 [제안], L4.host-service.spec §4.27). 도구 서비스는 대역이다: 카드를 열고 승인/거절을 흉내 낸다.

const TEST_THREAD: ThreadId = fixedIdFactory(41).next("thr");
const OTHER_THREAD: ThreadId = fixedIdFactory(42).next("thr");

const CARD: ScriptCard = {
  command: "/bin/sh",
  args: ["/draft/tree/check.sh"],
  envNames: ["MARKER"],
  stdinBytes: 3,
  stdinPreview: "abc",
};

const RESULT: ScriptRunResult = {
  exitCode: 2,
  signal: null,
  stdout: "out",
  stdoutTruncated: false,
  stderr: "err",
  stderrTruncated: false,
  timedOut: false,
};

function mark(plugin: string): FixedDraftMark {
  return { plugin, draftId: "d-1", contentHash: "h", replaces: plugin };
}

/** 도구 서비스 대역. 받은 요청을 기록하고 `answer`가 정한 대로 승인(`run` 호출)하거나 거절한다 */
function fakeTools(answer: "allow" | { readonly deny: ToolError }): {
  tools: ToolsPort;
  requests: PluginCallRequest[];
} {
  const requests: PluginCallRequest[] = [];
  const tools: ToolsPort = {
    register: () => err({ kind: "name_conflict", toolName: "unused" }),
    toolMappedFor: () => false,
    async executeForPlugin(request) {
      requests.push(request);
      if (answer !== "allow") return err(answer.deny);
      if (request.target.kind !== "script") throw new Error("the gate sends script calls only");
      const done = await request.target.run(new AbortController().signal);
      const view: ToolResultView = {
        content: "",
        structuredContent: done.value,
        isError: !done.ok,
        details: null,
      };
      return ok(view);
    },
  };
  return { tools, requests };
}

function callOf(
  thread: ThreadId,
  run: ScriptDraftCall["run"],
  extension = "draft-ext",
): ScriptDraftCall {
  return {
    extension,
    registration: "reg-1",
    threadId: thread,
    name: "check",
    card: CARD,
    run,
  };
}

function gateOf(
  tools: ToolsPort | undefined,
  marks: ReadonlyMap<ThreadId, readonly FixedDraftMark[]>,
): ReturnType<typeof createScriptDraftGate> {
  let n = 0;
  return createScriptDraftGate({
    tools: () => tools,
    testRunDraftsOf: (threadId) => marks.get(threadId),
    newRequestId: () => `req-${(n += 1)}`,
  });
}

test("a test-run thread with the draft bound opens the card through the tools port with the card values and a fresh request id, and returns the script result after the allow", async () => {
  const { tools, requests } = fakeTools("allow");
  let runs = 0;
  const gate = gateOf(tools, new Map([[TEST_THREAD, [mark("draft-ext")]]]));
  const outcome = await gate(
    callOf(TEST_THREAD, () => {
      runs += 1;
      return Promise.resolve(ok(RESULT));
    }),
  );
  expect(outcome).toEqual(ok(RESULT));
  expect(runs).toBe(1);
  expect(requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    threadId: TEST_THREAD,
    plugin: { name: "draft-ext", scopeId: "reg-1" },
    via: "method",
    target: { kind: "script", name: "check" },
    input: {
      command: "/bin/sh",
      args: ["/draft/tree/check.sh"],
      envNames: ["MARKER"],
      stdinBytes: 3,
      stdinPreview: "abc",
    },
    requestId: "req-1",
  });
  // 승인 상속은 싣지 않는다
  expect(requests[0]?.inheritApproval).toBeUndefined();
});

test("each call gets its own request id, so a second call opens its own card", async () => {
  const { tools, requests } = fakeTools("allow");
  const gate = gateOf(tools, new Map([[TEST_THREAD, [mark("draft-ext")]]]));
  await gate(callOf(TEST_THREAD, () => Promise.resolve(ok(RESULT))));
  await gate(callOf(TEST_THREAD, () => Promise.resolve(ok(RESULT))));
  expect(requests.map((request) => request.requestId)).toEqual(["req-1", "req-2"]);
});

test("a general chat (no bound drafts) is refused as script_not_approved and no card opens", async () => {
  const { tools, requests } = fakeTools("allow");
  let runs = 0;
  const outcome = await gateOf(
    tools,
    new Map(),
  )(
    callOf(OTHER_THREAD, () => {
      runs += 1;
      return Promise.resolve(ok(RESULT));
    }),
  );
  expect(outcome).toEqual(err({ kind: "script_not_approved" }));
  expect(runs).toBe(0);
  expect(requests).toEqual([]);
});

test("a test run whose bound drafts do not include this plugin is refused as script_not_approved", async () => {
  const { tools, requests } = fakeTools("allow");
  const outcome = await gateOf(
    tools,
    new Map([[TEST_THREAD, [mark("another-draft")]]]),
  )(callOf(TEST_THREAD, () => Promise.resolve(ok(RESULT))));
  expect(outcome).toEqual(err({ kind: "script_not_approved" }));
  expect(requests).toEqual([]);
});

test("a declined card, a policy denial and a blocking hook come back as script_denied and the script never runs", async () => {
  const cases: readonly ToolError[] = [
    { kind: "denied", message: "no", resolvedBy: "human" },
    { kind: "denied", message: "no", resolvedBy: "policy" },
    { kind: "blocked", message: "hook" },
  ];
  let runs = 0;
  const outcomes: Result<ScriptRunResult, ScriptRunFailure>[] = await Promise.all(
    cases.map((deny) =>
      gateOf(
        fakeTools({ deny }).tools,
        new Map([[TEST_THREAD, [mark("draft-ext")]]]),
      )(
        callOf(TEST_THREAD, async () => {
          runs += 1;
          return ok(RESULT);
        }),
      ),
    ),
  );
  expect(outcomes).toEqual([
    err({ kind: "script_denied", cause: "denied", resolvedBy: "human" }),
    err({ kind: "script_denied", cause: "denied", resolvedBy: "policy" }),
    err({ kind: "script_denied", cause: "blocked" }),
  ]);
  expect(runs).toBe(0);
});

test("a run that fails after the allow (the isolation could not start it) comes back as that failure", async () => {
  const { tools } = fakeTools("allow");
  const failure: ScriptRunFailure = { kind: "sandbox_unavailable", reason: "x" };
  const outcome = await gateOf(
    tools,
    new Map([[TEST_THREAD, [mark("draft-ext")]]]),
  )(callOf(TEST_THREAD, () => Promise.resolve(err(failure))));
  expect(outcome).toEqual(err(failure));
});

test("with no tools service the card cannot open: script_denied and the script never runs", async () => {
  let runs = 0;
  const outcome = await gateOf(
    undefined,
    new Map([[TEST_THREAD, [mark("draft-ext")]]]),
  )(
    callOf(TEST_THREAD, () => {
      runs += 1;
      return Promise.resolve(ok(RESULT));
    }),
  );
  expect(outcome).toEqual(err({ kind: "script_denied", cause: "unavailable" }));
  expect(runs).toBe(0);
});

test("an allow with no recorded run (a replayed record) does not count as run", async () => {
  const tools: ToolsPort = {
    register: () => {
      throw new Error("not used");
    },
    toolMappedFor: () => false,
    executeForPlugin: () =>
      Promise.resolve(ok({ content: "", structuredContent: null, isError: false, details: null })),
  };
  const outcome = await gateOf(
    tools,
    new Map([[TEST_THREAD, [mark("draft-ext")]]]),
  )(callOf(TEST_THREAD, () => Promise.resolve(ok(RESULT))));
  expect(outcome).toEqual(err({ kind: "script_denied", cause: "unknown_outcome" }));
});

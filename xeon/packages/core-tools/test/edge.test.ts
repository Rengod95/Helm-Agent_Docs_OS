import { expect, test } from "bun:test";
import { err, ok, parse } from "@xeon/contracts";
import { BashToolParams } from "@xeon/contracts/capabilities";
import {
  COMMIT_KEY_PATTERN,
  EffectIntentSchema,
  commitKeyPart,
  requestKeyFor,
} from "@xeon/contracts/records";
import type { CommitRequest, CommitResult } from "@xeon/contracts/records";
import { sequentialIds } from "../src/testing/index.ts";
import { commitWithRetry, describeFailure } from "../src/commit.ts";
import { sha256HexSync } from "../src/util.ts";
import { requestCommitKey } from "../src/approvals/keys.ts";
import {
  ASSISTANT,
  callTool,
  createHarness,
  directTool,
  installHandlers,
  layer,
  registerWorkspace,
  textOf,
  until,
  expectOk,
} from "./support/harness.ts";

const ALLOW_BASH = layer("user", {
  "l1.tools.rules": [
    { id: "u.bash", action: "tool.call", resource: { tool: "bash" }, effect: "allow" },
  ],
});

function emptyRequest(): CommitRequest {
  return {
    threadId: sequentialIds().next("thr"),
    requestId: "k",
    fingerprintSource: null,
    build: () => ({ kind: "reject", code: "x", detail: null }),
  };
}

test("commitWithRetry retries busy with the same request and reports every failure kind as a value", () => {
  const seen: CommitRequest[] = [];
  const request = emptyRequest();
  const busy = commitWithRetry(
    {
      commit: (r) => {
        seen.push(r);
        return err({ kind: "busy" });
      },
    },
    request,
  );
  expect(busy.ok).toBe(false);
  expect(seen).toHaveLength(3);
  expect(seen.every((entry) => entry === request)).toBe(true);

  const results: CommitResult[] = [
    { status: "rejected", code: "turn_aborting", detail: null, replayed: false },
    { status: "key_reused", requestId: "k" },
  ];
  const described = results.map((result) => {
    const outcome = commitWithRetry({ commit: () => ok(result) }, request);
    return outcome.ok ? "ok" : describeFailure(outcome.failure);
  });
  expect(described).toEqual(["commit rejected: turn_aborting", "commit key reused: k"]);
  const disk = commitWithRetry({ commit: () => err({ kind: "disk_full" }) }, request);
  expect(disk.ok ? "ok" : describeFailure(disk.failure)).toBe("store error: disk_full");
});

test("tool call ids outside the commit key alphabet or too long are hashed deterministically", async () => {
  expect(commitKeyPart("call_1", sha256HexSync)).toBe("call_1");
  const odd = commitKeyPart("call|odd id/with space", sha256HexSync);
  expect(odd).toMatch(/^h_[0-9a-f]{40}$/);
  expect(commitKeyPart("call|odd id/with space", sha256HexSync)).toBe(odd);
  const long = "t".repeat(60);
  expect(requestKeyFor(long, sha256HexSync)).toBe(`h_${sha256HexSync(long).slice(0, 40)}`);
  expect(requestKeyFor("short", sha256HexSync)).toBe("short");
  const thread = "thr_00000000000000000000000001";
  expect(requestCommitKey(thread, "call_1")).toBe(`approval:${thread}:call_1:request`);
  const hashed = requestCommitKey(thread, "k".repeat(48));
  expect(hashed).toMatch(/^approval:[0-9a-f]{32}:request$/);
  expect(hashed.length).toBeLessThanOrEqual(64);

  // 승인 요청의 키도 같은 변환을 거친다. toolCallId가 알파벳 밖이어도 커밋 키 형식을 지킨다(U-13)
  const oddKey = requestKeyFor("call|odd id/with space", sha256HexSync);
  expect(oddKey).toBe(`h_${sha256HexSync("call|odd id/with space").slice(0, 40)}`);
  expect(requestKeyFor("call|odd id/with space", sha256HexSync)).toBe(oddKey);
  const oddCommit = requestCommitKey(thread, oddKey);
  expect(oddCommit).toMatch(new RegExp(COMMIT_KEY_PATTERN));
  // 64자를 넘는 키는 해시로 줄이므로 형식과 결정성만 본다
  expect(requestCommitKey(thread, oddKey)).toBe(oddCommit);
  // 호출자가 알파벳 밖 requestKey를 직접 넘겨도 커밋 키는 형식을 지킨다
  const direct = requestCommitKey(thread, "key with|bar");
  expect(direct).toMatch(new RegExp(COMMIT_KEY_PATTERN));
  expect(requestCommitKey(thread, "key with|bar")).toBe(direct);
  // 원문이 h_로 시작하면 해시 키와 겹치지 않게 다시 해시한다
  const reserved = `h_${"a".repeat(40)}`;
  expect(requestKeyFor(reserved, sha256HexSync)).toBe(`h_${sha256HexSync(reserved).slice(0, 40)}`);

  const h = await createHarness();
  registerWorkspace(h);
  await callTool(h.runtime.tools, h.run(), {
    id: "call|odd id",
    name: "read",
    args: { path: "a" },
  });
  expect(h.session.commits[0]?.requestId).toBe(
    `tool:${commitKeyPart("call|odd id", sha256HexSync)}:intent`,
  );
});

test("details and structuredContent over the event limit are replaced by their size in the record", async () => {
  const h = await createHarness();
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: directTool("fat", () =>
      Promise.resolve({
        content: [{ type: "text", text: "ok" }],
        details: { blob: "x".repeat(200_000) },
        structuredContent: { rows: "y".repeat(200_000) },
      }),
    ),
    policy: { risk: "read" },
  });
  const out = await callTool(h.runtime.tools, h.run(), { id: "call_1", name: "fat", args: {} });
  expect(out.isError).toBe(false);
  const text = JSON.stringify(h.session.events);
  expect(text).toContain("xeonOversize");
  expect(text.length).toBeLessThan(10_000);
});

test("a direct tool whose structuredContent violates its outputSchema becomes an internal error result", async () => {
  const h = await createHarness();
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: {
      ...directTool("typed", () =>
        Promise.resolve({
          content: [{ type: "text", text: "ok" }],
          details: null,
          structuredContent: { nope: 1 },
        }),
      ),
      outputSchema: BashToolParams,
    },
    policy: { risk: "read" },
  });
  const out = await callTool(h.runtime.tools, h.run(), { id: "call_2", name: "typed", args: {} });
  expect(out.isError).toBe(true);
  expect(textOf(out.result)).toContain("[internal] structuredContent violates the output schema");
});

test("arguments over 256 KiB go to a blob in the intent and a rerun reads them back", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  const seen: string[] = [];
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: {
      ...directTool("bash", (_id, params) => {
        const command: unknown =
          typeof params === "object" && params !== null && "command" in params
            ? params.command
            : "";
        seen.push(typeof command === "string" ? command : "");
        return Promise.resolve({ content: [{ type: "text", text: "ran" }], details: null });
      }),
      replay: "safe",
    },
    policy: { risk: "exec" },
  });
  const big = "z".repeat(300_000);
  const run = h.run();
  const prepared = await h.runtime.tools.prepare(
    { type: "toolCall", id: "call_3", name: "bash", arguments: { command: big } },
    ASSISTANT,
    run,
  );
  expect(prepared.kind).toBe("ready");
  const intent = parse(EffectIntentSchema, h.session.events[0]?.payload);
  expect(intent.ok).toBe(true);
  if (!intent.ok) return;
  expect(intent.value.args).toMatchObject({
    type: "blob",
    size: 300_000 + '{"command":""}'.length,
  });
  const record = expectOk(await h.runtime.tools.rerun(intent.value, run));
  expect(record.isError).toBe(false);
  expect(seen).toEqual([big]);
});

test("an executed call releases its tool node", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const run = h.run();
  const prepared = await h.runtime.tools.prepare(
    { type: "toolCall", id: "call_4", name: "read", arguments: { path: "a" } },
    ASSISTANT,
    run,
  );
  expect(prepared.kind).toBe("ready");
  if (prepared.kind !== "ready") return;
  const node = () => h.tasks.scopes.find((scope) => scope.kind === "tool");
  const outcome = await h.runtime.tools.execute(prepared.call, () => {}, run);
  expect(outcome.state).toBe("executed");
  expect(node()).toBeDefined();
  let settled = false;
  const watching = node()
    ?.settle()
    .then(() => {
      settled = true;
      return settled;
    });
  await until(() => settled);
  await watching;
  expect(settled).toBe(true);
});

test("a tool_call decision with terminate stops the batch", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  await installHandlers(h, "stopper", ["tool_call"], (g) => {
    g.on("tool_call", () => ({ block: true, reason: "stop here", terminate: true }));
  });
  const run = h.run();
  const prepared = await h.runtime.tools.prepare(
    { type: "toolCall", id: "call_5", name: "read", arguments: { path: "a" } },
    ASSISTANT,
    run,
  );
  expect(prepared.kind).toBe("settled");
  if (prepared.kind !== "settled") return;
  expect(textOf(prepared.outcome.result)).toBe("[xeon:denied_by_extension] stop here");
  expect(prepared.outcome.result.terminate).toBe(true);
  expect(prepared.outcome.state).toBe("rejected");
});

test("an unregistered tool and invalid arguments are settled by prepare with a result item", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const run = h.run();
  const missing = await h.runtime.tools.prepare(
    { type: "toolCall", id: "c", name: "nope", arguments: {} },
    ASSISTANT,
    run,
  );
  expect(missing.kind === "settled" ? textOf(missing.outcome.result) : "").toContain(
    "tool_unavailable",
  );
  const invalid = await h.runtime.tools.prepare(
    { type: "toolCall", id: "c2", name: "read", arguments: {} },
    ASSISTANT,
    run,
  );
  expect(invalid.kind === "settled" ? textOf(invalid.outcome.result) : "").toContain(
    "Validation failed",
  );
  const broken = await h.runtime.tools.prepare(
    {
      type: "toolCall",
      id: "c3",
      name: "read",
      arguments: {},
      argumentsError: "Unexpected end of JSON input",
    },
    ASSISTANT,
    run,
  );
  expect(broken.kind === "settled" ? textOf(broken.outcome.result) : "").toContain(
    "Invalid arguments",
  );
  // 효과가 없는 호출은 intent 없이 toolResult item만 기록한다
  expect(h.session.events.map((event) => event.kind)).toEqual([
    "item.recorded",
    "item.recorded",
    "item.recorded",
  ]);
  expect(h.session.commits.map((commit) => commit.requestId)).toEqual([
    "tool:c:result",
    "tool:c2:result",
    "tool:c3:result",
  ]);
});

test("a failed approval.requested commit blocks the call with commit_failed and runs nothing", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  h.session.setFault((request) =>
    request.requestId.startsWith("approval:") ? { kind: "disk_full" } : undefined,
  );
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_6",
    name: "bash",
    args: { command: "ls" },
  });
  expect(out.blocked).toContain("tools.commit_failed");
  expect(probe.calls).toEqual([]);
  expect(h.session.events.map((event) => event.kind)).toEqual(["item.recorded"]);
});

import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { EffectResultSchema, SecretMaskedPayloadSchema } from "@xeon/contracts/records";
import { callTool, createHarness, directTool, installHandlers, textOf } from "./support/harness.ts";

const SECRET = "sk-live-0123456789abcdef";

function everything(h: Awaited<ReturnType<typeof createHarness>>): string {
  return JSON.stringify(h.session.events);
}

test("tool_result_masked_before_commit_and_points: the value reaches no event, blob, handler payload or model result", async () => {
  const h = await createHarness({ secrets: { API: SECRET } });
  const seenByHandler: string[] = [];
  await installHandlers(h, "result-watch", ["tool.result"], (g) => {
    g.on("tool.result", (_payload, current) => {
      seenByHandler.push(JSON.stringify(current));
      return undefined;
    });
  });
  const long = `key=${SECRET}\n`.repeat(2500);
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: directTool("leaky", () =>
      Promise.resolve({
        content: [{ type: "text", text: long }],
        details: { echoed: SECRET, nested: [{ token: SECRET }] },
        structuredContent: { value: SECRET },
      }),
    ),
    policy: { risk: "read" },
  });
  const out = await callTool(h.runtime.tools, h.run(), { id: "call_1", name: "leaky", args: {} });

  expect(JSON.stringify(out.result)).not.toContain(SECRET);
  expect(textOf(out.result)).toContain("[REDACTED:API]");
  expect(everything(h)).not.toContain(SECRET);
  expect(seenByHandler).toHaveLength(1);
  expect(seenByHandler[0]).not.toContain(SECRET);
  // 큰 출력은 blob으로 넘어갔고 blob 원문에도 값이 없다
  expect(h.store.size()).toBe(1);
  const stored = parse(
    EffectResultSchema,
    h.session.events.find((event) => event.kind === "effect.result")?.payload,
  );
  expect(stored.ok).toBe(true);
  if (!stored.ok || stored.value.blobRef === null) throw new Error("expected a blob");
  const read = h.store.readBlob(stored.value.blobRef);
  expect(read.ok).toBe(true);
  if (read.ok) expect(new TextDecoder().decode(read.value)).not.toContain(SECRET);

  const masked = h.session.events.filter((event) => event.kind === "secret.masked");
  expect(masked).toHaveLength(1);
  const payload = parse(SecretMaskedPayloadSchema, masked[0]?.payload);
  expect(payload.ok).toBe(true);
  if (!payload.ok) return;
  expect(payload.value.layer).toBe("tool-result");
  expect(payload.value.hits).toEqual([{ kind: "known:API", count: 2500 + 1 + 1 + 1 }]);
  // 같은 커밋(effect.result, item.recorded, secret.masked)이다
  const commit = h.session.commits.find((entry) => entry.requestId === "tool:call_1:result");
  expect(commit?.kinds).toEqual(["effect.result", "item.recorded", "secret.masked"]);
});

test("progress updates are masked before they reach the caller and the tap payloads", async () => {
  const h = await createHarness({ secrets: { API: SECRET } });
  const delivered: string[] = [];
  const tapped: string[] = [];
  await installHandlers(
    h,
    "update-watch",
    ["tool.execution.update", "tool.execution.after"],
    (g) => {
      g.on("tool.execution.update", (payload) => {
        tapped.push(JSON.stringify(payload));
      });
      g.on("tool.execution.after", (payload) => {
        tapped.push(JSON.stringify(payload));
      });
    },
  );
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: directTool("progress", (_id, _params, _signal, onUpdate) => {
      onUpdate({
        content: [{ type: "text", text: `partial ${SECRET}` }],
        details: { raw: SECRET },
      });
      return Promise.resolve({ content: [{ type: "text", text: "done" }], details: null });
    }),
    policy: { risk: "read" },
  });
  const run = h.run();
  await callTool(h.runtime.tools, run, { id: "call_2", name: "progress", args: {} }, (partial) => {
    delivered.push(JSON.stringify(partial));
  });
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).not.toContain(SECRET);
  expect(delivered[0]).toContain("[REDACTED:API]");

  expect(tapped).toHaveLength(2);
  for (const payload of tapped) expect(payload).not.toContain(SECRET);
  expect(tapped[0]).toContain("[REDACTED:API]");
});

test("error results are masked too", async () => {
  const h = await createHarness({ secrets: { API: SECRET } });
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: directTool("fails", () => Promise.reject(new Error(`bad token ${SECRET}`))),
    policy: { risk: "read" },
  });
  const out = await callTool(h.runtime.tools, h.run(), { id: "call_3", name: "fails", args: {} });
  expect(out.isError).toBe(true);
  expect(JSON.stringify(out.result)).not.toContain(SECRET);
  expect(everything(h)).not.toContain(SECRET);
});

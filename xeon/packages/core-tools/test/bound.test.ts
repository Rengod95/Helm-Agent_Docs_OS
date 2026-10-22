import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { EffectResultSchema } from "@xeon/contracts/records";
import { boundResult, selfBlobRef } from "../src/bound.ts";
import { createToolRuntime } from "../src/runtime.ts";
import { fakeStore, fakeTruncator } from "../src/testing/index.ts";
import type { OutputTruncator } from "../src/types.ts";
import {
  callTool,
  createHarness,
  directTool,
  layer,
  registerWorkspace,
  textOf,
} from "./support/harness.ts";

const ALLOW_BASH = layer("user", {
  "l1.tools.rules": [
    { id: "u.bash", action: "tool.call", resource: { tool: "bash" }, effect: "allow" },
  ],
});

function sixtyKilobytes(): string {
  return `${"a".repeat(99)}\n`.repeat(600);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

test("truncate_spills_full_output_to_blob: 60,000 bytes become one blob and a bounded preview", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  const probe = registerWorkspace(h);
  const full = sixtyKilobytes();
  expect(new TextEncoder().encode(full).length).toBe(60_000);
  probe.setShellOutput(full);
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_1",
    name: "bash",
    args: { command: "cat big" },
  });
  expect(h.store.size()).toBe(1);
  const result = parse(
    EffectResultSchema,
    h.session.events.find((event) => event.kind === "effect.result")?.payload,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // 원문은 모델에 간 결과 앞에 붙는 안내 줄 없이 도구가 낸 텍스트 그대로다
  expect(result.value.blobRef?.sha256).toBe(
    sha256(textOf({ content: [{ type: "text", text: full }], details: null })),
  );
  const content = out.result?.content ?? [];
  expect(content).toHaveLength(2);
  const [preview, notice] = content;
  expect(
    preview?.type === "text" && new TextEncoder().encode(preview.text).length,
  ).toBeLessThanOrEqual(51_200);
  expect(notice?.type === "text" && notice.text).toContain(
    "[xeon:output_truncated] Showing the first",
  );
  expect(notice?.type === "text" && notice.text).toContain(
    `blob sha256:${result.value.blobRef?.sha256}`,
  );
  expect(out.result?.details).toMatchObject({
    truncation: { totalBytes: 60_000, truncatedBy: "bytes" },
  });
  // toolResult item에도 같은 미리보기가 들어간다
  const item = h.session.events.find((event) => event.kind === "item.recorded");
  expect(JSON.stringify(item?.payload)).toContain("output_truncated");
});

test("bound_uses_exec_truncation: the injected truncation function decides the preview", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  const seen: { content: string; maxLines: number | undefined; maxBytes: number | undefined }[] =
    [];
  const spy: OutputTruncator = {
    truncateHead: (content, options) => {
      seen.push({ content, maxLines: options?.maxLines, maxBytes: options?.maxBytes });
      return {
        content: "PREVIEW",
        truncated: true,
        truncatedBy: "lines",
        totalLines: 4,
        totalBytes: 7,
        outputLines: 1,
        outputBytes: 7,
        lastLinePartial: false,
        firstLineExceedsLimit: false,
        maxLines: options?.maxLines ?? 2000,
        maxBytes: options?.maxBytes ?? 51_200,
      };
    },
    formatSize: (bytes) => `${bytes}-bytes`,
  };
  const runtime = createToolRuntime({ ...h.deps, truncator: spy });
  const own = registerWorkspace({ ...h, runtime });
  own.setShellOutput("a\nb\nc\nd");
  const out = await callTool(runtime.tools, h.run(), {
    id: "call_2",
    name: "bash",
    args: { command: "x" },
  });
  expect(seen).toEqual([{ content: "a\nb\nc\nd", maxLines: 2000, maxBytes: 51_200 }]);
  expect(out.result?.content[0]).toEqual({ type: "text", text: "PREVIEW" });
  expect(textOf(out.result)).toContain("Showing the first 1 of 4 lines (7-bytes of 7-bytes)");
});

test("a text below the limits is left alone and stores no blob", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  const probe = registerWorkspace(h);
  probe.setShellOutput("short");
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_3",
    name: "bash",
    args: { command: "echo" },
  });
  expect(textOf(out.result)).toContain("short");
  expect(h.store.size()).toBe(0);
  const result = parse(
    EffectResultSchema,
    h.session.events.find((event) => event.kind === "effect.result")?.payload,
  );
  expect(result.ok && result.value.blobRef).toBeNull();
});

test("limits come from settings and per-tool limits override them", async () => {
  const h = await createHarness({
    layers: [
      layer("user", {
        "l1.tools.rules": [
          { id: "u.bash", action: "tool.call", resource: { tool: "bash" }, effect: "allow" },
        ],
        "l1.tools.output.maxBytes": 2048,
      }),
    ],
  });
  const probe = registerWorkspace(h);
  probe.setShellOutput("abcdefghi\n".repeat(300));
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_4",
    name: "bash",
    args: { command: "x" },
  });
  expect(out.result?.details).toMatchObject({ truncation: { truncatedBy: "bytes" } });
  const first = out.result?.content[0];
  expect(first?.type === "text" && new TextEncoder().encode(first.text).length).toBeLessThanOrEqual(
    2048,
  );

  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: directTool("lines", () =>
      Promise.resolve({
        content: [{ type: "text", text: Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n") }],
        details: null,
      }),
    ),
    policy: { risk: "read" },
    outputLimits: { maxLines: 10 },
  });
  const limited = await callTool(h.runtime.tools, h.run(), {
    id: "call_5",
    name: "lines",
    args: {},
  });
  expect(limited.result?.details).toMatchObject({
    truncation: { outputLines: 10, totalLines: 50 },
  });
  expect(h.runtime.tools.meta("lines")?.outputLimits).toEqual({ maxLines: 10, maxBytes: 2048 });
});

test("self_bounded_tool_skips_bounding: details.blobRef moves to effect.result.blobRef", async () => {
  const h = await createHarness();
  const blob = h.store.putBlob(new TextEncoder().encode("whole output"), "text/plain");
  expect(blob.ok).toBe(true);
  if (!blob.ok) return;
  const huge = "x\n".repeat(100_000);
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: directTool("selfy", () =>
      Promise.resolve({
        content: [{ type: "text", text: huge }],
        details: { blobRef: blob.value },
      }),
    ),
    policy: { risk: "read" },
    outputLimits: "self",
  });
  const before = h.store.size();
  const out = await callTool(h.runtime.tools, h.run(), { id: "call_6", name: "selfy", args: {} });
  expect(h.store.size()).toBe(before);
  expect(textOf(out.result)).toBe(huge);
  const result = parse(
    EffectResultSchema,
    h.session.events.find((event) => event.kind === "effect.result")?.payload,
  );
  expect(result.ok && result.value.blobRef).toEqual(blob.value);
  expect(h.runtime.tools.meta("selfy")?.outputLimits).toBe("self");
});

test("a failed blob write keeps the preview, drops the original and says so", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  const probe = registerWorkspace(h);
  probe.setShellOutput(sixtyKilobytes());
  h.store.failPut({ kind: "disk_full" });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_7",
    name: "bash",
    args: { command: "cat big" },
  });
  expect(textOf(out.result)).toContain("The full output was not stored.");
  expect(out.result?.details).toMatchObject({ truncation: { blobError: "disk_full" } });
  const result = parse(
    EffectResultSchema,
    h.session.events.find((event) => event.kind === "effect.result")?.payload,
  );
  expect(result.ok && result.value.blobRef).toBeNull();
});

test("image parts are kept and only text parts are bounded", () => {
  const store = fakeStore();
  const bounded = boundResult(
    { truncator: fakeTruncator(), store },
    {
      content: [
        { type: "image", data: "AAAA", mimeType: "image/png" },
        { type: "text", text: "line\n".repeat(5000) },
      ],
      details: null,
    },
    { maxLines: 100, maxBytes: 51_200 },
  );
  expect(bounded.bounded.truncated).toBe(true);
  expect(bounded.bounded.content.map((part) => part.type)).toEqual(["text", "text", "image"]);
  expect(selfBlobRef({ content: [], details: { blobRef: "nope" } })).toBeNull();
  expect(selfBlobRef({ content: [], details: null })).toBeNull();
});

test("a text over 50 MiB keeps only the head and tail in the blob", () => {
  const store = fakeStore();
  const big = `${"a".repeat(30 * 1024 * 1024)}${"b".repeat(30 * 1024 * 1024)}`;
  const bounded = boundResult(
    { truncator: fakeTruncator(), store },
    { content: [{ type: "text", text: big }], details: null },
    { maxLines: 100, maxBytes: 1024 },
  );
  const ref = bounded.bounded.blobRef;
  expect(ref).not.toBeNull();
  if (ref === null) return;
  expect(ref.size).toBeLessThan(big.length);
  const read = store.readBlob(ref);
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  const text = new TextDecoder().decode(read.value);
  expect(text).toContain("[xeon:omitted");
  expect(text.startsWith("aaa")).toBe(true);
  expect(text.endsWith("bbb")).toBe(true);
});

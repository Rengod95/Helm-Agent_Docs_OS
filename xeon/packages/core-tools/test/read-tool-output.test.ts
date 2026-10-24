import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { EffectResultSchema } from "@xeon/contracts/records";
import {
  callTool,
  createHarness,
  layer,
  registerWorkspace,
  textOf,
  type Harness,
} from "./support/harness.ts";

// L1A.5: 내장 도구 read_tool_output(TL-11). 한도를 넘어 blob으로 옮긴 도구 출력 원문을 줄 단위로 다시 읽는다.

const ALLOW_BASH = layer("user", {
  "l1.tools.rules": [
    { id: "u.bash", action: "tool.call", resource: { tool: "bash" }, effect: "allow" },
  ],
});

/** 줄 번호가 든 600줄(60,000바이트) 출력을 낸 bash 호출 하나를 기록하고 원문의 sha256을 돌려준다 */
async function bigOutput(h: Harness): Promise<{ sha: string; full: string }> {
  const probe = registerWorkspace(h);
  const full = Array.from(
    { length: 600 },
    (_, i) => `line ${String(i + 1).padStart(3, "0")} ${"x".repeat(90)}`,
  ).join("\n");
  probe.setShellOutput(full);
  await callTool(h.runtime.tools, h.run(), {
    id: "big_1",
    name: "bash",
    args: { command: "cat big" },
  });
  const stored = parse(
    EffectResultSchema,
    h.session.events.find((event) => event.kind === "effect.result")?.payload,
  );
  const sha = stored.ok ? (stored.value.blobRef?.sha256 ?? "") : "";
  expect(sha).toMatch(/^[0-9a-f]{64}$/);
  expect(createHash("sha256").update(full).digest("hex")).toBe(sha);
  return { sha, full };
}

test("read_tool_output_pages_blob: offset and limit return that line range of the stored original", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  const { sha } = await bigOutput(h);
  const page = await callTool(h.runtime.tools, h.run(), {
    id: "read_1",
    name: "read_tool_output",
    args: { sha256: sha, offset: 101, limit: 3 },
  });
  expect(page.blocked).toBeUndefined();
  const text = textOf(page.result);
  expect(text.split("\n")[0]).toBe(
    `[xeon:output_page] Lines 101-103 of 600 of blob sha256:${sha}. Use offset 104 to continue.`,
  );
  expect(text).toContain("line 101 ");
  expect(text).toContain("line 103 ");
  expect(text).not.toContain("line 100 ");
  expect(text).not.toContain("line 104 ");

  // 마지막 쪽에는 이어 읽으라는 안내가 없다
  const last = await callTool(h.runtime.tools, h.run(), {
    id: "read_2",
    name: "read_tool_output",
    args: { sha256: sha, offset: 599, limit: 10 },
  });
  expect(textOf(last.result).split("\n")[0]).toBe(
    `[xeon:output_page] Lines 599-600 of 600 of blob sha256:${sha}.`,
  );
});

test("read_tool_output is a read-risk call: no approval, three-step effect, and the default window follows the output limit", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  const { sha } = await bigOutput(h);
  const before = h.session.commits.length;
  const page = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "read_3",
    name: "read_tool_output",
    args: { sha256: sha },
  });
  expect(page.blocked).toBeUndefined();
  expect(h.session.commits.slice(before).map((commit) => commit.requestId)).toEqual([
    "tool:read_3:intent",
    "tool:read_3:exec",
    "tool:read_3:result",
  ]);
  // 기본 창은 l1.tools.output.maxLines(2000)줄이고 600줄 전체지만, 결과 자체도 경계화 한도(51,200바이트)를 받는다
  expect(textOf(page.result)).toContain("Lines 1-600 of 600");
  expect(h.store.size()).toBe(2);
});

test("an unknown hash, a malformed hash, an offset past the end and an unrelated blob are error results", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  const { sha } = await bigOutput(h);
  const unknown = await callTool(h.runtime.tools, h.run(), {
    id: "read_4",
    name: "read_tool_output",
    args: { sha256: "0".repeat(64) },
  });
  expect(textOf(unknown.result)).toContain("output_not_found");
  expect(unknown.isError).toBe(true);
  const malformed = await callTool(h.runtime.tools, h.run(), {
    id: "read_5",
    name: "read_tool_output",
    args: { sha256: "abc" },
  });
  expect(malformed.blocked).toBeDefined();
  const past = await callTool(h.runtime.tools, h.run(), {
    id: "read_6",
    name: "read_tool_output",
    args: { sha256: sha, offset: 601 },
  });
  expect(textOf(past.result)).toContain("past the last line");
  // 저장소에 있어도 이 대화의 도구 출력이 아닌 blob(예: 다른 곳에서 쓴 것)은 읽지 않는다
  const stray = h.store.putBlob(new TextEncoder().encode("not a tool output"), "text/plain");
  const strayHash = stray.ok ? stray.value.sha256 : "";
  const refused = await callTool(h.runtime.tools, h.run(), {
    id: "read_7",
    name: "read_tool_output",
    args: { sha256: strayHash },
  });
  expect(textOf(refused.result)).toContain("output_not_found");
});

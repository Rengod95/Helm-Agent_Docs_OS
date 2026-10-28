import { describe, expect, test } from "bun:test";
import type { SystemMessage } from "@xeon/contracts/conversation";
import { decideToolChange } from "../src/toolset-diff.ts";
import {
  assembleOptions,
  cachePolicy,
  grepTool,
  noMidConversation,
  sortedTools,
} from "./support/builders.ts";
import { harness } from "./support/harness.ts";
import { buildChat } from "./support/scenario.ts";
import { present, valueOf } from "./support/result.ts";

function advertised(names: readonly string[]): SystemMessage["toolsAdded"] {
  return sortedTools
    .filter((tool) => names.includes(tool.name))
    .map((tool) => ({ name: tool.name, description: tool.wire.description, parameters: {} }));
}

describe("decideToolChange (unit)", () => {
  test("no difference means no decision", () => {
    // 광고 목록은 접두에 평범한 JSON 스키마로 남으므로 parameters 모양이 같은 도구끼리 비교한다
    const same = decideToolChange({
      advertised: sortedTools.map((tool) => ({
        name: tool.name,
        description: tool.wire.description,
        parameters: JSON.parse(JSON.stringify(tool.wire.parameters)),
      })),
      next: sortedTools,
      policy: cachePolicy,
      timestamp: 9,
    });
    expect(same.decision).toBeNull();
    expect(same.pending).toBeNull();
    expect(same.warnings).toEqual([]);
  });

  test("tool_added_midconversation_keeps_prefix: a supported model gets one append message with only the diff", () => {
    const change = decideToolChange({
      advertised: sortedTools.slice(0, 2).map((tool) => ({
        name: tool.name,
        description: tool.wire.description,
        parameters: JSON.parse(JSON.stringify(tool.wire.parameters)),
      })),
      next: sortedTools,
      policy: cachePolicy,
      timestamp: 9,
    });
    expect(change.decision).toEqual({ action: "append", added: 1, removed: 0 });
    expect(change.pending?.purpose).toBe("tool_change");
    expect(change.message?.toolsAdded?.map((tool) => tool.name)).toEqual(["read"]);
    expect(change.message?.toolsRemoved).toEqual([]);
    expect(change.message?.timestamp).toBe(9);
  });

  test("tool_change_deferred_without_provider_support: defer, warn, leave the advertised list alone", () => {
    const change = decideToolChange({
      advertised: advertised(["bash", "ls"]),
      next: [...sortedTools, grepTool],
      policy: noMidConversation,
      timestamp: 9,
    });
    expect(change.decision?.action).toBe("defer");
    expect(change.pending).toBeNull();
    expect(change.message).toBeNull();
    expect(change.warnings).toEqual([
      { code: "tools_deferred", added: expect.any(Array), removed: [] },
    ]);
  });
});

describe("assemble tool changes", () => {
  test("a tool added after the prefix keeps messages[0] and adds one system message with only that tool", async () => {
    const h = await harness();
    await buildChat(h, 2);
    const base = valueOf(
      await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
    );
    const grown = valueOf(
      await h.service.assemble(
        h.log.threadId,
        h.log.leaf(),
        assembleOptions(h.log.ids, { tools: [...sortedTools, grepTool] }),
      ),
    );
    expect(JSON.stringify(grown.messages[0])).toBe(JSON.stringify(base.messages[0]));
    expect(grown.toolChange).toEqual({ action: "append", added: 1, removed: 0 });
    expect(grown.pendingItems.map((item) => item.purpose)).toEqual(["tool_change"]);
    const last = present(grown.messages.at(-1));
    expect(last.role).toBe("system");
    expect(last.role === "system" && last.toolsAdded?.map((tool) => tool.name)).toEqual(["grep"]);
    expect(grown.messages.length).toBe(base.messages.length + 1);
    expect(grown.prefix.prefixHash).toBe(base.prefix.prefixHash);
  });

  test("a removed tool is announced the same way", async () => {
    const h = await harness();
    await buildChat(h, 2);
    const shrunk = valueOf(
      await h.service.assemble(
        h.log.threadId,
        h.log.leaf(),
        assembleOptions(h.log.ids, { tools: sortedTools.slice(0, 2) }),
      ),
    );
    expect(shrunk.toolChange).toEqual({ action: "append", added: 0, removed: 1 });
    const last = present(shrunk.messages.at(-1));
    expect(last.role === "system" && last.toolsRemoved?.map((tool) => tool.name)).toEqual(["read"]);
  });

  test("without provider support the change is deferred with a warning and the prefix stays", async () => {
    const h = await harness();
    await buildChat(h, 2);
    const base = valueOf(
      await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
    );
    const deferred = valueOf(
      await h.service.assemble(
        h.log.threadId,
        h.log.leaf(),
        assembleOptions(h.log.ids, {
          tools: [...sortedTools, grepTool],
          cachePolicy: noMidConversation,
        }),
      ),
    );
    expect(deferred.toolChange?.action).toBe("defer");
    expect(deferred.pendingItems).toHaveLength(0);
    expect(deferred.warnings).toContainEqual({
      code: "tools_deferred",
      added: ["grep"],
      removed: [],
    });
    expect(deferred.messages.length).toBe(base.messages.length);
  });

  test("once the change item is recorded the next assembly sees no difference", async () => {
    const h = await harness();
    await buildChat(h, 2);
    const options = assembleOptions(h.log.ids, { tools: [...sortedTools, grepTool] });
    const grown = valueOf(await h.service.assemble(h.log.threadId, h.log.leaf(), options));
    const pending = present(grown.pendingItems[0]);
    h.log.append("item.recorded", {
      item: {
        itemId: h.log.ids.next("itm"),
        status: "completed",
        kind: "system",
        message: pending.message,
      },
    });
    const again = valueOf(await h.service.assemble(h.log.threadId, h.log.leaf(), options));
    expect(again.toolChange).toBeNull();
    expect(again.pendingItems).toHaveLength(0);
  });
});

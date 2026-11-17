import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { InstructionSectionsRead } from "../src/types.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";
import { createHarness } from "./support/harness.ts";

// M5c §4.4.7, L1.context §4.2. 지침 절은 턴 시작에 한 번 읽고, 그 turn의 모든 요청에 `sections`로 든다.
// 원천이 없으면 절은 `{}`다. 건너뛴 파일의 진단은 경고로 남고 턴은 계속한다.

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

function countingSource(result: InstructionSectionsRead): {
  readonly calls: ThreadId[];
  readonly instructionSectionsOf: (threadId: ThreadId) => Promise<InstructionSectionsRead>;
} {
  const calls: ThreadId[] = [];
  return {
    calls,
    instructionSectionsOf: async (threadId) => {
      calls.push(threadId);
      return result;
    },
  };
}

test("the turn-start instruction sections reach every request of the turn and are read once", async () => {
  const source = countingSource({ sections: { "project:.": "RULES" }, diagnostics: [] });
  const h = await createHarness({
    script: [read, done],
    instructionSectionsOf: source.instructionSectionsOf,
  });

  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();

  expect(h.context.assembled.map((request) => request.sections)).toEqual([
    { "project:.": "RULES" },
    { "project:.": "RULES" },
  ]);
  expect(source.calls).toEqual([h.threadId]);
});

test("without an instruction source the requests carry no sections", async () => {
  const h = await createHarness({ script: [done] });

  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();

  expect(h.context.assembled.map((request) => request.sections)).toEqual([{}]);
});

test("a skipped instruction file is logged as a warning and the turn still runs", async () => {
  const h = await createHarness({
    script: [done],
    instructionSectionsOf: async () => ({
      sections: {},
      diagnostics: [{ code: "instruction_too_large", path: "/work/AGENTS.md" }],
    }),
  });

  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();

  const skipped = h.logs.records
    .filter((record) => record.event === "loop.instruction_skipped")
    .map((record) => ({ level: record.level, fields: record.fields }));
  expect(skipped).toEqual([
    {
      level: "warn",
      fields: {
        threadId: h.threadId,
        turnId: expect.any(String),
        code: "instruction_too_large",
        path: "/work/AGENTS.md",
      },
    },
  ]);
  expect(h.context.assembled.map((request) => request.sections)).toEqual([{}]);
});

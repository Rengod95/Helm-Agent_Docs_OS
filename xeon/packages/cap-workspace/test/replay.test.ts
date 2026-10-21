import { describe, expect, test } from "bun:test";
import { WorkspaceFiles, WorkspaceShell } from "@xeon/contracts/capabilities";
import type { EffectIntent, EffectExec } from "@xeon/contracts/records";
import { decideEffectRecovery } from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";

function execFor(intent: EffectIntent): EffectExec {
  return { effectId: intent.effectId, startedAt: 1_700_000_000_000 };
}

describe("replay policy on unknown outcome", () => {
  const ids = fixedIdFactory();

  function intentFor(toolName: string, replay: "safe" | "unsafe"): EffectIntent {
    return {
      effectId: ids.next("efx"),
      toolCallId: `call_${toolName}`,
      toolName,
      itemId: ids.next("itm"),
      argsHash: "a".repeat(64),
      args: {},
      replay,
      idempotencyKey: null,
    };
  }

  test("unsafe tools are not rerun on unknown outcome", () => {
    for (const tool of [...WorkspaceFiles.tools, ...WorkspaceShell.tools]) {
      const replay = tool.replay ?? "unsafe";
      const intent = intentFor(tool.name, replay);
      // 의도만 기록되고 결과가 없는 경우와 실행 시작까지 기록된 경우 모두
      const notStarted = decideEffectRecovery({
        intent,
        exec: null,
        result: null,
        currentReplay: replay,
      });
      const started = decideEffectRecovery({
        intent,
        exec: execFor(intent),
        result: null,
        currentReplay: replay,
      });
      if (replay === "safe") {
        expect(notStarted.action).toBe("rerun");
        expect(started.action).toBe("rerun");
      } else {
        expect(["write", "edit", "bash"]).toContain(tool.name);
        expect(notStarted).toMatchObject({ action: "synthesize", code: "not_started" });
        expect(started).toMatchObject({ action: "synthesize", code: "outcome_unknown" });
      }
    }
  });
});

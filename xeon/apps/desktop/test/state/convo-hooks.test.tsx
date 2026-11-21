import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  EngineStoreContext,
  useAborting,
  useAgentRows,
  useConvoMarkers,
  useLeadSegments,
  useLooseApprovals,
  useLooseInterventions,
  useNow,
  useToolApprovals,
  useToolInterventions,
  useToolProgress,
  useTurnSummaries,
  useTurnSummary,
} from "../../src/state/engine/index.ts";
import { EMPTY_THREAD_CONVO, type ThreadConvo } from "../../src/state/engine/convo.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../src/state/engine/state.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { itm, thr, trn } from "./helpers.ts";

const T = thr(1);
const TURN = trn(1);

function storeOf(state: EngineMirror): ReadonlyStore<EngineMirror> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

const convo: ThreadConvo = {
  ...EMPTY_THREAD_CONVO,
  turns: [
    {
      turnId: TURN,
      startedSeq: 3,
      inputItemIds: [],
      invoked: [],
      startedAt: "2026-11-11T00:00:00.000Z",
      origin: "user",
      scopeId: null,
      requestId: null,
      model: "m/x",
      steps: 2,
      lastStepIndex: 1,
      lastStopReason: "stop",
      warnings: [],
      lastContextTokens: null,
      lastComposition: null,
      notices: [],
      abort: { code: "user", message: null, cause: "direct", background: false },
      completion: null,
    },
  ],
  tools: {
    call1: {
      toolCallId: "call1",
      progress: { itemId: itm(1), lines: ["a", "b"], receivedChars: 4, updates: 2 },
      approvals: [],
      interventions: [
        { kind: "hook_denied", extension: "x", reason: "no", detail: "blocked", seq: 4, at: "t" },
      ],
    },
  },
};

describe("대화 상태 훅", () => {
  test("선택자 결과를 그대로 읽는다", () => {
    const seen: Record<string, unknown> = {};
    function Probe(): null {
      seen["progress"] = useToolProgress(T, "call1");
      seen["interventions"] = useToolInterventions(T, "call1");
      seen["approvals"] = useToolApprovals(T, "call1");
      seen["turns"] = useTurnSummaries(T).map((t) => [t.turnId, t.steps, t.aborting]);
      seen["turn"] = useTurnSummary(T, TURN)?.model;
      seen["aborting"] = useAborting(T);
      seen["leads"] = useLeadSegments(T);
      seen["agents"] = useAgentRows(T);
      seen["now"] = useNow(T).turnRunning;
      seen["markers"] = useConvoMarkers(T);
      seen["looseI"] = useLooseInterventions(T);
      seen["looseA"] = useLooseApprovals(T);
      return null;
    }
    renderToString(
      <EngineStoreContext value={storeOf({ ...INITIAL_MIRROR, convo: { [T]: convo } })}>
        <Probe />
      </EngineStoreContext>,
    );
    expect(seen["progress"]).toEqual({
      itemId: itm(1),
      lines: ["a", "b"],
      receivedChars: 4,
      updates: 2,
    });
    expect(seen["interventions"]).toEqual([
      { kind: "hook_denied", extension: "x", reason: "no", detail: "blocked", seq: 4, at: "t" },
    ]);
    expect(seen["approvals"]).toEqual([]);
    expect(seen["turns"]).toEqual([[TURN, 2, true]]);
    expect(seen["turn"]).toBe("m/x");
    expect(seen["aborting"]).toBe(true);
    expect(seen["leads"]).toEqual([]);
    expect(seen["agents"]).toEqual([]);
    expect(seen["now"]).toBe(true);
    expect(seen["markers"]).toEqual([]);
    expect(seen["looseI"]).toEqual([]);
    expect(seen["looseA"]).toEqual([]);
  });
});

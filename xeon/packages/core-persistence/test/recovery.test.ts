import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import {
  MAX_REPLAY_ATTEMPTS,
  NOT_STARTED_TEXT,
  OUTCOME_UNKNOWN_TEXT,
  type CommitPlan,
  type EffectIntent,
  type RecoverDeps,
  type ReplayPolicy,
} from "@xeon/contracts/records";
import { decideOpenEffect } from "../src/index.ts";
import { fixedIdFactory } from "./support/clock.ts";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import {
  commitExec,
  commitOrThrow,
  commitResult,
  draftOf,
  endStep,
  expectOk,
  fullStep,
  intentPayload,
  newThread,
  openHarness,
  reopenHarness,
  startTurn,
  stepUntilIntents,
  type Harness,
  type ToolCallPlan,
} from "./support/harness.ts";

function deps(overrides: Partial<RecoverDeps> = {}): RecoverDeps {
  return {
    toolReplay: () => "safe",
    cancelledByOwner: () => false,
    hostMode: "in-process",
    ...overrides,
  };
}

/** 열린 turn 하나에 도구 호출 여러 개의 의도까지 커밋한 상태 */
function openStep(h: Harness, calls: readonly ToolCallPlan[]) {
  const { threadId } = newThread(h);
  const turn = startTurn(h, threadId);
  const stepId = h.ids.next("stp");
  const progress = stepUntilIntents(h, turn, 0, stepId, calls);
  return { threadId, turn, stepId, effects: progress.effects };
}

const intentIds = fixedIdFactory(7);
const INTENT_EFFECT_ID = intentIds.next("efx");
const INTENT_ITEM_ID = intentIds.next("itm");

function intentOf(replay: ReplayPolicy): EffectIntent {
  return {
    effectId: INTENT_EFFECT_ID,
    toolCallId: "tc",
    toolName: "t",
    itemId: INTENT_ITEM_ID,
    argsHash: "0".repeat(64),
    args: {},
    replay,
    idempotencyKey: null,
  };
}

describe("decideOpenEffect", () => {
  const exec = { effectId: intentOf("safe").effectId, startedAt: 1 };
  const base: { result: null; lastExec: null; currentReplay: ReplayPolicy | null } = {
    result: null,
    lastExec: null,
    currentReplay: "safe",
  };

  test("safe + safe reruns, with or without a prior exec, up to the attempt cap", () => {
    expect(decideOpenEffect({ ...base, intent: intentOf("safe"), execCount: 0 }).action).toBe(
      "rerun",
    );
    expect(
      decideOpenEffect({ ...base, intent: intentOf("safe"), lastExec: exec, execCount: 1 }).action,
    ).toBe("rerun");
    expect(
      decideOpenEffect({ ...base, intent: intentOf("safe"), lastExec: exec, execCount: 2 }).action,
    ).toBe("rerun");
    const capped = decideOpenEffect({
      ...base,
      intent: intentOf("safe"),
      lastExec: exec,
      execCount: 1 + MAX_REPLAY_ATTEMPTS,
    });
    expect(capped).toMatchObject({
      action: "synthesize",
      code: "outcome_unknown",
      content: OUTCOME_UNKNOWN_TEXT,
    });
  });

  test("a stored unsafe policy is never promoted by a safe declaration", () => {
    const decided = decideOpenEffect({
      ...base,
      intent: intentOf("unsafe"),
      execCount: 0,
      currentReplay: "safe",
    });
    expect(decided).toMatchObject({
      action: "synthesize",
      code: "not_started",
      content: NOT_STARTED_TEXT,
    });
  });

  test("a vanished tool is treated as unsafe, and a settled effect needs nothing", () => {
    expect(
      decideOpenEffect({
        ...base,
        intent: intentOf("safe"),
        currentReplay: null,
        lastExec: exec,
        execCount: 1,
      }),
    ).toMatchObject({
      action: "synthesize",
      code: "outcome_unknown",
    });
    const settled = {
      effectId: intentOf("safe").effectId,
      status: "ok" as const,
      resultItemId: null,
      output: null,
      blobRef: null,
      durationMs: null,
      synthesized: false,
    };
    expect(
      decideOpenEffect({ ...base, intent: intentOf("safe"), result: settled, execCount: 1 }).action,
    ).toBe("none");
  });

  test("the synthesized result is marked and has no output", () => {
    const decided = decideOpenEffect({
      ...base,
      intent: intentOf("unsafe"),
      lastExec: exec,
      execCount: 1,
      currentReplay: "unsafe",
    });
    if (decided.action !== "synthesize") throw new Bug("expected synthesize");
    expect(decided.result).toMatchObject({
      status: "interrupted",
      synthesized: true,
      output: null,
      resultItemId: null,
    });
  });
});

describe("recover", () => {
  // spec §9.7
  test("resume_synthesizes_outcome_unknown_for_unsafe", () => {
    const h = openHarness();
    const { threadId, turn, stepId, effects } = openStep(h, [
      { toolCallId: "tc-started", toolName: "bash", replay: "unsafe" },
      { toolCallId: "tc-intent-only", toolName: "bash", replay: "unsafe" },
    ]);
    const [started] = effects;
    if (started === undefined) throw new Bug("missing effect");
    commitExec(h, turn, stepId, started.effectId, "tc-started");

    const restarted = reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, expectToken(h, threadId)));
    const plan = expectOk(
      restarted.service.recover(threadId, deps({ toolReplay: () => "unsafe" })),
    );
    expect(plan.synthesized.map((entry) => [entry.toolCallId, entry.code])).toEqual([
      ["tc-started", "outcome_unknown"],
      ["tc-intent-only", "not_started"],
    ]);
    expect(plan.reruns).toEqual([]);

    const results = restarted.store.raw
      .query<{ payload: string }, []>(
        "SELECT json_extract(envelope, '$.payload') AS payload FROM events WHERE kind = 'effect.result' ORDER BY seq",
      )
      .all()
      .map((row): unknown => JSON.parse(row.payload));
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ status: "interrupted", synthesized: true, output: null });
    expect(results[1]).toMatchObject({ status: "abandoned", synthesized: true, output: null });
    const texts = restarted.store.raw
      .query<{ text: string; isError: number; recorded: string }, []>(
        `SELECT json_extract(envelope, '$.payload.item.message.content[0].text') AS text,
                json_extract(envelope, '$.payload.item.message.isError') AS isError,
                json_extract(envelope, '$.payload.item.status') AS recorded
         FROM events WHERE kind = 'item.recorded' AND json_extract(envelope, '$.payload.item.kind') = 'toolResult' ORDER BY seq`,
      )
      .all();
    expect(texts.map((row) => row.text)).toEqual([OUTCOME_UNKNOWN_TEXT, NOT_STARTED_TEXT]);
    expect(texts.every((row) => row.isError === 1)).toBe(true);
    // 효과마다 effect.result는 하나다. 다시 복구해도 늘지 않는다
    const again = expectOk(
      restarted.service.recover(threadId, deps({ toolReplay: () => "unsafe" })),
    );
    expect(again.synthesized).toEqual([]);
    expect(restarted.service.query.openEffects(threadId)).toEqual([]);
    expectProjectionsRebuildable(restarted.store.db);
  });

  // spec §9.8
  test("resume_reruns_safe_tool_once_up_to_max_attempts", () => {
    const h = openHarness();
    const { threadId, turn, stepId, effects } = openStep(h, [
      { toolCallId: "tc1", toolName: "read", replay: "safe" },
    ]);
    const [effect] = effects;
    if (effect === undefined) throw new Bug("missing effect");
    const token = expectToken(h, threadId);

    const reopen = () => {
      const restarted = reopenHarness(h);
      expectOk(restarted.service.openForWrite(threadId, token));
      return restarted;
    };

    // 의도만 있다: 처음 실행도 재실행 판정이다(attempt 1)
    let plan = expectOk(reopen().service.recover(threadId, deps()));
    expect(plan.reruns.map((rerun) => [rerun.intent.toolCallId, rerun.attempt])).toEqual([
      ["tc1", 1],
    ]);
    expect(plan.synthesized).toEqual([]);

    // 첫 실행이 끝나기 전에 끊김: exec 1건, 재실행 1회 가능
    commitExec(h, turn, stepId, effect.effectId, "tc1");
    plan = expectOk(reopen().service.recover(threadId, deps()));
    expect(plan.reruns.map((rerun) => rerun.attempt)).toEqual([1]);

    // 재실행 중 다시 끊김: exec 2건, 재실행 한 번 더(attempt 2)
    commitExec(h, turn, stepId, effect.effectId, "tc1", 1);
    plan = expectOk(reopen().service.recover(threadId, deps()));
    expect(plan.reruns.map((rerun) => rerun.attempt)).toEqual([2]);

    // 한 번 더 끊김: exec 3건이면 상한. 재실행 없이 outcome_unknown으로 닫는다
    commitExec(h, turn, stepId, effect.effectId, "tc1", 2);
    plan = expectOk(reopen().service.recover(threadId, deps()));
    expect(plan.reruns).toEqual([]);
    expect(plan.synthesized.map((entry) => entry.code)).toEqual(["outcome_unknown"]);
  });

  // spec §9.9: 이 패키지에는 tool_call 지점을 발화하는 경로가 없다. recover가 쓰는 것은 합성 결과뿐이다
  test("recover writes nothing but synthesized results and never runs a tool", () => {
    const h = openHarness();
    const { threadId } = openStep(h, [
      { toolCallId: "tc1", toolName: "read", replay: "unsafe" },
      { toolCallId: "tc2", toolName: "read", replay: "safe" },
    ]);
    const restarted = reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, expectToken(h, threadId)));
    const before = restarted.service.feed.headSeq();
    const plan = expectOk(
      restarted.service.recover(
        threadId,
        deps({ toolReplay: (name) => (name === "read" ? "safe" : null) }),
      ),
    );
    const kinds = restarted.store.raw
      .query<{ kind: string }, [number]>("SELECT kind FROM events WHERE seq > ? ORDER BY seq")
      .all(before)
      .map((row) => row.kind);
    // tc1은 저장 정책이 unsafe라 합성, tc2는 재실행 대상이다. 어느 쪽도 실행하지 않는다
    expect(kinds).toEqual(["effect.result", "item.recorded"]);
    expect(plan.reruns.map((rerun) => rerun.intent.toolCallId)).toEqual(["tc2"]);
  });

  test("resume_does_not_promote_stored_unsafe", () => {
    const h = openHarness();
    const { threadId } = openStep(h, [{ toolCallId: "tc1", toolName: "bash", replay: "unsafe" }]);
    const restarted = reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, expectToken(h, threadId)));
    const plan = expectOk(restarted.service.recover(threadId, deps({ toolReplay: () => "safe" })));
    expect(plan.reruns).toEqual([]);
    expect(plan.synthesized).toHaveLength(1);
  });

  test("a vanished tool is synthesized, never rerun", () => {
    const h = openHarness();
    const { threadId } = openStep(h, [{ toolCallId: "tc1", toolName: "gone", replay: "safe" }]);
    const restarted = reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, expectToken(h, threadId)));
    const plan = expectOk(restarted.service.recover(threadId, deps({ toolReplay: () => null })));
    expect(plan.reruns).toEqual([]);
    expect(plan.synthesized[0]?.code).toBe("not_started");
  });

  test("an abort intent closes a safe open effect instead of rerunning it", () => {
    const h = openHarness();
    const { threadId, turn, stepId, effects } = openStep(h, [
      { toolCallId: "tc1", toolName: "read", replay: "safe" },
    ]);
    const [effect] = effects;
    if (effect === undefined) throw new Bug("missing effect");
    commitExec(h, turn, stepId, effect.effectId, "tc1");
    commitOrThrow(h, threadId, `abort:${turn.turnId}`, () => ({
      kind: "append",
      drafts: [
        draftOf(
          h,
          h.loop,
          "turn.abort_requested",
          threadId,
          { turnId: turn.turnId, stepId: null },
          {
            reason: { code: "user", message: null },
            cause: "direct",
            background: false,
          },
        ),
      ],
      checkpoint: null,
    }));
    const restarted = reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, expectToken(h, threadId)));
    const plan = expectOk(restarted.service.recover(threadId, deps({ hostMode: "service" })));
    expect(plan.reruns).toEqual([]);
    expect(plan.synthesized.map((entry) => entry.code)).toEqual(["outcome_unknown"]);
    expect(plan.abortRequestedTurn).toBe(turn.turnId);
    expect(plan.autoResume).toEqual({ allowed: false, reason: "abort_requested" });
  });

  test("cancelledByOwner also closes instead of rerunning", () => {
    const h = openHarness();
    const { threadId, turn } = openStep(h, [
      { toolCallId: "tc1", toolName: "read", replay: "safe" },
    ]);
    const restarted = reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, expectToken(h, threadId)));
    const asked: string[] = [];
    const plan = expectOk(
      restarted.service.recover(
        threadId,
        deps({
          cancelledByOwner: (thread, turnId) => {
            asked.push(`${thread}:${turnId}`);
            return true;
          },
        }),
      ),
    );
    expect(asked).toEqual([`${threadId}:${turn.turnId}`]);
    expect(plan.reruns).toEqual([]);
    expect(plan.synthesized.map((entry) => entry.code)).toEqual(["not_started"]);
    expect(plan.abortRequestedTurn).toBe(turn.turnId);
  });

  test("resume_lists_tool_calls_without_intent_as_pending", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    const stepId = h.ids.next("stp");
    const scope = { turnId: turn.turnId, stepId };
    commitOrThrow(h, threadId, "s1", () => ({
      kind: "append",
      drafts: [draftOf(h, h.loop, "step.started", threadId, scope, { stepIndex: 0 })],
      checkpoint: null,
    }));
    // 호출 셋: 의도 있음, 거부되어 toolResult만 있음, 의도 없음
    const withIntent = h.ids.next("efx");
    commitOrThrow(h, threadId, "resp", () => ({
      kind: "append",
      drafts: [
        draftOf(h, h.loop, "item.recorded", threadId, scope, {
          item: {
            itemId: h.ids.next("itm"),
            status: "completed",
            kind: "assistant",
            message: {
              role: "assistant",
              content: ["tc-intent", "tc-denied", "tc-pending"].map((id) => ({
                type: "toolCall",
                id,
                name: "read",
                arguments: {},
              })),
              api: "t",
              provider: "t",
              model: "t",
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: "toolUse",
              timestamp: 1,
            },
            partIds: [],
          },
        }),
      ],
      checkpoint: null,
    }));
    commitOrThrow(h, threadId, "tool:tc-intent:intent", () => ({
      kind: "append",
      drafts: [
        draftOf(
          h,
          h.tools,
          "effect.intent",
          threadId,
          scope,
          intentPayload(withIntent, h.ids.next("itm"), "tc-intent", "read", "unsafe"),
        ),
      ],
      checkpoint: null,
    }));
    commitOrThrow(h, threadId, "deny", () => ({
      kind: "append",
      drafts: [
        draftOf(h, h.loop, "item.recorded", threadId, scope, {
          item: {
            itemId: h.ids.next("itm"),
            status: "failed",
            kind: "toolResult",
            message: {
              role: "toolResult",
              toolCallId: "tc-denied",
              toolName: "read",
              content: [{ type: "text", text: "denied" }],
              isError: true,
              timestamp: 1,
            },
            effectId: null,
          },
        }),
      ],
      checkpoint: null,
    }));
    const restarted = reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, expectToken(h, threadId)));
    const plan = expectOk(
      restarted.service.recover(threadId, deps({ toolReplay: () => "unsafe" })),
    );
    expect(plan.pendingToolCalls).toEqual([
      { toolCallId: "tc-pending", effectId: null, waiting: null },
    ]);
    expect(plan.synthesized.map((entry) => entry.toolCallId)).toEqual(["tc-intent"]);
  });

  test("after step.completed the earlier tool calls are no longer pending", () => {
    const h = openHarness();
    const { threadId, turn, stepId, effects } = openStep(h, [
      { toolCallId: "tc1", toolName: "read", replay: "safe" },
    ]);
    const [effect] = effects;
    if (effect === undefined) throw new Bug("missing effect");
    commitExec(h, turn, stepId, effect.effectId, "tc1");
    commitOrThrow(h, threadId, "tool:tc1:result", () => ({
      kind: "append",
      drafts: [
        draftOf(
          h,
          h.tools,
          "effect.result",
          threadId,
          { turnId: turn.turnId, stepId },
          {
            effectId: effect.effectId,
            status: "ok",
            resultItemId: null,
            output: null,
            blobRef: null,
            durationMs: 1,
            synthesized: false,
          },
        ),
      ],
      checkpoint: null,
    }));
    endStep(h, turn, 0, stepId, "request");
    const restarted = reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, expectToken(h, threadId)));
    const plan = expectOk(restarted.service.recover(threadId, deps()));
    expect(plan.pendingToolCalls).toEqual([]);
    expect(plan.next).toBe("request");
    expect(plan.checkpoint?.stepIndex).toBe(0);
  });

  // spec §9.27
  test("a kill right after the compaction commit (C7) resumes with next: request and one thread.compacted", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    fullStep(h, turn, 0, [{ toolCallId: "tc1", toolName: "read", replay: "safe" }]);
    const firstKept = h.store.raw
      .query<{ id: string }, []>(
        "SELECT id FROM events WHERE kind = 'item.recorded' ORDER BY seq LIMIT 1",
      )
      .get();
    const stepId = h.ids.next("stp");
    const compact = (key: string) =>
      commitResult(h, threadId, key, () => ({
        kind: "append",
        drafts: [
          draftOf(
            h,
            h.context,
            "thread.compacted",
            threadId,
            { turnId: turn.turnId, stepId },
            {
              summary: "earlier work",
              firstKeptEventId: firstKept?.id,
              tokensBefore: 1000,
              details: null,
              usage: null,
              fromExtension: null,
            },
          ),
          draftOf(
            h,
            h.loop,
            "item.recorded",
            threadId,
            { turnId: turn.turnId, stepId },
            {
              item: {
                itemId: h.ids.next("itm"),
                status: "completed",
                kind: "system",
                message: { role: "system", content: "earlier work", timestamp: 1 },
              },
            },
          ),
        ],
        checkpoint: null,
      }));
    const key = `compact:${threadId}:${stepId}:overflow`;
    expect(expectOk(compact(key)).status).toBe("committed");
    const restarted = reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, expectToken(h, threadId)));
    const plan = expectOk(restarted.service.recover(threadId, deps()));
    // 마지막 체크포인트의 next 그대로다: 같은 단계 요청을 컴팩션 뒤 가지로 다시 보낸다
    expect(plan.next).toBe("request");
    expect(plan.synthesized).toEqual([]);
    // 같은 키의 컴팩션은 다시 커밋되지 않는다
    expect(expectOk(compact(key))).toMatchObject({ status: "committed", replayed: true });
    const count = restarted.store.raw
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events WHERE kind = 'thread.compacted'")
      .get();
    expect(count?.n).toBe(1);
    expectProjectionsRebuildable(restarted.store.db);
  });

  test("next is idle without an open turn and request without a checkpoint of this turn", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const restarted = reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, expectToken(h, threadId)));
    const idle = expectOk(restarted.service.recover(threadId, deps()));
    expect(idle).toMatchObject({
      next: "idle",
      marker: null,
      checkpoint: null,
      abortRequestedTurn: null,
    });
    expect(idle.autoResume).toEqual({ allowed: false, reason: "no_marker" });
    startTurn(restarted, threadId);
    const open = expectOk(restarted.service.recover(threadId, deps()));
    expect(open.next).toBe("request");
    expect(open.marker?.resumeAttempts).toBe(0);
  });

  test("the auto-resume verdict follows the setting, the host mode and the attempt cap", () => {
    const h = openHarness({ settings: () => ({ autoResume: true, maxResumeAttempts: 2 }) });
    const { threadId } = openStep(h, []);
    const verdict = (hostMode: RecoverDeps["hostMode"]) =>
      expectOk(h.service.recover(threadId, deps({ hostMode }))).autoResume;
    expect(verdict("in-process")).toEqual({ allowed: false, reason: "not_service_mode" });
    expect(verdict("service")).toEqual({ allowed: true });
    expectOk(h.service.beginResume(threadId, "auto"));
    expectOk(h.service.beginResume(threadId, "auto"));
    expect(verdict("service")).toEqual({ allowed: false, reason: "attempts_exhausted" });

    const off = openHarness();
    const other = openStep(off, []);
    expect(
      expectOk(off.service.recover(other.threadId, deps({ hostMode: "service" }))).autoResume,
    ).toEqual({
      allowed: false,
      reason: "setting_off",
    });
  });

  test("recover needs write ownership", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const restarted = reopenHarness(h);
    const unopened = restarted.service.recover(threadId, deps());
    expect(unopened.ok).toBe(false);
    if (!unopened.ok) expect(unopened.error.kind).toBe("ownership_lost");
    expectOk(restarted.service.openForRead(threadId));
    const observed = restarted.service.recover(threadId, deps());
    expect(observed.ok).toBe(false);
    if (!observed.ok) expect(observed.error).toEqual({ kind: "read_only", reason: "observer" });
  });

  test("a late normal result after the synthesized one is rejected and leaves one result", () => {
    const h = openHarness();
    const { threadId, turn, stepId, effects } = openStep(h, [
      { toolCallId: "tc1", toolName: "bash", replay: "unsafe" },
    ]);
    const [effect] = effects;
    if (effect === undefined) throw new Bug("missing effect");
    const restarted = reopenHarness(h);
    expectOk(restarted.service.openForWrite(threadId, expectToken(h, threadId)));
    expectOk(restarted.service.recover(threadId, deps({ toolReplay: () => "unsafe" })));
    const late = commitResult(restarted, threadId, "tool:tc1:result", (): CommitPlan => ({
      kind: "append",
      drafts: [
        draftOf(
          restarted,
          restarted.tools,
          "effect.result",
          threadId,
          { turnId: turn.turnId, stepId },
          {
            effectId: effect.effectId,
            status: "ok",
            resultItemId: null,
            output: null,
            blobRef: null,
            durationMs: 5,
            synthesized: false,
          },
        ),
      ],
      checkpoint: null,
    }));
    expect(expectOk(late).status).toBe("key_reused");
    const count = restarted.store.raw
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events WHERE kind = 'effect.result'")
      .get();
    expect(count?.n).toBe(1);
  });
});

function expectToken(h: Harness, threadId: string) {
  const info = h.store.leases.inspect(`session:${threadId}`);
  if (!info.ok || info.value === null) throw new Bug("no lease");
  return {
    resource: `session:${threadId}`,
    holderId: info.value.holderId,
    epoch: info.value.epoch,
  };
}

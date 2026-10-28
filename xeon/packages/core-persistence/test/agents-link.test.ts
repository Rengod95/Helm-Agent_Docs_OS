import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { AgentView, LeaseToken, RecoverDeps } from "@xeon/contracts/records";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import {
  commitOrThrow,
  commitResult,
  draftOf,
  expectOk,
  newThread,
  openHarness,
  reopenHarness,
  startTurn,
  type Harness,
} from "./support/harness.ts";

const DEPS: RecoverDeps = {
  toolReplay: () => "safe",
  cancelledByOwner: () => false,
  hostMode: "in-process",
};

interface Spawned {
  readonly childThreadId: ThreadId;
  readonly parentToken: LeaseToken;
}

/**
 * 자식 생성: 자식 thread를 creationKey로 멱등하게 만들고(부모 소유자가 임대를 상속) 부모 대화에 agent.spawned를 쓴다.
 * 두 단계다: F의 ThreadCreateInput에는 부모 초안을 같은 커밋에 싣는 자리가 없다(L1.persistence.spec §4.10.1)
 */
function spawn(
  h: Harness,
  parent: { readonly threadId: ThreadId; readonly token: LeaseToken },
  turnId: TurnId | null,
  requestId: string,
  options: { readonly background?: boolean; readonly commitKey?: string } = {},
): Spawned {
  const created = expectOk(
    h.service.threads.create({
      threadId: h.ids.next("thr"),
      creationKey: `spawn:${parent.threadId}:${requestId}`,
      inheritOwnerFrom: parent.token,
    }),
  );
  commitOrThrow(h, parent.threadId, options.commitKey ?? `spawn:${requestId}`, () => ({
    kind: "append",
    drafts: [
      draftOf(
        h,
        h.agents,
        "agent.spawned",
        parent.threadId,
        { turnId, stepId: null },
        {
          childThreadId: created.threadId,
          agent: "explore",
          requestId,
          owner:
            turnId === null
              ? { kind: "scope", scopeId: "alpha" }
              : { kind: "tool", turnId, toolCallId: "tc-agent" },
          caller: "subagent:explore",
          depth: 1,
          background: options.background ?? false,
          fork: null,
          modelRole: "fast",
        },
      ),
    ],
    checkpoint: null,
  }));
  return { childThreadId: created.threadId, parentToken: parent.token };
}

function settle(h: Harness, parentId: ThreadId, childThreadId: ThreadId, requestId: string): void {
  commitOrThrow(h, parentId, `agent:${childThreadId}:settled`, () => ({
    kind: "append",
    drafts: [
      draftOf(
        h,
        h.agents,
        "agent.settled",
        parentId,
        { turnId: null, stepId: null },
        {
          childThreadId,
          requestId,
          status: "completed",
          report: null,
          answerItemId: null,
          usage: null,
          error: null,
        },
      ),
    ],
    checkpoint: null,
  }));
}

function tokenOf(h: Harness, threadId: ThreadId): LeaseToken {
  const info = h.store.leases.inspect(`session:${threadId}`);
  if (!info.ok || info.value === null) throw new Bug("no lease");
  return {
    resource: `session:${threadId}`,
    holderId: info.value.holderId,
    epoch: info.value.epoch,
  };
}

describe("p_agents", () => {
  // spec plan agent_by_request_id_finds_spawned_child
  test("agent_by_request_id_finds_spawned_child: TxView sees the child, settled fills in, rebuild agrees", async () => {
    const h = await openHarness();
    const parent = newThread(h);
    const turn = startTurn(h, parent.threadId);
    let probes = 0;
    const lookup = (): AgentView | undefined => {
      let found: AgentView | undefined;
      commitResult(h, parent.threadId, `probe:${String(probes++)}`, (view) => {
        found = view.agentByRequestId(parent.threadId, "req-1");
        return { kind: "reject", code: "probe", detail: null };
      });
      return found;
    };
    expect(lookup()).toBeUndefined();
    const spawned = spawn(h, parent, turn.turnId, "req-1");
    const seen = lookup();
    expect(seen).toEqual({
      childThreadId: spawned.childThreadId,
      parentThreadId: parent.threadId,
      requestId: "req-1",
      ownerTurnId: turn.turnId,
      background: false,
      depth: 1,
      settled: null,
    });
    if (seen === undefined) throw new Bug("the spawned child is missing");
    expect(expectOk(h.service.query.childAgents(parent.threadId))).toEqual([seen]);
    settle(h, parent.threadId, spawned.childThreadId, "req-1");
    const after = lookup();
    expect(after?.settled?.status).toBe("completed");
    expect(expectOk(h.service.query.childAgents(parent.threadId, { unsettledOnly: true }))).toEqual(
      [],
    );
    expectProjectionsRebuildable(h.store.db);
  });

  test("a retried create with the same creationKey reuses the child; the unique index guards the link", async () => {
    const h = await openHarness();
    const parent = newThread(h);
    const turn = startTurn(h, parent.threadId);
    const first = spawn(h, parent, turn.turnId, "req-1");
    const again = expectOk(
      h.service.threads.create({
        threadId: h.ids.next("thr"),
        creationKey: `spawn:${parent.threadId}:req-1`,
        inheritOwnerFrom: parent.token,
      }),
    );
    expect(again).toMatchObject({ threadId: first.childThreadId, replayed: true });
    // 호출자가 TxView.agentByRequestId로 걸러내지 못한 같은 (부모, 자식 requestId)의 두 번째 agent.spawned는
    // 투영 색인이 막는다(커밋 전체 롤백)
    expect(() => spawn(h, parent, turn.turnId, "req-1", { commitKey: "spawn:again" })).toThrow(
      "store.projection_failed",
    );
    expect(expectOk(h.service.query.childAgents(parent.threadId))).toHaveLength(1);
  });

  test("removing a child thread keeps the parent's history: the link row stays and rebuild agrees", async () => {
    const h = await openHarness();
    const parent = newThread(h);
    const turn = startTurn(h, parent.threadId);
    const child = spawn(h, parent, turn.turnId, "req-1");
    expectOk(h.service.threads.remove(child.childThreadId));
    expect(
      expectOk(h.service.query.childAgents(parent.threadId)).map((row) => row.childThreadId),
    ).toEqual([child.childThreadId]);
    expectProjectionsRebuildable(h.store.db);
  });
});

describe("ResumePlan.openChildren", () => {
  // spec plan resume_lists_unsettled_children
  test("resume_lists_unsettled_children: after a restart the unsettled child of the open turn is listed", async () => {
    const h = await openHarness();
    const parent = newThread(h);
    const turn = startTurn(h, parent.threadId);
    const done = spawn(h, parent, turn.turnId, "req-done");
    const open = spawn(h, parent, turn.turnId, "req-open");
    settle(h, parent.threadId, done.childThreadId, "req-done");
    // 소유 turn이 없는 자식(scope 소유)은 열린 turn의 자식이 아니다
    spawn(h, parent, null, "req-scope", { background: true });

    const restarted = await reopenHarness(h);
    expectOk(restarted.service.openForWrite(parent.threadId, tokenOf(h, parent.threadId)));
    const plan = expectOk(restarted.service.recover(parent.threadId, DEPS));
    expect(plan.openChildren.map((child) => child.childThreadId)).toEqual([open.childThreadId]);
    // 재시작 뒤 같은 requestId 조회는 그 자식을 돌려준다(재생성 금지)
    let found: AgentView | undefined;
    commitResult(restarted, parent.threadId, "probe", (view) => {
      found = view.agentByRequestId(parent.threadId, "req-open");
      return { kind: "reject", code: "probe", detail: null };
    });
    expect(found?.childThreadId).toBe(open.childThreadId);
  });

  test("a turn with an abort request does not resume its children", async () => {
    const h = await openHarness();
    const parent = newThread(h);
    const turn = startTurn(h, parent.threadId);
    spawn(h, parent, turn.turnId, "req-open");
    commitOrThrow(h, parent.threadId, `abort:${turn.turnId}`, () => ({
      kind: "append",
      drafts: [
        draftOf(
          h,
          h.loop,
          "turn.abort_requested",
          parent.threadId,
          { turnId: turn.turnId, stepId: null },
          { reason: { code: "user", message: null }, cause: "direct", background: false },
        ),
      ],
      checkpoint: null,
    }));
    const restarted = await reopenHarness(h);
    expectOk(restarted.service.openForWrite(parent.threadId, tokenOf(h, parent.threadId)));
    const plan = expectOk(restarted.service.recover(parent.threadId, DEPS));
    expect(plan.abortRequestedTurn).toBe(turn.turnId);
    expect(plan.openChildren).toEqual([]);
  });
});

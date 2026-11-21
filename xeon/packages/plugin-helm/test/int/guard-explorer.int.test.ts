import { expect, test } from "bun:test";
import type { CallerId, ToolRisk } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ToolCallDecision } from "@fresnel/contracts/extensions";
import { WRITE_DENY_REASON } from "../../src/guard.ts";
import { createRig, type Rig } from "../support/rig.ts";

const DENY: ToolCallDecision = { block: true, reason: WRITE_DENY_REASON };

/** 시험 훅이 rig를 쓰려고 기다리는 자리. createRig가 끝난 뒤 채운다 */
interface Bound {
  rig?: Rig;
}

function boundRig(bound: Bound): Rig {
  if (bound.rig === undefined) throw new Error("the rig is not bound yet");
  return bound.rig;
}

/** 한 호출자가 한 대화에서 도구 호출을 보낸 것처럼 `tool.call.before`를 발화하고 판정을 돌려준다 */
async function askGuard(
  rig: Rig,
  threadId: ThreadId,
  caller: CallerId,
  toolName: string,
  risk: ToolRisk,
  key: string,
): Promise<ToolCallDecision | undefined> {
  const outcome = await rig.t.host.dispatch(
    "tool.call.before",
    { toolCallId: key, toolName, input: {}, risk, caller },
    { threadId, dispatchKey: key },
  );
  return outcome.decision;
}

interface Probe {
  readonly who: string;
  readonly decision: ToolCallDecision | undefined;
}

/** 여러 렌즈의 spawn이 병렬로 발화하므로 시점 순서가 아니라 이름 순으로 맞춘다 */
function byWho(probes: readonly Probe[]): readonly Probe[] {
  return probes.toSorted((a, b) => (a.who < b.who ? -1 : a.who > b.who ? 1 : 0));
}

/**
 * explorer 자식 대화는 자기 커밋 상태가 idle이다. 시험은 자식 대화 id를 새로 받아 그 대화에서 쓰기 도구를 부른다.
 * 주 대화(main)는 같은 시점에 쓰기를 부른다. 같은 거부가 나와야 한다
 */
test("guard.explorer-child-denied-while-main-explores", async () => {
  const bound: Bound = {};
  const probes: Probe[] = [];
  const rig = await createRig({
    onSpawn: async () => {
      const current = boundRig(bound);
      const child = current.t.newThread();
      probes.push({
        who: "main write",
        decision: await askGuard(current, current.thread, "main", "write", "write", "p-main-w"),
      });
      probes.push({
        who: "explorer write",
        decision: await askGuard(current, child, "subagent:explorer", "write", "write", "p-exp-w"),
      });
      probes.push({
        who: "explorer edit",
        decision: await askGuard(current, child, "subagent:explorer", "edit", "write", "p-exp-e"),
      });
    },
  });
  bound.rig = rig;

  await rig.runInquiry("캐시 무효화");

  expect(rig.t.loop.spawns.length).toBeGreaterThan(0);
  expect(byWho(probes)).toEqual(
    byWho(
      rig.t.loop.spawns.flatMap(() => [
        { who: "main write", decision: DENY },
        { who: "explorer write", decision: DENY },
        { who: "explorer edit", decision: DENY },
      ]),
    ),
  );
});

/**
 * 판정은 실행 중인 탐구 단계를 따른다. 확산 turn에서는 거부, 적용 turn과 끝난 뒤(idle)에서는 거부하지 않는다.
 * 적용 turn에서 explorer 표지가 explore에 머물면 이 시험이 잡는다
 */
test("guard.explorer-child-follows-the-running-phase", async () => {
  const bound: Bound = {};
  const probes: Probe[] = [];
  const check = async (label: string): Promise<void> => {
    const current = boundRig(bound);
    const child = current.t.newThread();
    probes.push({
      who: `${label} explorer write`,
      decision: await askGuard(current, child, "subagent:explorer", "write", "write", `${label}-w`),
    });
    probes.push({
      who: `${label} main write`,
      decision: await askGuard(current, current.thread, "main", "write", "write", `${label}-m`),
    });
  };
  const rig = await createRig({
    onTurn: async (request) => {
      if (request.requestId.includes(":turn:diverge:")) await check("diverge");
      if (request.requestId.includes(":turn:apply:")) await check("apply");
    },
  });
  bound.rig = rig;

  await rig.runInquiry("캐시 무효화");
  await check("idle");

  expect(byWho(probes)).toEqual(
    byWho([
      { who: "diverge explorer write", decision: DENY },
      { who: "diverge main write", decision: DENY },
      { who: "apply explorer write", decision: undefined },
      { who: "apply main write", decision: undefined },
      { who: "idle explorer write", decision: undefined },
      { who: "idle main write", decision: undefined },
    ]),
  );
});

/** explorer가 아닌 서브에이전트와 읽기 호출은 탐구 단계와 상관없이 거부되지 않는다 */
test("guard.other-callers-unaffected-while-exploring", async () => {
  const bound: Bound = {};
  const probes: Probe[] = [];
  const rig = await createRig({
    onSpawn: async () => {
      const current = boundRig(bound);
      const child = current.t.newThread();
      probes.push({
        who: "reviewer write",
        decision: await askGuard(current, child, "subagent:reviewer", "write", "write", "o-rev-w"),
      });
      probes.push({
        who: "explorer read",
        decision: await askGuard(current, child, "subagent:explorer", "read", "read", "o-exp-r"),
      });
    },
  });
  bound.rig = rig;

  await rig.runInquiry("캐시 무효화");

  expect(rig.t.loop.spawns.length).toBeGreaterThan(0);
  expect(byWho(probes)).toEqual(
    byWho(
      rig.t.loop.spawns.flatMap(() => [
        { who: "reviewer write", decision: undefined },
        { who: "explorer read", decision: undefined },
      ]),
    ),
  );
});

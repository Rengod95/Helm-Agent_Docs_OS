import type { CallContext, KnowledgeActor, ScanSummary } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import { SCAN_RULESET_VERSION } from "../../src/scan/rules.ts";
import type { Writer, WritePlan, WriteRequest } from "../../src/write/pipeline.ts";
import { hashOfTarget, readTarget, type ChangeTarget } from "../../src/ledger/target.ts";
import { treeFrom } from "./helpers.ts";
import { USER_SKILLS, type World } from "./world.ts";

// 게이트·대기열 시험용 쓰기 계획. 스킬 쓰기 연산(K3)을 거치지 않고 `Writer`에 직접 계획을 넣는다.

const SCAN: ScanSummary = { rulesetVersion: SCAN_RULESET_VERSION, findings: [] };

export function skillText(body: string): string {
  return `---\nname: deploy\ndescription: Deploy steps.\n---\n${body}`;
}

export function deployTarget(): ChangeTarget {
  return { kind: "skill", name: "deploy", scope: "user", path: `${USER_SKILLS}/deploy` };
}

export async function hashOfDeploy(world: World): Promise<string | null> {
  const target = deployTarget();
  const tree = await readTarget(world.fs, target);
  if (!tree.ok) throw new Error(tree.error.message);
  return hashOfTarget(target.kind, tree.value);
}

/** `deploy` 스킬을 만드는 계획. 대상이 없어야 한다(baseHash null) */
export function createPlan(overrides: Partial<WritePlan> = {}): WritePlan {
  return {
    method: "skills.create",
    input: { name: "deploy" },
    target: deployTarget(),
    op: "skill.create",
    destructive: false,
    baseHash: null,
    current: null,
    next: treeFrom({ "SKILL.md": skillText("v1\n") }),
    removal: "archive",
    scan: SCAN,
    reason: undefined,
    rollbackOf: undefined,
    captureFailure: "internal",
    ...overrides,
  };
}

/** 있는 `deploy` 스킬을 고치는 파괴적 계획 */
export async function editPlan(world: World, body: string): Promise<WritePlan> {
  const target = deployTarget();
  const current = await readTarget(world.fs, target);
  if (!current.ok) throw new Error(current.error.message);
  return createPlan({
    method: "skills.edit",
    op: "skill.edit",
    destructive: true,
    baseHash: hashOfTarget("skill", current.value),
    current: current.value,
    next: treeFrom({ "SKILL.md": skillText(body) }),
  });
}

export function agentActor(agent: "main" | "subagent" | "background"): KnowledgeActor {
  return { kind: "agent", sessionId: "thr_test", agent };
}

export function contextOf(
  threadId: ThreadId | undefined,
  caller: CallContext["caller"],
  extra: Partial<CallContext> = {},
): CallContext {
  return { ...(threadId === undefined ? {} : { threadId }), caller, ...extra };
}

export function request(
  writer: Writer,
  base: Pick<WriteRequest, "plan" | "actor" | "context"> &
    Partial<Pick<WriteRequest, "requestId" | "evidence" | "signal" | "decided">>,
): ReturnType<Writer["run"]> {
  return writer.run({
    requestId: undefined,
    evidence: undefined,
    signal: undefined,
    decided: undefined,
    ...base,
  });
}

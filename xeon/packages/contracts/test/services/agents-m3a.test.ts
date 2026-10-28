import { expect, test } from "bun:test";
import type { DurableEventDraft, LeaseToken, ThreadCreateInput } from "../../src/records/index.ts";
import type {
  CancelTarget,
  ChildTurnRequest,
  DelegateRequest,
  SpawnOrigin,
} from "../../src/services/index.ts";
import { ThreadIdSchema } from "../../src/conversation/index.ts";
import { must, rawId } from "../helpers/ids.ts";
import type { Equal, Expect } from "../types/expect.ts";

// 이 파일의 타입 단언은 tsc -b가 판정한다. 과잉 속성 검사와 @ts-expect-error가 "필드가 없으면 컴파일이 실패한다"를 보인다.

type ToolsOf = ChildTurnRequest["tools"];
export type ChildToolsCarryDeny = Expect<Equal<ToolsOf["deny"], readonly string[] | undefined>>;
export type ChildToolsCarryDenyHint = Expect<Equal<ToolsOf["denyHint"], string | undefined>>;

export type ParentTokenIsOptional = Expect<
  Equal<SpawnOrigin["parentToken"], LeaseToken | undefined>
>;

export type ParentDraftsCarryDrafts = Expect<
  Equal<NonNullable<ThreadCreateInput["parentDrafts"]>[number], DurableEventDraft>
>;

/** report 없는 위임 요청(보고 입력을 만들지 않는 학습 검토 포크) */
test("DelegateRequest without report is a valid value", () => {
  const request = {
    agent: "learning-review",
    task: "review",
    requestId: "learning:review:1",
  } satisfies DelegateRequest;
  expect(request.requestId).toBe("learning:review:1");
  const withReport = {
    ...request,
    report: { customType: "agent.report", display: false, when: "next" },
  } satisfies DelegateRequest;
  expect(withReport.report.when).toBe("next");
});

test("CancelTarget has three variants including the owner scope", () => {
  const thread = must(ThreadIdSchema, rawId("thr", 1));
  const targets = [
    { childThreadId: thread },
    { parentThreadId: thread, requestId: "r1" },
    { ownerScopeId: "learning" },
  ] satisfies CancelTarget[];
  expect(targets.map((t) => Object.keys(t))).toEqual([
    ["childThreadId"],
    ["parentThreadId", "requestId"],
    ["ownerScopeId"],
  ]);
});

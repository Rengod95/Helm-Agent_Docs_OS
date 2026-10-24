import { describe, expect, test } from "bun:test";
import type { Result } from "../../src/index.ts";
import type { UserBashResult } from "../../src/extensions/index.ts";
import type {
  LoopError,
  LoopService,
  UserBashOutcome,
  UserBashRequest,
} from "../../src/services/index.ts";
import { ThreadIdSchema } from "../../src/conversation/index.ts";
import { must, rawId } from "../helpers/ids.ts";
import type { Equal, Expect } from "../types/expect.ts";

// L1.loop.spec §3.1 `runUserBash`: user_bash 지점(first)을 발화하고 거부가 아니면 xeon.tools.runUserShell로 실행한다.
export type RunUserBashSignature = Expect<
  Equal<
    LoopService["runUserBash"],
    (request: UserBashRequest) => Promise<Result<UserBashOutcome, LoopError>>
  >
>;
// 완료 결과의 모양은 user_bash 지점의 결과(pi BashResult)와 같다
export type CompletedCarriesTheHookResult = Expect<
  Equal<Extract<UserBashOutcome, { status: "completed" }>["result"], UserBashResult>
>;

describe("UserBashRequest", () => {
  test("a !! command is excluded from the model context", () => {
    const request: UserBashRequest = {
      threadId: must(ThreadIdSchema, rawId("thr", 1)),
      command: "git status",
      excludeFromContext: true,
    };
    expect(request.excludeFromContext).toBe(true);
  });

  test("outcomes are values, so a denial is not an error", () => {
    const denied: UserBashOutcome = { status: "denied", reason: "blocked by a hook" };
    const done: UserBashOutcome = {
      status: "completed",
      replaced: false,
      result: { output: "ok", exitCode: 0, cancelled: false, truncated: false },
    };
    expect([denied.status, done.status]).toEqual(["denied", "completed"]);
  });
});

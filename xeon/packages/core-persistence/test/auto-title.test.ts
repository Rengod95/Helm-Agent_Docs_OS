import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { autoTitleThread, type AutoTitleDeps, type TitleModelPort } from "../src/index.ts";
import { itemAt } from "./support/branching.ts";
import {
  commitOrThrow,
  commitStepStart,
  draftOf,
  endStep,
  endTurn,
  expectOk,
  newThread,
  openHarness,
  type Harness,
} from "./support/harness.ts";
import { TEST_HOLDER_A } from "./support/sqlite-store.ts";

// M3-REQ-83. 저장된 제목이 임시일 때만 모델로 만든 제목을 쓰고, 입력은 활성 가지의 첫 사용자·어시스턴트 텍스트다.
// 임시 제목은 제목이 없거나 호스트가 첫 입력에서 만든 제목이다(여기서는 FIRST_INPUT_TITLE).

const FIRST_INPUT_TITLE = "첫 입력에서 만든 제목";

function isProvisional(title: string | null): boolean {
  return title === null || title === FIRST_INPUT_TITLE;
}

interface FakeModel {
  readonly port: TitleModelPort;
  /** 받은 입력. 모델을 부른 순서대로 쌓인다 */
  readonly calls: { readonly system: string; readonly user: string }[];
  /** 다음 호출의 응답을 바꾼다 */
  set(reply: Result<string, { readonly kind: string }>): void;
}

function fakeModel(first: Result<string, { readonly kind: string }>): FakeModel {
  const calls: { readonly system: string; readonly user: string }[] = [];
  let reply = first;
  return {
    port: {
      complete(input) {
        calls.push({ system: input.system, user: input.user });
        return Promise.resolve(reply);
      },
    },
    calls,
    set(next) {
      reply = next;
    },
  };
}

function depsOf(h: Harness, model: TitleModelPort): AutoTitleDeps {
  return { session: h.service, model, isProvisional };
}

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function userItem(h: Harness, content: unknown): unknown {
  return {
    item: {
      itemId: h.ids.next("itm"),
      status: "completed",
      kind: "user",
      message: { role: "user", content, timestamp: h.clock.now() },
      requestId: null,
    },
  };
}

function assistantItem(h: Harness, text: string): unknown {
  return {
    item: {
      itemId: h.ids.next("itm"),
      status: "completed",
      kind: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        api: "test",
        provider: "test",
        model: "tape",
        usage: USAGE,
        stopReason: "stop",
        timestamp: h.clock.now(),
      },
      partIds: [],
    },
  };
}

/** 사용자 입력 한 개와 어시스턴트 응답 한 개가 든 turn을 커밋한다. 응답이 null이면 입력만 둔다 */
function recordTurn(h: Harness, threadId: ThreadId, user: unknown, assistant: string | null): void {
  const turnId = h.ids.next("trn");
  const turn = { threadId, turnId };
  const scope = { turnId, stepId: null };
  commitOrThrow(h, threadId, `turn:${turnId}:start`, () => ({
    kind: "append",
    drafts: [
      draftOf(h, h.loop, "turn.started", threadId, scope, {
        inputItemIds: [],
        requestId: null,
        scopeId: null,
      }),
      draftOf(h, h.loop, "item.recorded", threadId, scope, userItem(h, user)),
    ],
    checkpoint: null,
  }));
  if (assistant === null) return;
  const stepId = h.ids.next("stp");
  commitStepStart(h, turn, 0, stepId);
  commitOrThrow(h, threadId, `resp:${turnId}`, () => ({
    kind: "append",
    drafts: [
      draftOf(
        h,
        h.loop,
        "item.recorded",
        threadId,
        { turnId, stepId },
        assistantItem(h, assistant),
      ),
    ],
    checkpoint: null,
  }));
  endStep(h, turn, 0, stepId, "turn_end");
  endTurn(h, turn);
}

/** 제목을 정하고 첫 turn을 기록한 thread */
function threadWithTurn(
  h: Harness,
  title: string | null,
  user: string,
  assistant: string,
): ThreadId {
  const { threadId } = newThread(h, title);
  recordTurn(h, threadId, user, assistant);
  return threadId;
}

function titleOf(h: Harness, threadId: ThreadId): string | null {
  return expectOk(h.service.query.thread(threadId))?.title ?? null;
}

function threadUpdatedCount(h: Harness, threadId: ThreadId): number {
  return (
    h.store.raw
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) AS n FROM events WHERE thread_id = ? AND kind = 'thread.updated'",
      )
      .get(threadId)?.n ?? -1
  );
}

describe("autoTitleThread", () => {
  test("titles a provisional thread from the first user and assistant texts", async () => {
    const h = await openHarness();
    const threadId = threadWithTurn(
      h,
      FIRST_INPUT_TITLE,
      "배포 스크립트를 고쳐 줘",
      "build 단계부터 보겠습니다.",
    );
    recordTurn(h, threadId, "두 번째 질문", "두 번째 답");
    const model = fakeModel(ok('  "배포 스크립트 수정"  '));

    const result = await autoTitleThread(depsOf(h, model.port), threadId);

    expect(result).toEqual(ok({ status: "titled", title: "배포 스크립트 수정" }));
    expect(titleOf(h, threadId)).toBe("배포 스크립트 수정");
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.system).toContain("8 words");
    expect(model.calls[0]?.user).toContain("배포 스크립트를 고쳐 줘");
    expect(model.calls[0]?.user).toContain("build 단계부터 보겠습니다.");
    expect(model.calls[0]?.user).not.toContain("두 번째 질문");
  });

  test("never overwrites a human title and never calls the model", async () => {
    const h = await openHarness();
    const threadId = threadWithTurn(h, "내가 정한 제목", "질문", "답");
    const model = fakeModel(ok("자동 제목"));

    const result = await autoTitleThread(depsOf(h, model.port), threadId);

    expect(result).toEqual(ok({ status: "skipped", reason: "has_human_title" }));
    expect(model.calls).toHaveLength(0);
    expect(titleOf(h, threadId)).toBe("내가 정한 제목");
  });

  test("a thread without a title is provisional and gets one", async () => {
    const h = await openHarness();
    const threadId = threadWithTurn(h, null, "질문", "답");
    const model = fakeModel(ok("새 제목"));

    const result = await autoTitleThread(depsOf(h, model.port), threadId);

    expect(result).toEqual(ok({ status: "titled", title: "새 제목" }));
    expect(titleOf(h, threadId)).toBe("새 제목");
  });

  const CASES: readonly {
    readonly name: string;
    readonly raw: string;
    readonly title: string | null;
  }[] = [
    { name: "surrounding quotes", raw: '"Weekly report"', title: "Weekly report" },
    { name: "backticks", raw: "`Fix login`", title: "Fix login" },
    { name: "markdown heading", raw: "## Refactor parser", title: "Refactor parser" },
    { name: "heading, quotes and a period", raw: '# "Set up CI".', title: "Set up CI" },
    {
      name: "several lines keep the first non-empty one",
      raw: "\n\n  Plan the migration  \nsecond line",
      title: "Plan the migration",
    },
    { name: "whitespace collapsed", raw: "Deploy   to\tstaging", title: "Deploy to staging" },
    { name: "trailing punctuation trimmed", raw: "Ship it!", title: "Ship it" },
    { name: "cut to 80 code points", raw: "a".repeat(100), title: "a".repeat(80) },
    { name: "emoji count as one code point", raw: "😀".repeat(90), title: "😀".repeat(80) },
    { name: "empty output", raw: "", title: null },
    { name: "whitespace only", raw: " \n\t ", title: null },
    { name: "quotes only", raw: '""', title: null },
    { name: "punctuation only", raw: "...", title: null },
  ];
  for (const sample of CASES) {
    test(`sanitises the model output: ${sample.name}`, async () => {
      const h = await openHarness();
      const threadId = threadWithTurn(h, FIRST_INPUT_TITLE, "질문", "답");
      const model = fakeModel(ok(sample.raw));

      const result = await autoTitleThread(depsOf(h, model.port), threadId);

      if (sample.title === null) {
        expect(result).toEqual(ok({ status: "skipped", reason: "empty_title" }));
        expect(titleOf(h, threadId)).toBe(FIRST_INPUT_TITLE);
      } else {
        expect(result).toEqual(ok({ status: "titled", title: sample.title }));
        expect(titleOf(h, threadId)).toBe(sample.title);
      }
    });
  }

  test("a model failure is reported and the stored title stays", async () => {
    const h = await openHarness();
    const threadId = threadWithTurn(h, FIRST_INPUT_TITLE, "질문", "답");
    const model = fakeModel(err({ kind: "timeout" }));

    const result = await autoTitleThread(depsOf(h, model.port), threadId);

    expect(result).toEqual(err({ kind: "model_failed", modelKind: "timeout" }));
    expect(titleOf(h, threadId)).toBe(FIRST_INPUT_TITLE);
  });

  test("a port that throws is reported as model_failed, not thrown", async () => {
    const h = await openHarness();
    const threadId = threadWithTurn(h, FIRST_INPUT_TITLE, "질문", "답");
    const crashing: TitleModelPort = {
      complete: () => {
        throw new Error("adapter crashed");
      },
    };

    const result = await autoTitleThread(depsOf(h, crashing), threadId);

    expect(result).toEqual(err({ kind: "model_failed", modelKind: "threw" }));
    expect(titleOf(h, threadId)).toBe(FIRST_INPUT_TITLE);
  });

  test("a forked thread takes its first texts from the source history", async () => {
    const h = await openHarness();
    const origin = threadWithTurn(h, FIRST_INPUT_TITLE, "원본의 첫 질문", "원본의 첫 답");
    recordTurn(h, origin, "원본의 둘째 질문", "원본의 둘째 답");
    const forkId = h.ids.next("thr");
    expectOk(await h.service.threads.fork(origin, itemAt(h, origin, 1).itemId, forkId));
    const token = expectOk(h.store.leases.acquire(`session:${forkId}`, TEST_HOLDER_A));
    expectOk(h.service.openForWrite(forkId, token));
    const model = fakeModel(ok("포크 제목"));

    const result = await autoTitleThread(depsOf(h, model.port), forkId);

    expect(result).toEqual(ok({ status: "titled", title: "포크 제목" }));
    // 포크는 자기 turn이 없다. 첫 텍스트는 출처 history에서 와야 한다(없으면 no_user_text가 된다)
    expect(model.calls[0]?.user).toContain("원본의 첫 질문");
    expect(model.calls[0]?.user).toContain("원본의 첫 답");
    expect(model.calls[0]?.user).not.toContain("원본의 둘째 질문");
    expect(titleOf(h, forkId)).toBe("포크 제목");
    expect(titleOf(h, origin)).toBe(FIRST_INPUT_TITLE);
  });

  test("calling it twice titles once and then leaves the title alone", async () => {
    const h = await openHarness();
    const threadId = threadWithTurn(h, FIRST_INPUT_TITLE, "질문", "답");
    const model = fakeModel(ok("한 번만 쓴 제목"));

    const first = await autoTitleThread(depsOf(h, model.port), threadId);
    const second = await autoTitleThread(depsOf(h, model.port), threadId);

    expect(first).toEqual(ok({ status: "titled", title: "한 번만 쓴 제목" }));
    // 두 번째는 방금 쓴 제목이 임시가 아니라 덮지 않는다
    expect(second).toEqual(ok({ status: "skipped", reason: "has_human_title" }));
    expect(model.calls).toHaveLength(1);
    expect(titleOf(h, threadId)).toBe("한 번만 쓴 제목");
  });

  test("the same title under the same request key is replayed, not written again", async () => {
    const h = await openHarness();
    const threadId = threadWithTurn(h, FIRST_INPUT_TITLE, "질문", "답");
    const model = fakeModel(ok("제목 A"));
    expect(await autoTitleThread(depsOf(h, model.port), threadId)).toEqual(
      ok({ status: "titled", title: "제목 A" }),
    );
    // 다른 키로 임시 제목으로 되돌린다. 다음 호출은 같은 키(autotitle:<id>)에 같은 제목을 낸다
    expectOk(h.service.threads.setTitle(threadId, FIRST_INPUT_TITLE, "reset-1"));

    const again = await autoTitleThread(depsOf(h, model.port), threadId);

    expect(again).toEqual(ok({ status: "titled", title: "제목 A" }));
    expect(model.calls).toHaveLength(2);
    // 처음 자동 제목과 되돌리기만 기록됐다. 재전송은 이벤트를 늘리지 않는다
    expect(threadUpdatedCount(h, threadId)).toBe(2);
  });

  test("a different title under a reused request key is skipped as already titled", async () => {
    const h = await openHarness();
    const threadId = threadWithTurn(h, FIRST_INPUT_TITLE, "질문", "답");
    const model = fakeModel(ok("제목 A"));
    expect(await autoTitleThread(depsOf(h, model.port), threadId)).toEqual(
      ok({ status: "titled", title: "제목 A" }),
    );
    expectOk(h.service.threads.setTitle(threadId, FIRST_INPUT_TITLE, "reset-1"));
    model.set(ok("제목 B"));

    const again = await autoTitleThread(depsOf(h, model.port), threadId);

    expect(again).toEqual(ok({ status: "skipped", reason: "has_human_title" }));
    expect(titleOf(h, threadId)).toBe(FIRST_INPUT_TITLE);
  });

  test("skips without calling the model when there is no user or assistant text", async () => {
    const h = await openHarness();
    const empty = newThread(h, FIRST_INPUT_TITLE).threadId;
    const userOnly = newThread(h, FIRST_INPUT_TITLE).threadId;
    recordTurn(h, userOnly, "입력만 있다", null);
    const imageOnly = newThread(h, FIRST_INPUT_TITLE).threadId;
    recordTurn(h, imageOnly, [{ type: "image", data: "AAAA", mimeType: "image/png" }], "답");
    const model = fakeModel(ok("쓰이면 안 되는 제목"));

    expect(await autoTitleThread(depsOf(h, model.port), empty)).toEqual(
      ok({ status: "skipped", reason: "no_user_text" }),
    );
    expect(await autoTitleThread(depsOf(h, model.port), userOnly)).toEqual(
      ok({ status: "skipped", reason: "no_assistant_text" }),
    );
    expect(await autoTitleThread(depsOf(h, model.port), imageOnly)).toEqual(
      ok({ status: "skipped", reason: "no_user_text" }),
    );
    expect(model.calls).toHaveLength(0);
  });

  test("image blocks are left out of the model input", async () => {
    const h = await openHarness();
    const threadId = newThread(h, FIRST_INPUT_TITLE).threadId;
    recordTurn(
      h,
      threadId,
      [
        { type: "image", data: "AAAA", mimeType: "image/png" },
        { type: "text", text: "로고 색을 바꿔 줘" },
      ],
      "네, 바꾸겠습니다.",
    );
    const model = fakeModel(ok("로고 색 변경"));

    expect(await autoTitleThread(depsOf(h, model.port), threadId)).toEqual(
      ok({ status: "titled", title: "로고 색 변경" }),
    );
    expect(model.calls[0]?.user).toContain("로고 색을 바꿔 줘");
    expect(model.calls[0]?.user).not.toContain("AAAA");
  });

  test("an unknown thread is thread_not_found", async () => {
    const h = await openHarness();
    const model = fakeModel(ok("제목"));

    const result = await autoTitleThread(depsOf(h, model.port), h.ids.next("thr"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("thread_not_found");
    expect(model.calls).toHaveLength(0);
  });

  test("a store refusal is reported with its lifecycle kind", async () => {
    const h = await openHarness();
    const threadId = threadWithTurn(h, FIRST_INPUT_TITLE, "질문", "답");
    // 쓰기 소유를 놓으면 setTitle은 not_owner로 거절한다
    await h.service.release(threadId, "quit");
    const model = fakeModel(ok("제목"));

    const result = await autoTitleThread(depsOf(h, model.port), threadId);

    expect(result).toEqual(err({ kind: "store_failed", lifecycleKind: "not_owner" }));
  });
});

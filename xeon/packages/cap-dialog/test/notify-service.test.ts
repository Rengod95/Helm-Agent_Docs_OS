import { describe, expect, test } from "bun:test";
import type { Notice } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  LIST_DEFAULT_LIMIT,
  NOTICE_COALESCE_MS,
  createNotifyService,
} from "../src/notify/service.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";
import {
  agentSettled,
  goalSettled,
  memoryNotices,
  toolApproval,
  turnCompleted,
} from "./support/notices.ts";

// L2.dialog.spec §3.6, §4.7. emit과 list는 내구 로그에서 읽고, 구독은 피드 이벤트에서 알림을 만든다.
// 시험은 메모리 내구 로그와 수동 시계를 쓴다. 피드 대역은 커밋마다 notify.onEvent를 부른다.

function setup() {
  const h = harness();
  const port = memoryNotices();
  const notify = createNotifyService({ ...h.deps, notices: port });
  port.listen((event) => {
    notify.onEvent(event);
  });
  return { h, port, notify, api: notify.api };
}

/** 호출이 거부되면 CapabilityError를 돌려주고, 성공하면 undefined다 */
function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
}

describe("emit과 list", () => {
  test("emit한 알림을 list가 같은 값으로 돌려준다", async () => {
    const { api } = setup();
    const thread = newThread();
    const emitted = await api.emit(
      { kind: "completed", title: "작업이 끝났다", body: "본문", origin: "group.a" },
      callOptions(thread, { requestId: "r1" }),
    );
    expect(emitted).toEqual({
      notice: {
        kind: "completed",
        title: "작업이 끝났다",
        body: "본문",
        seq: 1,
        sourceType: "dialog.notified",
      },
    });
    expect(await api.list({ afterSeq: 0 }, callOptions(thread))).toEqual({
      notices: [emitted.notice],
      nextSeq: 1,
    });
  });

  test("본문이 없으면 body는 null이다", async () => {
    const { api } = setup();
    const emitted = await api.emit(
      { kind: "error", title: "실패", origin: "group.a" },
      callOptions(newThread()),
    );
    expect(emitted.notice.body).toBeNull();
  });

  test("같은 requestId의 재호출은 처음 알림을 돌려주고 기록을 늘리지 않는다", async () => {
    const { port, api } = setup();
    const thread = newThread();
    const input = { kind: "completed", title: "작업이 끝났다", origin: "group.a" } as const;
    const first = await api.emit(input, callOptions(thread, { requestId: "same" }));
    const again = await api.emit(input, callOptions(thread, { requestId: "same" }));
    expect(again).toEqual(first);
    expect(port.log).toHaveLength(1);
    const other = await api.emit(input, callOptions(thread, { requestId: "other" }));
    expect(other.notice.seq).toBe(2);
    expect(port.log).toHaveLength(2);
  });

  test("같은 requestId에 다른 내용을 보내면 internal이다", async () => {
    const { api } = setup();
    const thread = newThread();
    await api.emit(
      { kind: "completed", title: "하나", origin: "group.a" },
      callOptions(thread, { requestId: "k" }),
    );
    const failure = await rejectionOf(
      api.emit(
        { kind: "completed", title: "둘", origin: "group.a" },
        callOptions(thread, { requestId: "k" }),
      ),
    );
    expect(failure).toMatchObject({ data: { code: "internal" } });
  });

  test("스레드 문맥이 없으면 emit은 invalid_input이다", async () => {
    const { api, port } = setup();
    const failure = await rejectionOf(
      api.emit({ kind: "completed", title: "작업이 끝났다", origin: "group.a" }, {}),
    );
    expect(failure).toMatchObject({ data: { code: "invalid_input" } });
    expect(port.log).toHaveLength(0);
  });

  test("입력이 스키마를 어기면 emit과 list는 invalid_input이다", async () => {
    const { api } = setup();
    const thread = newThread();
    const emptyTitle = await rejectionOf(
      api.emit({ kind: "completed", title: "", origin: "group.a" }, callOptions(thread)),
    );
    expect(emptyTitle).toMatchObject({ data: { code: "invalid_input" } });
    const tooMany = await rejectionOf(api.list({ afterSeq: 0, limit: 501 }, callOptions(thread)));
    expect(tooMany).toMatchObject({ data: { code: "invalid_input" } });
    const negative = await rejectionOf(api.list({ afterSeq: -1 }, callOptions(thread)));
    expect(negative).toMatchObject({ data: { code: "invalid_input" } });
  });

  test("알림 저장소가 없으면 emit과 list는 unavailable이다", async () => {
    const h = harness();
    const notify = createNotifyService({ ...h.deps, notices: undefined });
    const thread = newThread();
    const emitFailure = await rejectionOf(
      notify.api.emit(
        { kind: "completed", title: "작업이 끝났다", origin: "group.a" },
        callOptions(thread),
      ),
    );
    expect(emitFailure).toMatchObject({ data: { code: "unavailable" } });
    const listFailure = await rejectionOf(notify.api.list({ afterSeq: 0 }, callOptions(thread)));
    expect(listFailure).toMatchObject({ data: { code: "unavailable" } });
  });

  test("kinds 필터는 알림 종류로 거르고 nextSeq는 훑은 마지막 seq다", async () => {
    const { port, api } = setup();
    const thread = newThread();
    port.commit(thread, "turn.completed", turnCompleted("failed", "boom"));
    port.commit(thread, "approval.requested", toolApproval(thread));
    port.commit(thread, "turn.completed", turnCompleted("completed"));
    const listed = await api.list(
      { afterSeq: 0, kinds: ["approval_waiting"] },
      callOptions(thread),
    );
    expect(listed).toEqual({
      notices: [
        {
          kind: "approval_waiting",
          title: "승인이 필요하다: bash",
          body: null,
          seq: 2,
          sourceType: "approval.requested",
        },
      ],
      nextSeq: 3,
    });
  });

  test("afterSeq와 limit으로 나눠 읽고 nextSeq에서 이어 읽는다", async () => {
    const { port, api } = setup();
    const thread = newThread();
    port.commit(thread, "turn.completed", turnCompleted("completed"));
    port.commit(thread, "turn.started", {});
    port.commit(thread, "turn.completed", turnCompleted("failed", "boom"));
    port.commit(thread, "work.goal_settled", goalSettled("met", 2));
    port.commit(thread, "turn.completed", turnCompleted("interrupted"));

    const first = await api.list({ afterSeq: 0, limit: 2 }, callOptions(thread));
    expect(first.notices.map((notice) => notice.seq)).toEqual([1, 3]);
    expect(first.nextSeq).toBe(3);

    const second = await api.list({ afterSeq: first.nextSeq, limit: 10 }, callOptions(thread));
    expect(second.notices.map((notice) => notice.seq)).toEqual([4]);
    expect(second.nextSeq).toBe(5);

    const done = await api.list({ afterSeq: second.nextSeq }, callOptions(thread));
    expect(done).toEqual({ notices: [], nextSeq: 5 });
  });

  test("기본 개수는 100이고 한 호출이 훑는 행은 제한되어 nextSeq로 이어 읽는다", async () => {
    const { port, api } = setup();
    const thread = newThread();
    for (let i = 0; i < 1000; i += 1) port.commit(thread, "turn.started", {});
    port.commit(thread, "turn.completed", turnCompleted("completed"));
    const scanned = await api.list({ afterSeq: 0 }, callOptions(thread));
    expect(scanned.notices).toEqual([]);
    expect(scanned.nextSeq).toBe(1000);
    const found = await api.list({ afterSeq: scanned.nextSeq }, callOptions(thread));
    expect(found.notices.map((notice) => notice.seq)).toEqual([1001]);

    for (let i = 0; i < LIST_DEFAULT_LIMIT; i += 1) {
      port.commit(thread, "turn.completed", turnCompleted("completed"));
    }
    const page = await api.list({ afterSeq: 1001 }, callOptions(thread));
    expect(page.notices).toHaveLength(LIST_DEFAULT_LIMIT);
    expect(page.nextSeq).toBe(1001 + LIST_DEFAULT_LIMIT);
  });

  test("스레드 문맥이 있으면 그 스레드의 이벤트만, 없으면 모든 스레드를 본다", async () => {
    const { port, api } = setup();
    const one = newThread();
    const two = newThread();
    port.commit(one, "turn.completed", turnCompleted("completed"));
    port.commit(two, "turn.completed", turnCompleted("completed"));
    const mine = await api.list({ afterSeq: 0 }, callOptions(one));
    expect(mine.notices.map((notice) => notice.seq)).toEqual([1]);
    const all = await api.list({ afterSeq: 0 }, {});
    expect(all.notices.map((notice) => notice.seq)).toEqual([1, 2]);
  });
});

describe("구독", () => {
  test("구독자는 턴 완료와 승인 요청을 파생 알림으로 받는다", async () => {
    const { port, api } = setup();
    const got: [ThreadId, Notice][] = [];
    api.subscribe({}, (threadId, notice) => {
      got.push([threadId, notice]);
    });
    const thread = newThread();
    port.commit(thread, "turn.completed", turnCompleted("completed"));
    port.commit(thread, "approval.requested", toolApproval(thread));
    expect(got).toEqual([
      [
        thread,
        {
          kind: "completed",
          title: "작업이 끝났다",
          body: null,
          seq: 1,
          sourceType: "turn.completed",
        },
      ],
      [
        thread,
        {
          kind: "approval_waiting",
          title: "승인이 필요하다: bash",
          body: null,
          seq: 2,
          sourceType: "approval.requested",
        },
      ],
    ]);
  });

  test("kinds 필터는 구독자마다 적용하고 알리지 않을 종류는 보내지 않는다", async () => {
    const { port, api } = setup();
    const approvals: Notice[] = [];
    api.subscribe({ kinds: ["approval_waiting"] }, (_threadId, notice) => {
      approvals.push(notice);
    });
    const thread = newThread();
    port.commit(thread, "turn.completed", turnCompleted("completed"));
    port.commit(thread, "turn.completed", turnCompleted("interrupted"));
    port.commit(thread, "approval.requested", toolApproval(thread));
    expect(approvals.map((notice) => notice.kind)).toEqual(["approval_waiting"]);
  });

  test("해제한 뒤에는 더 받지 않는다", async () => {
    const { port, api } = setup();
    const got: Notice[] = [];
    const unsubscribe = api.subscribe({}, (_threadId, notice) => {
      got.push(notice);
    });
    const thread = newThread();
    port.commit(thread, "turn.completed", turnCompleted("completed"));
    unsubscribe();
    port.commit(thread, "approval.requested", toolApproval(thread));
    expect(got.map((notice) => notice.kind)).toEqual(["completed"]);
  });

  test("같은 이벤트가 두 번 와도 알림은 한 번만 간다", async () => {
    const { port, notify, api } = setup();
    const got: Notice[] = [];
    api.subscribe({}, (_threadId, notice) => {
      got.push(notice);
    });
    const thread = newThread();
    const event = port.commit(thread, "approval.requested", toolApproval(thread));
    notify.onEvent(event);
    expect(got).toHaveLength(1);
  });

  test("구독자가 던져도 다른 구독자와 피드 커밋은 계속되고 실패는 로그에 남는다", async () => {
    const h = harness();
    const port = memoryNotices();
    const notify = createNotifyService({ ...h.deps, notices: port });
    port.listen((event) => {
      notify.onEvent(event);
    });
    const got: Notice[] = [];
    notify.api.subscribe({}, () => {
      throw new Error("listener bug");
    });
    notify.api.subscribe({}, (_threadId, notice) => {
      got.push(notice);
    });
    port.commit(newThread(), "turn.completed", turnCompleted("completed"));
    expect(got.map((notice) => notice.seq)).toEqual([1]);
    expect(h.lines.map((line) => line.event)).toContain("dialog.notify_listener_failed");
  });
});

describe("같은 스레드·같은 종류 묶음", () => {
  test("같은 단계의 턴 완료와 목표 달성은 구독자에게 한 번만 가고 list는 둘 다 돌려준다", async () => {
    const { port, api } = setup();
    const got: Notice[] = [];
    api.subscribe({ kinds: ["completed"] }, (_threadId, notice) => {
      got.push(notice);
    });
    const thread = newThread();
    port.commit(thread, "turn.completed", turnCompleted("completed"));
    port.commit(thread, "work.goal_settled", goalSettled("met", 1));
    expect(got).toEqual([
      {
        kind: "completed",
        title: "작업이 끝났다",
        body: null,
        seq: 1,
        sourceType: "turn.completed",
      },
    ]);
    const listed = await api.list({ afterSeq: 0 }, callOptions(thread));
    expect(listed.notices.map((notice) => notice.seq)).toEqual([1, 2]);
  });

  test("1초가 지나면 같은 종류를 다시 보내고, 묶인 알림은 창을 늘리지 않는다", async () => {
    const { h, port, api } = setup();
    const got: Notice[] = [];
    api.subscribe({}, (_threadId, notice) => {
      got.push(notice);
    });
    const thread = newThread();
    port.commit(thread, "turn.completed", turnCompleted("completed"));
    await h.timers.advance(NOTICE_COALESCE_MS / 2);
    port.commit(thread, "work.goal_settled", goalSettled("met", 1));
    expect(got.map((notice) => notice.seq)).toEqual([1]);
    await h.timers.advance(NOTICE_COALESCE_MS / 2);
    port.commit(thread, "turn.completed", turnCompleted("completed"));
    expect(got.map((notice) => notice.seq)).toEqual([1, 3]);
  });

  test("다른 종류나 다른 스레드는 묶지 않는다", async () => {
    const { port, api } = setup();
    const got: [ThreadId, Notice][] = [];
    api.subscribe({}, (threadId, notice) => {
      got.push([threadId, notice]);
    });
    const one = newThread();
    const two = newThread();
    port.commit(one, "turn.completed", turnCompleted("completed"));
    port.commit(one, "turn.completed", turnCompleted("failed", "boom"));
    port.commit(two, "turn.completed", turnCompleted("completed"));
    expect(got.map(([threadId, notice]) => [threadId === one, notice.kind])).toEqual([
      [true, "completed"],
      [true, "error"],
      [false, "completed"],
    ]);
  });

  test("agent.settled도 같은 규칙으로 묶인다", async () => {
    const { port, api } = setup();
    const got: Notice[] = [];
    api.subscribe({ kinds: ["background_completed"] }, (_threadId, notice) => {
      got.push(notice);
    });
    const thread = newThread();
    port.commit(thread, "agent.settled", agentSettled(thread, "completed", null));
    port.commit(thread, "agent.settled", agentSettled(thread, "completed", null));
    expect(got.map((notice) => notice.seq)).toEqual([1]);
  });
});

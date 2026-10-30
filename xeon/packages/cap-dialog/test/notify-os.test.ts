import { describe, expect, test } from "bun:test";
import { err, ok, type LogFields, type Logger, type Result } from "@xeon/contracts";
import type { Notice, NoticeKind } from "@xeon/contracts/capabilities";
import type {
  NotifyError,
  NotifyKind,
  OsNotification,
  OsService,
  Redactor,
} from "@xeon/contracts/services";
import type { ScopeLayer, ScopeStack } from "@xeon/contracts/settings";
import { createOsDelivery, type OsDelivery } from "../src/notify/os-delivery.ts";
import { NOTICE_COALESCE_MS, createNotifyService } from "../src/notify/service.ts";
import { readDialogSettings } from "../src/settings.ts";
import { flushTicks, harness, newThread } from "./support/harness.ts";
import { goalSettled, memoryNotices, turnCompleted } from "./support/notices.ts";

// L2.dialog.spec §4.7.2. 구독 알림을 `xeon.os`의 notify로 보낸다. 시험은 가짜 OS 서비스와 수준을 남기는 로거를 쓴다.
// 묶음 시험만 실제 알림 서비스(createNotifyService)와 수동 시계를 쓴다.

type NotifyReply = Result<void, NotifyError> | "reject";

interface Sent {
  readonly notification: OsNotification;
  readonly signal: AbortSignal;
}

interface Entry {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields | undefined;
}

/** 수준을 남기는 로거. harness의 기본 로거는 수준을 지우므로 여기서는 따로 둔다 */
function levelLogger(entries: Entry[]): Logger {
  const logger: Logger = {
    debug: (event, fields) => void entries.push({ level: "debug", event, fields }),
    info: (event, fields) => void entries.push({ level: "info", event, fields }),
    warn: (event, fields) => void entries.push({ level: "warn", event, fields }),
    error: (event, fields) => void entries.push({ level: "error", event, fields }),
    child: () => logger,
  };
  return logger;
}

/** 보낸 호출을 기록하는 `xeon.os` 대역. replies가 비면 성공이다 */
function fakeOs(replies: NotifyReply[] = []): { os: Pick<OsService, "notify">; sent: Sent[] } {
  const sent: Sent[] = [];
  const queue = [...replies];
  const success: Result<void, NotifyError> = ok(undefined);
  return {
    sent,
    os: {
      notify: (notification, signal) => {
        sent.push({ notification, signal });
        const reply = queue.shift() ?? success;
        if (reply === "reject") return Promise.reject(new Error("notifier crashed"));
        return Promise.resolve(reply);
      },
    },
  };
}

const plain: Pick<Redactor, "mask"> = { mask: (text) => ({ text, hits: [] }) };

function layer(scope: ScopeLayer["scope"], values: Record<string, unknown>): ScopeLayer {
  return { scope, values: new Map(Object.entries(values)) };
}

function notice(kind: NoticeKind, extra: Partial<Notice> = {}): Notice {
  return { kind, title: "제목", body: null, seq: 1, sourceType: "turn.completed", ...extra };
}

function warnings(entries: Entry[]): Entry[] {
  return entries.filter((entry) => entry.level === "warn");
}

interface Setup {
  readonly deliver: OsDelivery;
  readonly sent: Sent[];
  readonly entries: Entry[];
  readonly abort: AbortController;
}

function setup(
  options: {
    readonly layers?: ScopeStack;
    readonly replies?: NotifyReply[];
    readonly redactor?: Pick<Redactor, "mask">;
  } = {},
): Setup {
  const entries: Entry[] = [];
  const fake = fakeOs(options.replies);
  const abort = new AbortController();
  const layers = options.layers ?? [];
  const deliver = createOsDelivery({
    os: fake.os,
    settings: () => readDialogSettings(layers),
    redactor: options.redactor ?? plain,
    logger: levelLogger(entries),
    signal: abort.signal,
  });
  return { deliver, sent: fake.sent, entries, abort };
}

describe("종류 대응과 내용", () => {
  test("다섯 종류를 L0의 네 종류로 옮기고 제목과 본문을 그대로 넘긴다", () => {
    const { deliver, sent } = setup();
    const thread = newThread();
    const mapping: [NoticeKind, NotifyKind][] = [
      ["completed", "done"],
      ["approval_waiting", "approval"],
      ["question_waiting", "question"],
      ["error", "error"],
      ["background_completed", "done"],
    ];
    for (const [kind] of mapping) {
      deliver(thread, notice(kind, { title: `제목 ${kind}`, body: `본문 ${kind}` }));
    }
    expect(sent.map((call) => call.notification)).toEqual(
      mapping.map(([kind, osKind]) => ({
        kind: osKind,
        title: `제목 ${kind}`,
        body: `본문 ${kind}`,
        threadId: thread,
      })),
    );
  });

  test("본문이 없으면 빈 문자열을 보낸다", () => {
    const { deliver, sent } = setup();
    deliver(newThread(), notice("completed", { body: null }));
    expect(sent.map((call) => call.notification.body)).toEqual([""]);
  });

  test("제목은 80자, 본문은 400자로 자르고 자르기 전에 마스킹한다", () => {
    const masking: Pick<Redactor, "mask"> = {
      mask: (text) => ({ text: text.replaceAll("SECRET", "***"), hits: [] }),
    };
    const { deliver, sent } = setup({ redactor: masking });
    deliver(
      newThread(),
      notice("error", { title: "가".repeat(100), body: `${"a".repeat(398)}SECRET` }),
    );
    const [only] = sent;
    expect(only?.notification.title).toBe("가".repeat(80));
    // 자른 뒤에 가리면 SECRET의 앞 두 글자가 남는다. 가린 뒤에 자르면 "**"만 남는다
    expect(only?.notification.body).toBe(`${"a".repeat(398)}**`);
  });

  test("본문이 400자 이하면 그대로 보낸다", () => {
    const { deliver, sent } = setup();
    deliver(newThread(), notice("error", { body: "b".repeat(400) }));
    expect(sent[0]?.notification.body).toBe("b".repeat(400));
  });
});

describe("설정 게이트", () => {
  test("notify.os가 꺼져 있으면 어떤 종류도 보내지 않는다", () => {
    const { deliver, sent } = setup({ layers: [layer("user", { "l2.dialog.notify.os": false })] });
    deliver(newThread(), notice("completed"));
    deliver(newThread(), notice("error"));
    expect(sent).toEqual([]);
  });

  test("종류별 설정이 꺼진 종류만 보내지 않는다", () => {
    const { deliver, sent } = setup({
      layers: [
        layer("user", { "l2.dialog.notify.questionWaiting": false }),
        layer("project", { "l2.dialog.notify.backgroundCompleted": false }),
      ],
    });
    const thread = newThread();
    deliver(thread, notice("completed"));
    deliver(thread, notice("question_waiting"));
    deliver(thread, notice("background_completed"));
    deliver(thread, notice("error"));
    expect(sent.map((call) => call.notification.kind)).toEqual(["done", "error"]);
  });

  test("설정은 알림마다 대화 범위로 읽는다", () => {
    const one = newThread();
    const two = newThread();
    const fake = fakeOs();
    const deliver = createOsDelivery({
      os: fake.os,
      // 첫 대화만 OS 알림을 켠다. 둘째 대화의 층에는 notify.os가 꺼져 있다
      settings: (threadId) =>
        readDialogSettings(
          threadId === one ? [] : [layer("user", { "l2.dialog.notify.os": false })],
        ),
      redactor: plain,
      logger: levelLogger([]),
      signal: new AbortController().signal,
    });
    deliver(one, notice("completed"));
    deliver(two, notice("completed"));
    expect(fake.sent.map((call) => call.notification.threadId)).toEqual([one]);
  });
});

describe("실패 처리", () => {
  test("disabled는 디버그 로그만 남기고 경고하지 않는다", async () => {
    const { deliver, entries } = setup({ replies: [err({ kind: "disabled" })] });
    deliver(newThread(), notice("completed"));
    await flushTicks();
    expect(warnings(entries)).toEqual([]);
    expect(entries.map((entry) => `${entry.level} ${entry.event}`)).toEqual([
      "debug dialog.notify_os_disabled",
    ]);
  });

  test("unavailable은 provider와 이유 종류를 담아 경고한다", async () => {
    const { deliver, entries } = setup({
      replies: [
        err({ kind: "unavailable", provider: "os.os.notify/linux", reason: "no notify-send" }),
      ],
    });
    const thread = newThread();
    deliver(thread, notice("question_waiting"));
    await flushTicks();
    expect(warnings(entries)).toEqual([
      {
        level: "warn",
        event: "dialog.notify_os_failed",
        fields: { reason: "unavailable", provider: "os.os.notify/linux", threadId: thread },
      },
    ]);
  });

  test("failed는 provider와 code를 담아 경고한다", async () => {
    const { deliver, entries } = setup({
      replies: [err({ kind: "failed", provider: "os.os.notify/darwin", code: "exit_1" })],
    });
    deliver(newThread(), notice("error"));
    await flushTicks();
    expect(warnings(entries)).toMatchObject([
      {
        event: "dialog.notify_os_failed",
        fields: { reason: "failed", provider: "os.os.notify/darwin", code: "exit_1" },
      },
    ]);
  });

  test("cancelled는 경고를 남긴다", async () => {
    const { deliver, entries } = setup({ replies: [err({ kind: "cancelled" })] });
    deliver(newThread(), notice("approval_waiting"));
    await flushTicks();
    expect(warnings(entries)).toMatchObject([
      { event: "dialog.notify_os_failed", fields: { reason: "cancelled" } },
    ]);
  });

  test("보내기 Promise가 거부되면 잡아서 로그에 남기고 던지지 않는다", async () => {
    const { deliver, entries } = setup({ replies: ["reject"] });
    expect(() => {
      deliver(newThread(), notice("completed"));
    }).not.toThrow();
    await flushTicks();
    expect(entries.map((entry) => `${entry.level} ${entry.event}`)).toEqual([
      "error dialog.notify_os_rejected",
    ]);
  });

  test("성공하면 로그를 남기지 않는다", async () => {
    const { deliver, entries, sent } = setup();
    deliver(newThread(), notice("completed"));
    await flushTicks();
    expect(sent).toHaveLength(1);
    expect(entries).toEqual([]);
  });
});

describe("묶음과 신호", () => {
  test("같은 스레드·같은 종류의 두 알림은 1초 안에 OS에 한 번만 간다", async () => {
    const h = harness();
    const port = memoryNotices();
    const notify = createNotifyService({ ...h.deps, notices: port });
    port.listen((event) => {
      notify.onEvent(event);
    });
    const fake = fakeOs();
    notify.api.subscribe(
      {},
      createOsDelivery({
        os: fake.os,
        settings: () => readDialogSettings([]),
        redactor: plain,
        logger: levelLogger([]),
        signal: new AbortController().signal,
      }),
    );
    const thread = newThread();
    port.commit(thread, "turn.completed", turnCompleted("completed"));
    port.commit(thread, "work.goal_settled", goalSettled("met", 1));
    expect(fake.sent.map((call) => call.notification.title)).toEqual(["작업이 끝났다"]);

    await h.timers.advance(NOTICE_COALESCE_MS);
    port.commit(thread, "turn.completed", turnCompleted("completed"));
    expect(fake.sent).toHaveLength(2);
  });

  test("넘겨받은 신호를 그대로 OS 호출에 쓰고, 그 신호가 중단되면 호출도 중단 상태가 된다", () => {
    const { deliver, sent, abort } = setup();
    deliver(newThread(), notice("completed"));
    const [only] = sent;
    expect(only?.signal).toBe(abort.signal);
    expect(only?.signal.aborted).toBe(false);
    abort.abort();
    expect(only?.signal.aborted).toBe(true);
  });
});

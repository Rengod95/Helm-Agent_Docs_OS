// 소켓 알림 원천 시험: 가짜 서비스(실제 Unix 소켓, `host.hello`와 `notify.delivered`만 흉내 낸다)에 붙여
// hello 내용, 전달 값, 잘못된 알림 거르기, 끊김 뒤 다시 붙기, 답이 없거나 거절될 때의 재시도, 기다림 두 배씩과 30초 상한, 닫기를 본다.
import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import { parseJson, type Scheduler, type TimerHandle } from "@fresnel/contracts";
import { ownField } from "../../../src/main/lib/narrow.ts";
import type { PushableNotice } from "../../../src/web/push/notice-listener.ts";
import {
  createSocketNoticeSource,
  type SocketNoticeSource,
  type SocketNoticeSourceOptions,
} from "../../../src/web/push/socket-notice-source.ts";
import { cleanupTempDirs, tempDir } from "../support/fixtures.ts";
import { recordingLogger, type RecordingLogger } from "../support/logger.ts";
import { waitFor } from "../session/support.ts";
import { inOrder } from "../server/support.ts";

const THREAD_ID = "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const NOTICE_TIME = "2026-11-08T00:00:00.000Z";

const sources: SocketNoticeSource[] = [];
const services: FakeService[] = [];

afterEach(async () => {
  for (const source of sources.splice(0)) source.close();
  await Promise.all(services.splice(0).map((service) => service.close()));
  cleanupTempDirs();
});

/** `ok`는 result로 답한다. `silent`는 답하지 않는다. `error`는 오류로 답한다 */
type HelloMode = "ok" | "silent" | "error";

interface FakeService {
  readonly socketPath: string;
  /** 받은 `host.hello`의 params, 받은 순서대로 */
  readonly hellos: unknown[];
  /** 받아들인 연결 수 */
  connections(): number;
  /** 마지막 연결에 `notify.delivered`를 보낸다. `params`는 그대로 보낸다 */
  notify(params: unknown): void;
  /** 마지막 연결에 임의의 한 줄을 보낸다 */
  line(text: string): void;
  /** 모든 연결을 끊는다 */
  dropAll(): void;
  setHelloMode(mode: HelloMode): void;
  close(): Promise<void>;
}

/** 줄 단위로 읽는 가짜 서비스. `host.hello`에만 답한다 */
async function startFakeService(): Promise<FakeService> {
  const socketPath = path.join(tempDir(), "service.sock");
  const hellos: unknown[] = [];
  const sockets: Socket[] = [];
  const state: { mode: HelloMode; accepted: number } = { mode: "ok", accepted: 0 };
  const server: Server = createServer((socket) => {
    state.accepted += 1;
    sockets.push(socket);
    socket.on("error", () => undefined);
    let pending = "";
    socket.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      let at = pending.indexOf("\n");
      while (at >= 0) {
        const text = pending.slice(0, at);
        pending = pending.slice(at + 1);
        at = pending.indexOf("\n");
        const parsed = parseJson(text);
        if (!parsed.ok || ownField(parsed.value, "method") !== "host.hello") continue;
        hellos.push(ownField(parsed.value, "params"));
        const id = ownField(parsed.value, "id");
        if (state.mode === "silent") continue;
        if (state.mode === "error") {
          socket.write(
            `${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "refused" } })}\n`,
          );
          continue;
        }
        socket.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "0.1.0",
              server: { name: "fake", version: "0" },
              storeId: "store_fake",
              transport: "socket",
              features: [],
              experimental: [],
            },
          })}\n`,
        );
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      resolve();
    });
  });
  const service: FakeService = {
    socketPath,
    hellos,
    connections: () => state.accepted,
    notify(params) {
      sockets
        .at(-1)
        ?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notify.delivered", params })}\n`);
    },
    line(text) {
      sockets.at(-1)?.write(`${text}\n`);
    },
    dropAll() {
      for (const socket of sockets.splice(0)) socket.destroy();
    },
    setHelloMode(mode) {
      state.mode = mode;
    },
    async close() {
      for (const socket of sockets.splice(0)) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
  services.push(service);
  return service;
}

/** 알림 전달 한 건의 params(스키마 모양 그대로) */
function deliveredParams(
  kind: string,
  title: string,
  threadId: string | null = THREAD_ID,
): unknown {
  return {
    threadId,
    notice: {
      kind,
      title,
      body: null,
      seq: 7,
      sourceType: "dialog.notified",
      createdAt: 1_700_000_000_000,
    },
    deliveredAt: NOTICE_TIME,
  };
}

/** 원천에 듣는 자리를 하나 건다. 첫 듣기에서 연결이 시작된다 */
function listen(source: SocketNoticeSource): {
  readonly notices: PushableNotice[];
  readonly stop: () => void;
} {
  const notices: PushableNotice[] = [];
  const stop = source.onNotice((notice) => {
    notices.push(notice);
  });
  return { notices, stop };
}

function sourceFor(
  socketPath: string,
  logger: RecordingLogger,
  options: Omit<SocketNoticeSourceOptions, "socketPath" | "logger"> = {},
): SocketNoticeSource {
  const source = createSocketNoticeSource({ socketPath, logger, ...options });
  sources.push(source);
  return source;
}

function hasEvent(
  logger: RecordingLogger,
  event: string,
  field?: readonly [string, string],
): boolean {
  return logger.entries.some(
    (entry) =>
      entry.event === event && (field === undefined || entry.fields[field[0]] === field[1]),
  );
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("socket notice source", () => {
  test("sends host.hello first, then delivers each notify.delivered as title, threadId and kind", async () => {
    const service = await startFakeService();
    const logger = recordingLogger();
    const { notices } = listen(sourceFor(service.socketPath, logger));
    await waitFor("the hello to arrive", () => service.hellos.length === 1);
    expect(service.hellos[0]).toEqual({
      protocolVersion: "0.1.0",
      client: { name: "fresnel-web-push", version: expect.any(String), kind: "other" },
    });
    expect(service.hellos[0]).not.toHaveProperty("auth");

    service.notify(deliveredParams("approval_waiting", "Approve the shell command?"));
    service.notify(deliveredParams("completed", "Turn finished", null));
    await waitFor("two notices", () => notices.length === 2);
    expect(notices).toEqual([
      { kind: "approval_waiting", title: "Approve the shell command?", threadId: THREAD_ID },
      { kind: "completed", title: "Turn finished", threadId: null },
    ]);
    expect(hasEvent(logger, "push.notice_source_connected")).toBe(true);
  });

  test("a notice that does not match the contract is dropped and the next one still arrives", async () => {
    const service = await startFakeService();
    const logger = recordingLogger();
    const { notices } = listen(sourceFor(service.socketPath, logger));
    await waitFor("the hello to arrive", () => service.hellos.length === 1);
    service.notify(deliveredParams("not_a_kind", "Bad kind"));
    service.notify(deliveredParams("error", ""));
    service.notify(deliveredParams("error", "Turn failed"));
    await waitFor("the valid notice", () => notices.length === 1);
    expect(notices).toEqual([{ kind: "error", title: "Turn failed", threadId: THREAD_ID }]);
    expect(hasEvent(logger, "push.notice_source_invalid", ["reason", "notify_params"])).toBe(true);
  });

  test("a line that is not JSON does not stop the stream", async () => {
    const service = await startFakeService();
    const logger = recordingLogger();
    const { notices } = listen(sourceFor(service.socketPath, logger));
    await waitFor("the hello to arrive", () => service.hellos.length === 1);
    service.line("not json at all");
    service.notify(deliveredParams("question_waiting", "Which file?"));
    await waitFor("the notice after the bad line", () => notices.length === 1);
    expect(notices[0]?.kind).toBe("question_waiting");
    expect(hasEvent(logger, "push.notice_source_invalid", ["reason", "not_json"])).toBe(true);
  });

  test("a stopped listener gets nothing more", async () => {
    const service = await startFakeService();
    const { notices, stop } = listen(sourceFor(service.socketPath, recordingLogger()));
    await waitFor("the hello to arrive", () => service.hellos.length === 1);
    service.notify(deliveredParams("completed", "First"));
    await waitFor("the first notice", () => notices.length === 1);
    stop();
    service.notify(deliveredParams("completed", "Second"));
    await pause(40);
    expect(notices.map((notice) => notice.title)).toEqual(["First"]);
  });

  test("after the service drops the connection, it reconnects and delivers again", async () => {
    const service = await startFakeService();
    const logger = recordingLogger();
    const { notices } = listen(
      sourceFor(service.socketPath, logger, { initialBackoffMs: 10, maxBackoffMs: 20 }),
    );
    await waitFor("the first hello", () => service.hellos.length === 1);
    service.notify(deliveredParams("completed", "Before the drop"));
    await waitFor("the first notice", () => notices.length === 1);

    service.dropAll();
    await waitFor("the second hello", () => service.hellos.length === 2);
    expect(service.connections()).toBe(2);
    service.notify(deliveredParams("approval_waiting", "After the reconnect"));
    await waitFor("the notice after reconnect", () => notices.length === 2);
    expect(notices.map((notice) => notice.title)).toEqual([
      "Before the drop",
      "After the reconnect",
    ]);
    expect(hasEvent(logger, "push.notice_source_disconnected")).toBe(true);
  });

  test("a service that never answers hello is dropped after the hello timeout and retried", async () => {
    const service = await startFakeService();
    service.setHelloMode("silent");
    const logger = recordingLogger();
    listen(
      sourceFor(service.socketPath, logger, {
        helloTimeoutMs: 30,
        initialBackoffMs: 10,
        maxBackoffMs: 10,
      }),
    );
    await waitFor("a second attempt after the timeout", () => service.hellos.length >= 2);
    expect(hasEvent(logger, "push.notice_source_failed", ["reason", "hello_timeout"])).toBe(true);
    expect(hasEvent(logger, "push.notice_source_connected")).toBe(false);
  });

  test("an error answer to hello is not a connection: nothing is delivered and it is retried", async () => {
    const service = await startFakeService();
    service.setHelloMode("error");
    const logger = recordingLogger();
    const { notices } = listen(
      sourceFor(service.socketPath, logger, { initialBackoffMs: 10, maxBackoffMs: 10 }),
    );
    await waitFor("a retry after the refusal", () => service.hellos.length >= 2);
    service.notify(deliveredParams("completed", "Refused"));
    await pause(20);
    expect(hasEvent(logger, "push.notice_source_failed", ["reason", "hello_rejected"])).toBe(true);
    expect(hasEvent(logger, "push.notice_source_connected")).toBe(false);
    expect(notices).toEqual([]);
  });

  test("a missing socket path waits 1 s, then 2, 4, 8, 16 and 30 s (cap), using the injected timers", async () => {
    const delays: number[] = [];
    const pending = new Map<TimerHandle, () => void>();
    let next = 0;
    const scheduler: Scheduler = {
      setTimeout(fn, ms) {
        next += 1;
        pending.set(next, fn);
        delays.push(ms);
        return next;
      },
      clearTimeout(handle) {
        pending.delete(handle);
      },
    };
    const logger = recordingLogger();
    const source = sourceFor(path.join(tempDir(), "absent.sock"), logger, { scheduler });
    listen(source);
    const expected = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    await inOrder(
      expected.map((ms, index) => ({ index, ms })),
      async ({ index, ms }) => {
        await waitFor(`reconnect delay ${String(index + 1)}`, () => delays.length === index + 1);
        expect(delays[index]).toBe(ms);
        // 기다림이 끝난 것처럼 다시 붙게 한다. 파일이 없으므로 연결은 또 실패한다
        const fire = pending.get(index + 1);
        pending.delete(index + 1);
        fire?.();
      },
    );
    expect(hasEvent(logger, "push.notice_source_error", ["reason", "ENOENT"])).toBe(true);
    source.close();
    expect(pending.size).toBe(0);
  });

  test("close() stops for good: no reconnect is scheduled and new listeners get nothing", async () => {
    const service = await startFakeService();
    const logger = recordingLogger();
    const source = sourceFor(service.socketPath, logger, {
      initialBackoffMs: 10,
      maxBackoffMs: 10,
    });
    const { notices } = listen(source);
    await waitFor("the hello to arrive", () => service.hellos.length === 1);
    source.close();
    service.notify(deliveredParams("completed", "After close"));
    await pause(60);
    expect(notices).toEqual([]);
    expect(service.connections()).toBe(1);
    const late = listen(source);
    expect(late.notices).toEqual([]);
    source.close();
  });
});

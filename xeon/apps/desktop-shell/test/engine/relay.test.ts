import { describe, expect, test } from "bun:test";
import { attempt, err, ok } from "@fresnel/contracts";
import { ShellError } from "../../src/main/commands.ts";
import type { ShellChannel } from "../../src/main/context.ts";
import { fail, type EngineState } from "../../src/main/engine/state.ts";
import {
  ACK_STEP_BYTES,
  BACKUP_DIR_MAX_BYTES,
  CREDIT_WINDOW_BYTES,
  MAX_PENDING_LINE_BYTES,
  MAX_WRITE_BYTES,
  WRITE_QUEUE_FRAMES,
  createChannelSink,
  createCredit,
  createLineBuffer,
  createPipeWriter,
  createRelay,
  validateBackupDir,
  type Sink,
  type StdinSink,
} from "../../src/main/engine/relay.ts";

const NEWLINE_CODE = 0x0a;
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
/** 줄 버퍼가 낸 결과를 글로 읽는다. 완성된 줄이 없으면 null */
const asText = (bytes: Uint8Array | null): string | null => (bytes === null ? null : dec(bytes));
/** 기다리는 비동기 작업이 진행될 만큼 한 번 양보한다(실제 대기는 0ms) */
const settle = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, 0);
  });
/** `size` 바이트짜리 조각. 마지막 바이트는 `\n`이다 */
function line(size: number): Uint8Array {
  const bytes = new Uint8Array(size).fill(0x78);
  bytes[size - 1] = NEWLINE_CODE;
  return bytes;
}
/** `run`이 던진 ShellError의 payload. 던지지 않았으면 문자열 "no throw"다 */
function payloadThrownBy(run: () => void): unknown {
  const outcome = attempt(run);
  if (outcome.ok) return "no throw";
  return outcome.error.cause instanceof ShellError
    ? outcome.error.cause.payload
    : "not a ShellError";
}

interface FakeSink extends Sink {
  readonly bytes: Uint8Array[];
  readonly states: EngineState[];
  /** true이면 다음 전송부터 닫힌 것으로 답한다(페이지가 사라졌다) */
  closed: boolean;
}

function fakeSink(): FakeSink {
  const sink: FakeSink = {
    bytes: [],
    states: [],
    closed: false,
    sendBytes(bytes) {
      if (sink.closed) return err({ kind: "sink-closed", cause: "closed" });
      sink.bytes.push(bytes);
      return ok(undefined);
    },
    sendState(state) {
      if (sink.closed) return err({ kind: "sink-closed", cause: "closed" });
      sink.states.push(state);
      return ok(undefined);
    },
  };
  return sink;
}

/** 받은 바이트를 글로 모은다 */
function received(sink: FakeSink): string {
  return sink.bytes.map((bytes) => dec(bytes)).join("");
}

interface FakeStdin extends StdinSink {
  written(): string;
  isClosed(): boolean;
  /** 막힌 쓰기를 푼다 */
  open(): void;
}

/** 쓰기를 기록하는 가짜 stdin. `startsOpen`이 거짓이면 `open()`을 부를 때까지 쓰기가 막힌다 */
function fakeStdin(startsOpen: boolean): FakeStdin {
  const chunks: string[] = [];
  let closed = false;
  const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();
  const stdin: FakeStdin = {
    async write(bytes) {
      await gate;
      chunks.push(dec(bytes));
    },
    close() {
      closed = true;
    },
    written: () => chunks.join(""),
    isClosed: () => closed,
    open() {
      openGate();
    },
  };
  if (startsOpen) stdin.open();
  return stdin;
}

describe("constants", () => {
  test("keep the values and the invariants that relay.rs asserts at compile time", () => {
    expect([
      CREDIT_WINDOW_BYTES,
      ACK_STEP_BYTES,
      MAX_PENDING_LINE_BYTES,
      MAX_WRITE_BYTES,
      BACKUP_DIR_MAX_BYTES,
      WRITE_QUEUE_FRAMES,
    ]).toEqual([4_194_304, 262_144, 2_097_152, 2_097_152, 4096, 16]);
    expect(CREDIT_WINDOW_BYTES).toBeGreaterThanOrEqual(4 * ACK_STEP_BYTES);
    expect(MAX_PENDING_LINE_BYTES).toBeGreaterThanOrEqual(1_048_576);
  });
});

const buf = () => createLineBuffer(MAX_PENDING_LINE_BYTES);
const newRelay = () => createRelay({ kind: "stopped" });

describe("line buffer", () => {
  test("holds the tail until the newline arrives", () => {
    const buffer = buf();
    expect(asText(buffer.push(enc('{"a":')))).toBeNull();
    expect(asText(buffer.push(enc('1}\n{"b"')))).toBe('{"a":1}\n');
    expect(asText(buffer.push(enc(":2}\n")))).toBe('{"b":2}\n');
    expect(buffer.finish()).toEqual({ tailBytes: 0, overflowed: 0 });
  });

  test("returns several lines in one batch", () => {
    const buffer = buf();
    expect(asText(buffer.push(enc("a\nb\nc")))).toBe("a\nb\n");
    expect(asText(buffer.push(enc("d\n")))).toBe("cd\n");
  });

  test("passes a whole chunk without copying", () => {
    const buffer = buf();
    const chunk = enc("x\ny\n");
    expect(buffer.push(chunk)).toBe(chunk);
  });

  test("finish reports the dropped tail", () => {
    const buffer = buf();
    expect(buffer.push(enc("half a fra"))).toBeNull();
    expect(buffer.finish()).toEqual({ tailBytes: 10, overflowed: 0 });
  });

  test("separate buffers per generation keep a dead tail from gluing", () => {
    const old = buf();
    expect(old.push(enc('{"id":"1","resu'))).toBeNull();
    expect(old.finish().tailBytes).toBe(15);
    const next = buf();
    expect(asText(next.push(enc('{"id":"2"}\n')))).toBe('{"id":"2"}\n');
  });

  test("a single shared buffer would glue the old tail to the new line", () => {
    // 비교군: 세대를 나누지 않으면 새 세대의 첫 줄이 꼬리와 붙는다
    const shared = buf();
    expect(shared.push(enc('{"id":"1","resu'))).toBeNull();
    expect(asText(shared.push(enc('{"id":"2"}\n')))).toBe('{"id":"1","resu{"id":"2"}\n');
  });

  test("a new listener drops the partial line through the next newline", () => {
    const buffer = buf();
    expect(buffer.push(enc("head-of-frame "))).toBeNull();
    buffer.discardPartial();
    // 앞부분을 못 본 줄의 나머지는 다음 \n까지 버린다
    expect(asText(buffer.push(enc('rest\n{"ok":1}\n')))).toBe('{"ok":1}\n');
  });

  test("a new listener skips across chunks that have no newline", () => {
    const buffer = buf();
    buffer.push(enc("head "));
    buffer.discardPartial();
    expect(buffer.push(enc("middle "))).toBeNull();
    expect(asText(buffer.push(enc("end\nnext\n")))).toBe("next\n");
  });

  test("a new listener at a line boundary skips nothing", () => {
    const buffer = buf();
    buffer.push(enc("whole\n"));
    buffer.discardPartial();
    expect(asText(buffer.push(enc("fresh\n")))).toBe("fresh\n");
  });

  test("an overlong line is dropped and resynchronizes at the next newline", () => {
    const buffer = createLineBuffer(16);
    expect(buffer.push(enc("x".repeat(10)))).toBeNull();
    // 20 > 16: 버린다
    expect(buffer.push(enc("x".repeat(10)))).toBeNull();
    expect(asText(buffer.push(enc("tail\nok\n")))).toBe("ok\n");
    expect(buffer.finish()).toEqual({ tailBytes: 0, overflowed: 1 });
  });

  test("the newline search looks only at the new chunk, and the result keeps every byte", () => {
    const buffer = buf();
    for (let i = 0; i < 512; i += 1) {
      expect(buffer.push(enc("a".repeat(2048)))).toBeNull();
    }
    const last = enc(`${"b".repeat(100)}\n`);
    const out = buffer.push(last);
    expect(out?.length).toBe(512 * 2048 + 101);
  });
});

describe("credit", () => {
  test("allows until the window is exceeded, then waits for an ack", async () => {
    const credit = createCredit(100);
    expect(await credit.acquire(60)).toEqual(ok(undefined));
    expect(await credit.acquire(60)).toEqual(ok(undefined));
    expect(credit.outstanding()).toBe(120);
    // 120 > 100: 다음 송신은 확인을 기다린다
    let passed = false;
    const waiting = credit.acquire(1).then((outcome) => {
      passed = true;
      return outcome;
    });
    await settle();
    expect(passed).toBe(false);
    credit.ack(30); // 90 <= 100
    expect(await waiting).toEqual(ok(undefined));
    expect(credit.outstanding()).toBe(91);
  });

  test("an ack never exceeds what was sent", async () => {
    const credit = createCredit(10);
    expect(await credit.acquire(5)).toEqual(ok(undefined));
    credit.ack(1_000_000);
    expect(credit.outstanding()).toBe(0);
    // 미확인이 0이면 창보다 큰 묶음도 지나간다
    expect(await credit.acquire(100)).toEqual(ok(undefined));
    expect(credit.outstanding()).toBe(100);
  });

  test("closing releases waiters with an error", async () => {
    const credit = createCredit(0);
    expect(await credit.acquire(10)).toEqual(ok(undefined));
    const waiting = credit.acquire(1);
    await settle();
    credit.close();
    expect(await waiting).toEqual(err({ kind: "credit-closed" }));
  });
});

describe("relay", () => {
  test("forwards only complete lines", async () => {
    const relay = newRelay();
    const sink = fakeSink();
    expect(relay.attach(sink).epoch).toBe(1);
    const stream = relay.openStream();
    await stream.push(enc('{"a":1}\n{"b"'));
    expect(received(sink)).toBe('{"a":1}\n');
    await stream.push(enc(":2}\n"));
    expect(received(sink)).toBe('{"a":1}\n{"b":2}\n');
    expect(stream.finish()).toEqual({
      forwardedBytes: 16,
      droppedBytes: 0,
      droppedTailBytes: 0,
      overflowedLines: 0,
    });
  });

  test("drops the tail of an engine generation that ended", async () => {
    const relay = newRelay();
    const sink = fakeSink();
    relay.attach(sink);
    const old = relay.openStream();
    await old.push(enc('{"id":"1","resu'));
    expect(old.finish().droppedTailBytes).toBe(15);
    const next = relay.openStream();
    await next.push(enc('{"id":"2"}\n'));
    expect(received(sink)).toBe('{"id":"2"}\n');
  });

  test("drops complete lines while nothing is attached", async () => {
    const relay = newRelay();
    const stream = relay.openStream();
    await stream.push(enc("lost\n"));
    const sink = fakeSink();
    relay.attach(sink);
    await stream.push(enc("kept\n"));
    expect(received(sink)).toBe("kept\n");
    expect(stream.finish().droppedBytes).toBe(5);
  });

  test("attach assigns increasing epochs and cuts the old listener", async () => {
    const relay = newRelay();
    const first = fakeSink();
    const second = fakeSink();
    expect(relay.attach(first).epoch).toBe(1);
    const stream = relay.openStream();
    await stream.push(enc("one\n"));
    expect(relay.attach(second).epoch).toBe(2);
    expect(relay.currentEpoch()).toBe(2);
    await stream.push(enc("two\n"));
    expect(received(first)).toBe("one\n");
    expect(received(second)).toBe("two\n");
  });

  test("a page reload in the middle of a frame discards that frame", async () => {
    const relay = newRelay();
    const first = fakeSink();
    const second = fakeSink();
    relay.attach(first);
    const stream = relay.openStream();
    await stream.push(enc('{"id":"1","res'));
    relay.attach(second);
    await stream.push(enc('ult":1}\n{"id":"2"}\n'));
    expect(received(first)).toBe("");
    expect(received(second)).toBe('{"id":"2"}\n');
  });

  test("a stale epoch is rejected for writes, acks and detach", () => {
    const relay = newRelay();
    relay.attach(fakeSink());
    relay.attach(fakeSink());
    expect(relay.checkEpoch(1)).toBe("epoch-stale");
    expect(relay.checkEpoch(0)).toBe("epoch-stale");
    expect(relay.checkEpoch(2)).toBeNull();
    expect(relay.ack(1, 10)).toBe(false);
    expect(relay.detach(1)).toBe(false);
    expect(relay.checkEpoch(2)).toBeNull();
    expect(relay.detach(2)).toBe(true);
    expect(relay.checkEpoch(2)).toBe("epoch-stale");
  });

  test("credit backpressure stalls the reader until an ack releases it", async () => {
    const relay = newRelay();
    const sink = fakeSink();
    const { epoch } = relay.attach(sink);
    const windowBytes = CREDIT_WINDOW_BYTES;
    let pushed = 0;
    const reading = (async () => {
      const stream = relay.openStream();
      // 창을 넘길 때까지 보내고, 그다음 묶음에서 멈춘다
      await stream.push(line(windowBytes)); // 미확인 0: 통과
      pushed += 1;
      await stream.push(line(windowBytes)); // 미확인 = 창: 통과
      pushed += 1;
      await stream.push(line(1024)); // 미확인 = 2 * 창: 대기
      pushed += 1;
      return stream.finish();
    })();
    await settle();
    expect(sink.bytes.length).toBe(2);
    expect(pushed).toBe(2);
    relay.ack(epoch, ACK_STEP_BYTES * 2);
    await settle();
    expect(sink.bytes.length).toBe(2); // 아직 창 위
    relay.ack(epoch, windowBytes);
    expect(await reading).toEqual({
      forwardedBytes: 2 * windowBytes + 1024,
      droppedBytes: 0,
      droppedTailBytes: 0,
      overflowedLines: 0,
    });
    expect(sink.bytes.length).toBe(3);
  });

  test("re-attaching releases a stalled reader and drops its batch", async () => {
    const relay = newRelay();
    const first = fakeSink();
    relay.attach(first);
    const windowBytes = CREDIT_WINDOW_BYTES;
    const reading = (async () => {
      const stream = relay.openStream();
      // 한 묶음이 창의 두 배: 통과
      await stream.push(line(2 * windowBytes + 1));
      // 대기
      await stream.push(enc("stalled\n"));
      return stream.finish();
    })();
    await settle();
    expect(first.bytes.length).toBe(1);
    const second = fakeSink();
    relay.attach(second);
    expect((await reading).droppedBytes).toBe(8);
    expect(second.bytes.length).toBe(0);
  });

  test("drain releases a stalled reader, and later bytes are dropped", async () => {
    const relay = newRelay();
    const sink = fakeSink();
    relay.attach(sink);
    const windowBytes = CREDIT_WINDOW_BYTES;
    const reading = (async () => {
      const stream = relay.openStream();
      await stream.push(line(2 * windowBytes + 1));
      await stream.push(enc("stalled\n"));
      await stream.push(enc("after\n"));
      return stream.finish();
    })();
    await settle();
    relay.beginDrain();
    expect((await reading).droppedBytes).toBe(8 + 6);
    // 종료 중에 붙은 페이지도 바이트를 받지 못한다
    const late = fakeSink();
    relay.attach(late);
    const stream = relay.openStream();
    await stream.push(enc("x\n"));
    expect(late.bytes.length).toBe(0);
  });

  test("a closed sink detaches itself", async () => {
    const relay = newRelay();
    const sink = fakeSink();
    const attachment = relay.attach(sink);
    sink.closed = true;
    const stream = relay.openStream();
    await stream.push(enc("a\n"));
    expect(relay.checkEpoch(attachment.epoch)).toBe("epoch-stale");
  });

  test("state changes reach the attached page, and attach returns the latest", () => {
    const relay = newRelay();
    relay.setState({ kind: "stopping" });
    const sink = fakeSink();
    expect(relay.attach(sink)).toEqual({ epoch: 1, state: { kind: "stopping" } });
    relay.setState({ kind: "stopped" });
    expect(sink.states).toEqual([{ kind: "stopped" }]);
    expect(relay.state()).toEqual({ kind: "stopped" });
  });
});

describe("channel sink", () => {
  test("sends bytes as a Uint8Array and the state object as it is", () => {
    const bytesSent: unknown[] = [];
    const stateSent: unknown[] = [];
    const sink = createChannelSink(
      {
        send: (message) => {
          bytesSent.push(message);
        },
      },
      {
        send: (message) => {
          stateSent.push(message);
        },
      },
    );
    expect(sink.sendBytes(enc("a\n"))).toEqual(ok(undefined));
    expect(sink.sendState({ kind: "stopped" })).toEqual(ok(undefined));
    expect(bytesSent).toEqual([enc("a\n")]);
    expect(bytesSent[0]).toBeInstanceOf(Uint8Array);
    expect(stateSent).toEqual([{ kind: "stopped" }]);
  });

  test("a channel that throws reports sink-closed", () => {
    const closed: ShellChannel = {
      send: () => {
        throw new Error("webContents destroyed");
      },
    };
    const sink = createChannelSink(closed, closed);
    expect(sink.sendBytes(enc("a\n"))).toMatchObject({ ok: false, error: { kind: "sink-closed" } });
    expect(sink.sendState({ kind: "stopped" })).toMatchObject({
      ok: false,
      error: { kind: "sink-closed" },
    });
  });
});

describe("stdin pipe writer", () => {
  test("writes frames in order and closes stdin after the queue", async () => {
    const stdin = fakeStdin(true);
    const pipe = createPipeWriter(stdin, 4);
    expect(await pipe.writeFrame(enc("a\n"))).toEqual(ok(undefined));
    expect(await pipe.writeFrame(enc("b\n"))).toEqual(ok(undefined));
    expect(await pipe.closeWrite()).toEqual(ok(undefined));
    await pipe.finished;
    expect(stdin.written()).toBe("a\nb\n");
    expect(stdin.isClosed()).toBe(true);
    expect(await pipe.writeFrame(enc("c\n"))).toEqual(err({ kind: "pipe-closed" }));
  });

  test("a shell frame first terminates a broken line", async () => {
    const stdin = fakeStdin(true);
    const pipe = createPipeWriter(stdin, 4);
    await pipe.writeFrame(enc('{"half":'));
    await pipe.writeShellFrame(enc('{"shutdown":1}\n'));
    await pipe.closeWrite();
    await pipe.finished;
    expect(stdin.written()).toBe('{"half":\n{"shutdown":1}\n');
  });

  test("a shell frame adds no newline at a line boundary", async () => {
    const stdin = fakeStdin(true);
    const pipe = createPipeWriter(stdin, 4);
    await pipe.writeFrame(enc("x\n"));
    await pipe.writeShellFrame(enc("y\n"));
    await pipe.closeWrite();
    await pipe.finished;
    expect(stdin.written()).toBe("x\ny\n");
  });

  test("a blocked stdin write does not block other tasks, and a full queue makes only the sender wait", async () => {
    const stdin = fakeStdin(false);
    const pipe = createPipeWriter(stdin, 2);
    // 첫 조각은 쓰기 루프가 가져가 막힌 쓰기에 머문다. 뒤의 두 조각이 대기열(2)을 채운다
    await pipe.writeFrame(enc("1\n"));
    await pipe.writeFrame(enc("2\n"));
    await pipe.writeFrame(enc("3\n"));
    let fourthDone = false;
    const fourth = pipe.writeFrame(enc("4\n")).then((outcome) => {
      fourthDone = true;
      return outcome;
    });
    await settle();
    expect(fourthDone).toBe(false);
    expect(stdin.written()).toBe("");
    stdin.open();
    expect(await fourth).toEqual(ok(undefined));
    await pipe.closeWrite();
    await pipe.finished;
    expect(stdin.written()).toBe("1\n2\n3\n4\n");
  });

  test("a failed stdin write closes the pipe and reports the cause to later writes", async () => {
    let closed = false;
    const failing: StdinSink = {
      write: () => Promise.reject(new Error("EPIPE")),
      close: () => {
        closed = true;
      },
    };
    const pipe = createPipeWriter(failing, 4);
    expect(await pipe.writeFrame(enc("a\n"))).toEqual(ok(undefined));
    await pipe.finished;
    expect(closed).toBe(true);
    expect(await pipe.writeFrame(enc("b\n"))).toMatchObject({
      ok: false,
      error: { kind: "write-failed", cause: { kind: "threw" } },
    });
  });
});

describe("backup dir and command errors", () => {
  test("the backup dir is checked for shape only, with bytes counted", () => {
    expect(validateBackupDir("/backups/2026-11-04")).toBeNull();
    expect(validateBackupDir("a".repeat(BACKUP_DIR_MAX_BYTES))).toBeNull();
    // 길이는 바이트로 잰다. 한글 1365자는 4095바이트, 1366자는 4098바이트다
    expect(validateBackupDir("가".repeat(1365))).toBeNull();
    expect(validateBackupDir("가".repeat(1366))).toBe("bad-request");
    for (const bad of ["", "   ", "\t", "/tmp/a\u0000b"]) {
      expect(validateBackupDir(bad)).toBe("bad-request");
    }
    expect(validateBackupDir("a".repeat(BACKUP_DIR_MAX_BYTES + 1))).toBe("bad-request");
  });

  test("the restore and restart refusals carry their kebab-case codes", () => {
    expect(payloadThrownBy(() => fail("remote-target"))).toBe("remote-target");
    expect(payloadThrownBy(() => fail("busy"))).toBe("busy");
    expect(payloadThrownBy(() => fail("not-confirmed"))).toBe("not-confirmed");
  });
});

// 큰 줄의 조각 전송(AGE-59)을 감독 수준에서 시험한다. 자식 대역은 실제 프레이밍으로 말하는 `transfer-peer.ts`다.
// 값은 길이와 SHA-256으로 비교한다. 협상 값, 실패 종류, 시계, 기록의 내용(본문과 해시가 없다)을 본다.
import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { err, repeatAsync, type Logger } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import {
  PLUGIN_HOST_MAX_FRAME_BYTES,
  PLUGIN_HOST_PROTOCOL_VERSION,
  PLUGIN_HOST_TRANSFER_PART_CHARS,
  type HostInitParams,
  type PluginHostError,
} from "@fresnel/contracts/extensions";
import {
  createPluginHostSupervisor,
  type CallError,
  type PluginHostSupervisor,
} from "../../src/isolation/supervisor.ts";
import { createManualClock, type ManualClock } from "./support/fake-process.ts";
import {
  createTransferPeerPort,
  type TransferPeer,
  type TransferPeerPort,
} from "./support/transfer-peer.ts";

const MIB = 1024 * 1024;
/** 로그에 들어가면 안 되는 표지. 본문 안에 넣어 기록을 뒤진다 */
const MARKER = "PAYLOAD-MARKER-7f3a9c";

const INIT: HostInitParams = {
  protocolVersion: PLUGIN_HOST_PROTOCOL_VERSION,
  extension: "transfer-test",
  versionId: "transfer-test-1",
  manifest: {},
  root: "/nonexistent-root",
  entry: "./entry.ts",
  settings: {},
};

function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function lengthOf(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** 시험의 값. 앞에 표지를 두어 기록에 본문이 새는지 본다 */
function payloadOf(bytes: number, unit: string): string {
  const head = `${MARKER} `;
  const body = unit.repeat(Math.ceil((bytes - head.length) / unit.length));
  return head + body;
}

/** 로그 기록. 이벤트 이름과 필드를 글로 모은다(본문이 들어갔는지 뒤진다) */
function capturing(lines: string[]): Logger {
  const logger: Logger = {
    debug: (event, fields) => {
      lines.push(JSON.stringify({ event, fields: fields ?? null }));
    },
    info: (event, fields) => {
      lines.push(JSON.stringify({ event, fields: fields ?? null }));
    },
    warn: (event, fields) => {
      lines.push(JSON.stringify({ event, fields: fields ?? null }));
    },
    error: (event, fields) => {
      lines.push(JSON.stringify({ event, fields: fields ?? null }));
    },
    child: () => logger,
  };
  return logger;
}

interface Rig {
  readonly sup: PluginHostSupervisor;
  readonly port: TransferPeerPort;
  readonly clock: ManualClock;
  readonly logs: string[];
  readonly restarts: number[];
}

function rigOf(options: {
  readonly engineMax?: number | undefined;
  readonly childMax?: number | undefined;
  readonly stallMs?: number;
}): Rig {
  const clock = createManualClock();
  const logs: string[] = [];
  const restarts: number[] = [];
  const port = createTransferPeerPort({
    decls: [],
    ...(options.childMax === undefined ? {} : { childMax: options.childMax }),
  });
  const engineMax = options.engineMax;
  const sup = createPluginHostSupervisor({
    process: port,
    specOf: () => ({
      command: "plugin-host",
      args: [],
      readRoot: "/nonexistent-root",
      env: {},
      label: "ext:transfer-test:1",
    }),
    setTimer: clock.setTimer,
    now: clock.now,
    logger: capturing(logs),
    initParams: () => INIT,
    initTimeoutMs: 1000,
    killGraceMs: 10,
    onEngineCall: () =>
      Promise.resolve(err<PluginHostError>({ kind: "unknown_target", message: "none" })),
    onRestartLimit: (info) => {
      restarts.push(info.deaths);
    },
    ...(engineMax === undefined ? {} : { transferMaxBytes: () => engineMax }),
    ...(options.stallMs === undefined ? {} : { transferStallMs: options.stallMs }),
  });
  return { sup, port, clock, logs, restarts };
}

/** 대기 중인 약속이 풀릴 시간을 준다(시계는 옮기지 않는다) */
async function turn(times = 20): Promise<void> {
  let left = times;
  await repeatAsync<void>(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    left -= 1;
    return left <= 0 ? { value: undefined } : undefined;
  });
}

/** 조건이 참이 될 때까지 차례로 돌린다. 끝까지 안 되면 거짓을 돌려준다 */
async function until(done: () => boolean, rounds = 2000): Promise<boolean> {
  let left = rounds;
  return repeatAsync<boolean>(async () => {
    if (done()) return { value: true };
    left -= 1;
    if (left <= 0) return { value: done() };
    await new Promise<void>((resolve) => setImmediate(resolve));
    return undefined;
  });
}

/** 엔진이 보내지 못하고 거절하는 값. 자식에게 요청이 가지 않는다 */
async function refused(rig: Rig, text: string): Promise<CallError | undefined> {
  const outcome = await rig.sup.call("hook.invoke", { text });
  return outcome.ok ? undefined : outcome.error;
}

/** 지금 떠 있는 대역. 죽은 뒤 다시 띄운 것이 생기기까지 기다린다 */
async function alivePeer(rig: Rig): Promise<TransferPeer> {
  await until(() => rig.port.peers.some((peer) => peer.alive()));
  const alive = rig.port.peers.filter((peer) => peer.alive());
  const peer = alive[alive.length - 1];
  if (peer === undefined) throw new Error("no live peer");
  return peer;
}

/** 값 하나를 `call`로 보내고 자식이 길이와 해시를 답하게 한다. 답은 길이와 해시다 */
async function echoDigest(rig: Rig, text: string): Promise<JsonValue | CallError> {
  const pending = rig.sup.call("hook.invoke", { text });
  const peer = await alivePeer(rig);
  const request = await peer.next("hook.invoke");
  const received = textOf(request.params);
  peer.reply(request.id, { length: lengthOf(received), sha256: sha256Of(received) });
  const outcome = await pending;
  return outcome.ok ? outcome.value : outcome.error;
}

function textOf(params: unknown): string {
  if (typeof params !== "object" || params === null || !("text" in params)) return "";
  return typeof params.text === "string" ? params.text : "";
}

/** 조각 전송의 시작 줄과 조각 줄을 만든다. `frameKind`가 있으면 시작 알림에 싣는다 */
function beginLine(input: {
  readonly x: number;
  readonly size: number;
  readonly parts: number;
  readonly sha256: string;
  readonly frameId: number;
  readonly frameKind: "request" | "response";
}): string {
  return JSON.stringify({ method: "frame.begin", params: input });
}

function partLine(x: number, i: number, data: string): string {
  return JSON.stringify({ method: "frame.part", params: { x, i, data } });
}

/** 조각 글을 시작 알림 없이 자른다: 조각 글자 단위 구간 */
function spansOf(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (let start = 0; start < text.length; start += PLUGIN_HOST_TRANSFER_PART_CHARS) {
    spans.push([start, Math.min(text.length, start + PLUGIN_HOST_TRANSFER_PART_CHARS)]);
  }
  return spans;
}

/** 2.5 MiB 글(세 조각)을 준비한다. 조각 시험의 공통 값 */
const THREE_PART_TEXT = `${MARKER}${"x".repeat(2_500_000)}`;

test("a request over the one-line limit goes out as a transfer and the child reads the same length and sha256", async () => {
  const rig = rigOf({ engineMax: 512 * MIB, childMax: 512 * MIB });
  expect(await rig.sup.start()).toMatchObject({ ok: true });
  const ascii = payloadOf(20 * MIB, "a");
  const korean = payloadOf(21 * MIB, "가");

  expect(await echoDigest(rig, ascii)).toEqual({
    length: lengthOf(ascii),
    sha256: sha256Of(ascii),
  });
  expect(await echoDigest(rig, korean)).toEqual({
    length: lengthOf(korean),
    sha256: sha256Of(korean),
  });
  expect(rig.port.peers[0]?.received()).toContain('"method":"frame.begin"');
  expect(rig.logs.join("")).not.toContain(MARKER);
});

test("a request under the one-line limit is one line and no transfer is started", async () => {
  const rig = rigOf({ engineMax: 512 * MIB, childMax: 512 * MIB });
  await rig.sup.start();
  const text = payloadOf(15 * MIB, "b");
  expect(await echoDigest(rig, text)).toEqual({ length: lengthOf(text), sha256: sha256Of(text) });
  expect(rig.port.peers[0]?.received()).not.toContain('"method":"frame.begin"');
});

test("the child's reply over the one-line limit comes back as a transfer and the engine reads it whole", async () => {
  const rig = rigOf({ engineMax: 512 * MIB, childMax: 512 * MIB });
  await rig.sup.start();
  const pending = rig.sup.call("hook.invoke", {});
  const peer = rig.port.peers[0];
  if (peer === undefined) throw new Error("no peer");
  const request = await peer.next("hook.invoke");
  const big = payloadOf(20 * MIB, "가");
  peer.send({ id: request.id, result: big });
  const outcome = await pending;
  expect(outcome).toEqual({ ok: true, value: big });
  expect(lengthOf(big)).toBeGreaterThan(PLUGIN_HOST_MAX_FRAME_BYTES);
  expect(peer.writeErrors()).toEqual([]);
  expect(rig.logs.join("")).not.toContain(MARKER);
});

test("the negotiated limit is the smaller of the engine's and the child's, and a value above it is refused whole", async () => {
  const rig = rigOf({ engineMax: 64 * MIB, childMax: 32 * MIB });
  await rig.sup.start();
  expect(rig.sup.transferLimit()).toBe(32 * MIB);
  const over = payloadOf(40 * MIB, "c");
  expect(await refused(rig, over)).toMatchObject({ kind: "frame_too_large" });
  expect(rig.port.peers[0]?.received()).not.toContain('"method":"frame.begin"');
  expect(rig.logs.join("")).not.toContain(MARKER);
});

test("an engine without a transfer limit sends no transfer option and refuses a large request as frame_too_large", async () => {
  const rig = rigOf({ childMax: 512 * MIB });
  await rig.sup.start();
  expect(rig.sup.transferLimit()).toBeUndefined();
  expect(rig.port.peers[0]?.received()).not.toContain('"transfer"');
  const text = payloadOf(20 * MIB, "d");
  expect(await refused(rig, text)).toMatchObject({ kind: "frame_too_large" });
  expect(rig.port.peers[0]?.received()).not.toContain('"method":"frame.begin"');
});

test("an old child that does not answer the transfer option keeps the one-line limit", async () => {
  const rig = rigOf({ engineMax: 512 * MIB });
  await rig.sup.start();
  expect(rig.sup.transferLimit()).toBeUndefined();
  const text = payloadOf(20 * MIB, "e");
  expect(await refused(rig, text)).toMatchObject({ kind: "frame_too_large" });
  expect(rig.port.peers[0]?.received()).not.toContain('"method":"frame.begin"');
});

test("before the first start the expected limit is the engine's value capped by the child's cap (128 MiB)", async () => {
  // 엔진 값이 자식 상한보다 크면 자식 상한이 이긴다(PLUGIN_HOST_CHILD_TRANSFER_MAX_BYTES)
  const capped = rigOf({ engineMax: 512 * MIB });
  expect(capped.sup.transferLimit()).toBe(128 * MIB);
  // 엔진 값이 작으면 엔진 값이 이긴다
  const smaller = rigOf({ engineMax: 64 * MIB });
  expect(smaller.sup.transferLimit()).toBe(64 * MIB);
  const off = rigOf({});
  expect(off.sup.transferLimit()).toBeUndefined();
});

// 깨진 전송: 자식이 답을 조각으로 보내는데 조각이 어긋난다. 호출은 `invalid_response`로 끝나고, 프로세스는 살아 있고, 다음 호출은 된다.
interface BrokenCase {
  readonly name: string;
  readonly reason: string;
  /** 엔진 쪽 상한. 없으면 512 MiB */
  readonly engineMax?: number;
  /** 요청 id와 조각 시험의 본문으로 줄들을 만든다 */
  readonly lines: (id: number, text: string) => string[];
}

const SHA = sha256Of(THREE_PART_TEXT);
const SPANS = spansOf(THREE_PART_TEXT);
const SIZE = lengthOf(THREE_PART_TEXT);

function partsOf(order: readonly number[]): string[] {
  return order.map((i) => {
    const span = SPANS[i];
    if (span === undefined) throw new Error("no span");
    return partLine(0, i, THREE_PART_TEXT.slice(span[0], span[1]));
  });
}

const BROKEN: readonly BrokenCase[] = [
  {
    name: "a missing part",
    reason: "order",
    lines: (id) => [
      beginLine({ x: 0, size: SIZE, parts: 3, sha256: SHA, frameId: id, frameKind: "response" }),
      ...partsOf([0, 2]),
    ],
  },
  {
    name: "a duplicated part",
    reason: "order",
    lines: (id) => [
      beginLine({ x: 0, size: SIZE, parts: 3, sha256: SHA, frameId: id, frameKind: "response" }),
      ...partsOf([0, 0, 1]),
    ],
  },
  {
    name: "parts out of order",
    reason: "order",
    lines: (id) => [
      beginLine({ x: 0, size: SIZE, parts: 3, sha256: SHA, frameId: id, frameKind: "response" }),
      ...partsOf([1, 0, 2]),
    ],
  },
  {
    name: "a hash that does not match",
    reason: "hash",
    lines: (id) => [
      beginLine({
        x: 0,
        size: SIZE,
        parts: 3,
        sha256: "0".repeat(64),
        frameId: id,
        frameKind: "response",
      }),
      ...partsOf([0, 1, 2]),
    ],
  },
  {
    name: "a size that does not match",
    reason: "size",
    lines: (id) => [
      beginLine({
        x: 0,
        size: SIZE + 1,
        parts: 3,
        sha256: SHA,
        frameId: id,
        frameKind: "response",
      }),
      ...partsOf([0, 1, 2]),
    ],
  },
  {
    name: "a size above the engine's limit",
    reason: "too_large",
    engineMax: 32 * MIB,
    lines: (id) => [
      beginLine({
        x: 0,
        size: 40 * MIB,
        parts: 14,
        sha256: SHA,
        frameId: id,
        frameKind: "response",
      }),
    ],
  },
];

for (const broken of BROKEN) {
  test(`a reply with ${broken.name} fails the call as invalid_response and the child stays alive for the next call`, async () => {
    const rig = rigOf({ engineMax: broken.engineMax ?? 512 * MIB, childMax: 512 * MIB });
    await rig.sup.start();
    const pending = rig.sup.call("hook.invoke", { text: "first" });
    const peer = rig.port.peers[0];
    if (peer === undefined) throw new Error("no peer");
    const request = await peer.next("hook.invoke");
    for (const line of broken.lines(request.id, THREE_PART_TEXT)) peer.raw(line);
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("the call should fail");
    expect(outcome.error.kind).toBe("invalid_response");
    expect(outcome.error.message).toContain(broken.reason);
    expect(peer.alive()).toBe(true);
    expect(peer.signals()).toEqual([]);
    // 다음 호출은 같은 프로세스로 된다
    expect(await echoDigest(rig, "after")).toEqual({
      length: lengthOf("after"),
      sha256: sha256Of("after"),
    });
    expect(rig.port.peers.length).toBe(1);
    // 기록에는 본문도 해시도 없다
    expect(rig.logs.join("")).not.toContain(MARKER);
    expect(rig.logs.join("")).not.toContain(SHA);
  });
}

test("the child dies in the middle of a request transfer: the call ends as process_exit and the engine goes on", async () => {
  const rig = rigOf({ engineMax: 512 * MIB, childMax: 512 * MIB });
  await rig.sup.start();
  const peer = rig.port.peers[0];
  if (peer === undefined) throw new Error("no peer");
  peer.holdReads();
  const text = payloadOf(20 * MIB, "f");
  const pending = rig.sup.call("hook.invoke", { text });
  expect(await until(() => peer.received().includes('"method":"frame.begin"'))).toBe(true);
  peer.crash();
  const outcome = await pending;
  expect(outcome).toMatchObject({ ok: false, error: { kind: "process_exit" } });
  expect(rig.logs.join("")).not.toContain(MARKER);
});

test("the child dies in the middle of its reply transfer: the call ends as process_exit", async () => {
  const rig = rigOf({ engineMax: 512 * MIB, childMax: 512 * MIB });
  await rig.sup.start();
  const pending = rig.sup.call("hook.invoke", {});
  const peer = rig.port.peers[0];
  if (peer === undefined) throw new Error("no peer");
  const request = await peer.next("hook.invoke");
  const head = sha256Of(THREE_PART_TEXT);
  peer.raw(
    beginLine({
      x: 0,
      size: SIZE,
      parts: 3,
      sha256: head,
      frameId: request.id,
      frameKind: "response",
    }),
  );
  peer.raw(partLine(0, 0, THREE_PART_TEXT.slice(0, SPANS[0]?.[1] ?? 0)));
  peer.crash();
  const outcome = await pending;
  expect(outcome).toMatchObject({ ok: false, error: { kind: "process_exit" } });
  expect(rig.logs.join("")).not.toContain(MARKER);
});

test("a reader that stops reading stalls the transfer: after the stall time the call ends as process_killed naming the stall", async () => {
  const rig = rigOf({ engineMax: 512 * MIB, childMax: 512 * MIB, stallMs: 5_000 });
  await rig.sup.start();
  const peer = rig.port.peers[0];
  if (peer === undefined) throw new Error("no peer");
  peer.holdReads();
  const text = payloadOf(40 * MIB, "g");
  const pending = rig.sup.call("hook.invoke", { text });
  expect(await until(() => peer.received().includes('"method":"frame.begin"'))).toBe(true);
  await turn();
  rig.clock.advance(5_000);
  const outcome = await pending;

  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("the call should fail");
  expect(outcome.error.kind).toBe("process_killed");
  expect(outcome.error.message).toContain("stalled");
  expect(peer.signals()).toEqual(["SIGTERM"]);
  // 엔진은 그대로다: 다음 호출은 새 프로세스로 된다
  expect(await until(() => !peer.alive())).toBe(true);
  expect(await echoDigest(rig, "after stall")).toEqual({
    length: lengthOf("after stall"),
    sha256: sha256Of("after stall"),
  });
  expect(rig.port.peers.length).toBe(2);
  expect(rig.logs.join("")).not.toContain(MARKER);
});

test("the deadline clock does not run while a request is being transferred, and runs again after delivery", async () => {
  const rig = rigOf({ engineMax: 512 * MIB, childMax: 512 * MIB, stallMs: 60_000 });
  await rig.sup.start();
  const peer = rig.port.peers[0];
  if (peer === undefined) throw new Error("no peer");
  peer.holdReads();
  const text = payloadOf(40 * MIB, "h");
  let settled = false;
  const pending = rig.sup.call("hook.invoke", { text }, { deadlineMs: 1_000 }).then((outcome) => {
    settled = true;
    return outcome;
  });
  expect(await until(() => peer.received().includes('"method":"frame.begin"'))).toBe(true);
  // 전송이 끝나기 전에 시계를 한참 옮겨도 시간 한도로 끝나지 않는다
  rig.clock.advance(10_000);
  await turn();
  expect(settled).toBe(false);
  peer.releaseReads();
  const request = await peer.next("hook.invoke");
  const received = textOf(request.params);
  expect(received).toBe(text);
  peer.reply(request.id, { length: lengthOf(received), sha256: sha256Of(received) });
  expect(await pending).toEqual({
    ok: true,
    value: { length: lengthOf(text), sha256: sha256Of(text) },
  });
});

test("a step that runs past its deadline after the transfer still ends as process_killed", async () => {
  const rig = rigOf({ engineMax: 512 * MIB, childMax: 512 * MIB, stallMs: 60_000 });
  await rig.sup.start();
  const peer = rig.port.peers[0];
  if (peer === undefined) throw new Error("no peer");
  const text = payloadOf(40 * MIB, "i");
  const pending = rig.sup.call("hook.invoke", { text }, { deadlineMs: 1_000 });
  // 자식은 전부 받고도 답하지 않는다. 전송이 끝난 뒤 시계가 다시 가므로 한도를 넘기면 멈춘다
  await peer.next("hook.invoke");
  await turn(40);
  rig.clock.advance(1_000);
  const result = await pending;
  expect(result).toMatchObject({ ok: false, error: { kind: "process_killed" } });
  expect(rig.logs.join("")).not.toContain(MARKER);
});

test("the transfer frames and the failures keep their logs free of the payload, its hash and its length", async () => {
  const rig = rigOf({ engineMax: 512 * MIB, childMax: 512 * MIB });
  await rig.sup.start();
  await echoDigest(rig, payloadOf(20 * MIB, "j"));
  const joined = rig.logs.join("\n");
  expect(joined).not.toContain(MARKER);
  expect(joined).not.toContain(String(lengthOf(payloadOf(20 * MIB, "j"))));
});

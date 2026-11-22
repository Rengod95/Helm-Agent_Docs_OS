// 큰 값의 조각 전송(AGE-59)을 주도 경로에서 시험한다. 격리 픽스처(`big-steps.ts`)는 받은 값의 길이와 SHA-256을 상태에 적고,
// 시험은 같은 식을 따로 계산해 값으로 비교한다. 자식은 실제 플러그인 호스트 프레이밍을 쓰는 가짜 프로세스(`fake-process.ts`)다.
// 덧붙임: 입력 상한이 협상된 값으로 바뀌는 것, 옛 자식과 엔진 칸이 없을 때 옛 상한이 남는 것, 기록에 본문이 없는 것을 본다.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import type { Logger } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ExtensionEntry, ExtensionManifest, PostItem } from "@fresnel/contracts/extensions";
import { createIsolatedEntry } from "../../src/index.ts";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import { makeManifest, snapshotOf } from "../primitives/fixtures/support.ts";
import {
  createFakeProcessPort,
  createManualClock,
  type FakeProcessPort,
  type ManualClock,
} from "./support/fake-process.ts";
import { extension as bigChildEntry } from "./fixtures/big-child-plugin.ts";
import { extension as bigParentEntry } from "./fixtures/big-parent-plugin.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures", import.meta.url));
const MIB = 1024 * 1024;
const MARKER = "PAYLOAD-MARKER-d41c02";
/** 시험에서 엔진이 알리는 조각 상한. 협상되면 입력 상한은 이 값에서 뼈대 몫을 뺀 값이다 */
const TRANSFER_MAX = 512 * MIB;
const FRAME_SKELETON = 64 * 1024;

function manifestOf(name: string, file: string): ExtensionManifest {
  return { ...makeManifest({ name, hooks: [], orchestration: {}, drives: true }), entry: file };
}

const PARENT = manifestOf("ba", "./big-parent-plugin.ts");
const CHILD = manifestOf("bb", "./big-child-plugin.ts");

/** 로그 기록. 이벤트와 필드를 글로 모은다 */
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

function digestOf(text: string): { readonly length: number; readonly sha256: string } {
  return {
    length: new TextEncoder().encode(text).byteLength,
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

/** 표지를 앞에 둔 글. 기록에 본문이 새는지 본다 */
function marked(bytes: number, unit: string): string {
  const head = `${MARKER} `;
  return head + unit.repeat(Math.ceil((bytes - head.length) / unit.length));
}

/** 한글 글(한 글자 세 바이트) */
function korean(bytes: number): string {
  return "가".repeat(Math.ceil(bytes / 3));
}

function isolatedEntry(
  manifest: ExtensionManifest,
  port: FakeProcessPort,
  clock: ManualClock,
  logs: string[],
  transferMaxBytes: (() => number | undefined) | undefined,
): ExtensionEntry {
  return createIsolatedEntry({
    manifest,
    root: FIXTURE_ROOT,
    versionId: `${manifest.name}-1`,
    port,
    launch: () => ({ command: "plugin-host", args: [], env: {} }),
    setTimer: clock.setTimer,
    now: clock.now,
    logger: capturing(logs),
    initTimeoutMs: 1000,
    ...(transferMaxBytes === undefined ? {} : { transferMaxBytes }),
  });
}

interface Rig {
  readonly t: TestHost;
  readonly parent: FakeProcessPort;
  readonly child: FakeProcessPort;
  readonly thread: ThreadId;
  readonly logs: string[];
}

/**
 * 맡기는 쪽(`ba`)과 맡은 쪽(`bb`)을 격리로 올린다. `transfer`가 `undefined`면 엔진이 조각 칸을 주지 않는다.
 * `oldChild`면 맡기는 쪽 자식이 조각 칸을 답하지 않는다(옛 자식)
 */
async function rigOf(options: {
  readonly transfer: number | undefined;
  readonly oldChild?: boolean;
}): Promise<Rig> {
  const t = await createTestHost({});
  const parent = createFakeProcessPort();
  const child = createFakeProcessPort();
  const clock = createManualClock();
  const logs: string[] = [];
  const transfer = options.transfer;
  const transferMax = transfer === undefined ? undefined : () => transfer;
  if (options.oldChild === true) parent.nextOptions({ oldChild: true });
  const parentOutcome = await t.host.install({
    manifest: PARENT,
    entry: isolatedEntry(PARENT, parent, clock, logs, transferMax),
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  expect(parentOutcome.setups.map((setup) => setup.status)).toEqual(["applied"]);
  const childOutcome = await t.host.install({
    manifest: CHILD,
    entry: isolatedEntry(CHILD, child, clock, logs, transferMax),
    loadIndex: 1,
    builtin: false,
    trust: "user",
  });
  expect(childOutcome.setups.map((setup) => setup.status)).toEqual(["applied"]);
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, parent, child, thread, logs };
}

/** 상태 문서의 `seen` 글. 마지막 상태를 읽는다 */
async function seenOf(t: TestHost, thread: ThreadId): Promise<string> {
  const snapshot = await snapshotOf(t.records, thread);
  const doc = snapshot.states.at(-1)?.doc;
  if (typeof doc !== "object" || doc === null || !("seen" in doc) || typeof doc.seen !== "string") {
    throw new Error("the state document has no seen text");
  }
  return doc.seen;
}

function startOf(rig: Rig, input: Record<string, string | number>) {
  return rig.t.host.startDrive(rig.thread, "ba", { input });
}

test("a start input of 20 MiB ASCII reaches the isolated step whole: its length and sha256 are the input's", async () => {
  const rig = await rigOf({ transfer: TRANSFER_MAX });
  const text = marked(20 * MIB, "a");
  expect(startOf(rig, { mode: "start", text }).ok).toBe(true);
  await rig.t.settled();
  expect(await seenOf(rig.t, rig.thread)).toBe(JSON.stringify(digestOf(text)));
  expect(rig.parent.children[0]?.received()).toContain('"method":"frame.begin"');
  expect(rig.logs.join("")).not.toContain(MARKER);
}, 30_000);

test("a start input of 40 MiB Korean reaches the isolated step whole: its length and sha256 are the input's", async () => {
  const rig = await rigOf({ transfer: TRANSFER_MAX });
  const text = `${MARKER} ${korean(40 * MIB)}`;
  expect(startOf(rig, { mode: "start", text }).ok).toBe(true);
  await rig.t.settled();
  expect(await seenOf(rig.t, rig.thread)).toBe(JSON.stringify(digestOf(text)));
  expect(rig.parent.children[0]?.received()).toContain('"method":"frame.begin"');
  expect(rig.logs.join("")).not.toContain(MARKER);
}, 30_000);

test("a 15 MiB start input is one line: no transfer frame is sent", async () => {
  const rig = await rigOf({ transfer: TRANSFER_MAX });
  const text = marked(15 * MIB, "b");
  expect(startOf(rig, { mode: "start", text }).ok).toBe(true);
  await rig.t.settled();
  expect(await seenOf(rig.t, rig.thread)).toBe(JSON.stringify(digestOf(text)));
  expect(rig.parent.children[0]?.received()).not.toContain('"method":"frame.begin"');
}, 30_000);

test("a 20 MiB input handed off to an isolated plugin arrives whole, and the digest of it comes back as the result", async () => {
  const rig = await rigOf({ transfer: TRANSFER_MAX });
  const text = marked(20 * MIB, "c");
  expect(startOf(rig, { mode: "handoff", text }).ok).toBe(true);
  await rig.t.settled();
  // 맡은 쪽은 입력의 다이제스트를 결과로 돌려주고, 맡기는 쪽은 그 결과를 상태에 적는다
  expect(await seenOf(rig.t, rig.thread)).toBe(JSON.stringify(digestOf(text)));
  expect(rig.child.children[0]?.received()).toContain('"method":"frame.begin"');
  expect(rig.logs.join("")).not.toContain(MARKER);
}, 30_000);

test("a 20 MiB result the isolated child produces comes back to the isolated caller whole", async () => {
  const rig = await rigOf({ transfer: TRANSFER_MAX });
  const size = 20 * MIB;
  expect(startOf(rig, { mode: "produce", size }).ok).toBe(true);
  await rig.t.settled();
  expect(await seenOf(rig.t, rig.thread)).toBe(JSON.stringify(digestOf(korean(size))));
  // 결과는 자식이 조각으로 보내고, 맡기는 쪽은 받은 결과를 조각으로 다시 받는다
  expect(rig.child.children[0]?.emitted()).toContain('"method":"frame.begin"');
  expect(rig.parent.children[0]?.received()).toContain('"method":"frame.begin"');
  expect(rig.logs.join("")).not.toContain(MARKER);
}, 30_000);

test("a 20 MiB user message to a driving isolated plugin is claimed, recorded and delivered whole", async () => {
  const rig = await rigOf({ transfer: TRANSFER_MAX });
  expect(startOf(rig, { mode: "yield" }).ok).toBe(true);
  await rig.t.settled();
  const text = marked(20 * MIB, "d");
  const message: PostItem = { kind: "user", content: text };
  expect(await rig.t.host.claimUserInput(rig.thread, message, "msg-big")).toBe(true);
  await rig.t.settled();
  expect(await seenOf(rig.t, rig.thread)).toBe(JSON.stringify(digestOf(text)));
  expect(rig.parent.children[0]?.received()).toContain('"method":"frame.begin"');
  expect(rig.logs.join("")).not.toContain(MARKER);
}, 30_000);

test("with the transfer negotiated the input limit is the negotiated size less the frame skeleton, and one byte over it is refused", async () => {
  const limit = 20 * MIB;
  const rig = await rigOf({ transfer: limit });
  const pinned = limit - FRAME_SKELETON;
  // 상한 안쪽(JSON 따옴표와 표지를 뺀 글)은 받아진다
  const within = "x".repeat(pinned - 1024);
  expect(startOf(rig, { mode: "start", text: within }).ok).toBe(true);
  await rig.t.settled();
  // 상한을 넘는 입력은 기록하기 전에 거절된다
  const over = "x".repeat(pinned + 1);
  expect(startOf(rig, { mode: "start", text: over })).toEqual({
    ok: false,
    error: { kind: "input_too_large" },
  });
}, 30_000);

test("an old child that does not answer the transfer option keeps the one-line limit: a 20 MiB input is refused before recording", async () => {
  const rig = await rigOf({ transfer: TRANSFER_MAX, oldChild: true });
  const over = marked(20 * MIB, "e");
  expect(startOf(rig, { mode: "start", text: over })).toEqual({
    ok: false,
    error: { kind: "input_too_large" },
  });
  await rig.t.settled();
  expect(rig.parent.children[0]?.received()).not.toContain('"method":"drive.step"');
  expect(rig.logs.join("")).not.toContain(MARKER);
}, 30_000);

test("an engine without the transfer limit sends no transfer option and refuses a 20 MiB input with input_too_large", async () => {
  const rig = await rigOf({ transfer: undefined });
  expect(rig.parent.children[0]?.received()).not.toContain('"transfer"');
  const over = marked(20 * MIB, "f");
  expect(startOf(rig, { mode: "start", text: over })).toEqual({
    ok: false,
    error: { kind: "input_too_large" },
  });
  await rig.t.settled();
  expect(rig.parent.children[0]?.received()).not.toContain('"method":"frame.begin"');
  expect(rig.logs.join("")).not.toContain(MARKER);
}, 30_000);

test("the same 20 MiB handoff run in-engine leaves the same state as the isolated run", async () => {
  const isolated = await rigOf({ transfer: TRANSFER_MAX });
  const text = marked(20 * MIB, "k");
  expect(startOf(isolated, { mode: "handoff", text }).ok).toBe(true);
  await isolated.t.settled();
  const isolatedSeen = await seenOf(isolated.t, isolated.thread);
  expect(isolatedSeen).toBe(JSON.stringify(digestOf(text)));

  // 같은 두 플러그인을 엔진 안에서 돌린다. 상태 문서가 격리 실행과 같아야 한다(엔진 안은 조각이 없다)
  const t = await createTestHost({});
  const parentOutcome = await t.host.install({
    manifest: PARENT,
    entry: bigParentEntry,
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  expect(parentOutcome.setups.map((setup) => setup.status)).toEqual(["applied"]);
  const childOutcome = await t.host.install({
    manifest: CHILD,
    entry: bigChildEntry,
    loadIndex: 1,
    builtin: false,
    trust: "user",
  });
  expect(childOutcome.setups.map((setup) => setup.status)).toEqual(["applied"]);
  const thread = t.newThread();
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "ba", { input: { mode: "handoff", text } }).ok).toBe(true);
  await t.settled();
  expect(await seenOf(t, thread)).toBe(isolatedSeen);
}, 60_000);

// 탭 세션 시험. 프레임 검사, 허용 목록, `$bytes` 왕복, 그리고 실제 서비스 소켓 흉내에 붙은 탭 둘의 격리.
import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { ownField } from "../../../src/main/lib/narrow.ts";
import { CHANNEL_KEY } from "../../../src/shared/channels.ts";
import {
  decodeFrame,
  encodeFrame,
  MAX_SHELL_FRAME_CHARS,
} from "../../../src/web/session/protocol.ts";
import type { TabSession } from "../../../src/web/session/ports.ts";
import { createTabSessionFactory } from "../../../src/web/session/tab-session.ts";
import { cleanupTempDirs, tempDir } from "../support/fixtures.ts";
import {
  channelKindsOf,
  channelTextOf,
  ENCODER,
  invokeText,
  recordedLog,
  replyOf,
  sessionOptions,
  startFakeService,
  tabInput,
  waitFor,
  type FakeService,
  type RecordedLog,
  type TabHarness,
} from "./support.ts";

const sessions: TabSession[] = [];
const services: FakeService[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  await Promise.all(services.splice(0).map((service) => service.close()));
  cleanupTempDirs();
});

/** 서비스가 없는 소켓 경로. 엔진은 띄워지지 않고 실패 상태로 기다린다 */
function absentSocket(): string {
  return path.join(tempDir(), "absent.sock");
}

function openTab(
  socketPath: string,
  log: RecordedLog,
  deviceId = "dev_test",
): { readonly session: TabSession; readonly tab: TabHarness } {
  const factory = createTabSessionFactory(sessionOptions(socketPath, log));
  const tab = tabInput(deviceId);
  const session = factory.open(tab.input);
  sessions.push(session);
  return { session, tab };
}

/** 응답 값의 `epoch` */
function epochOf(reply: unknown): unknown {
  return ownField(ownField(reply, "value"), "epoch");
}

/**
 * 엔진 상태 종류. 붙을 때의 상태는 응답 값에, 그 뒤의 바뀜은 상태 채널에 온다(`relay.ts`의 attach와 setState).
 * 붙기 전에 이미 바뀐 상태는 채널에 오지 않으므로 둘을 함께 본다.
 */
function engineKindsOf(tab: TabHarness, attachId: number, stateChannel: number): unknown[] {
  const attached = ownField(ownField(replyOf(tab.frames(), attachId), "value"), "state");
  return [ownField(attached, "kind"), ...channelKindsOf(tab.frames(), stateChannel)];
}

describe("frame validation", () => {
  const malformed: readonly (readonly [string, string])[] = [
    ["not JSON", "not json"],
    ["a JSON array", "[]"],
    ["an unknown kind", JSON.stringify({ t: "hello", id: 1 })],
    ["a string id", JSON.stringify({ t: "invoke", id: "1", cmd: "shell_take_intents" })],
    ["a negative id", JSON.stringify({ t: "invoke", id: -1, cmd: "shell_take_intents" })],
    ["a fractional id", JSON.stringify({ t: "invoke", id: 1.5, cmd: "shell_take_intents" })],
    ["a numeric command", JSON.stringify({ t: "invoke", id: 1, cmd: 7 })],
    ["a close-channel without an id", JSON.stringify({ t: "close-channel" })],
    [
      "a broken $bytes value",
      '{"t":"invoke","id":1,"cmd":"shell_take_intents","args":{"body":{"$bytes":"!!!"}}}',
    ],
  ];

  for (const [name, text] of malformed) {
    test(`${name} closes the connection with 1008 and answers nothing`, () => {
      const log = recordedLog();
      const { tab, session } = openTab(absentSocket(), log);
      session.receive(text);
      expect(tab.closes()).toEqual([{ code: 1008, reason: "bad-frame" }]);
      expect(tab.texts()).toEqual([]);
      // 프레임 글자는 로그에 없다(시크릿이 들어 있을 수 있다)
      expect(log.lines.join("\n")).not.toContain(text);
    });
  }

  test("an oversized frame closes the connection with 1009", () => {
    const { tab, session } = openTab(absentSocket(), recordedLog());
    session.receive("x".repeat(MAX_SHELL_FRAME_CHARS + 1));
    expect(tab.closes()).toEqual([{ code: 1009, reason: "too-large" }]);
    expect(tab.texts()).toEqual([]);
  });

  test("after a refusal the tab ignores further frames", () => {
    const { tab, session } = openTab(absentSocket(), recordedLog());
    session.receive("garbage");
    session.receive(invokeText(1, "shell_take_intents"));
    expect(tab.closes()).toEqual([{ code: 1008, reason: "bad-frame" }]);
    expect(tab.texts()).toEqual([]);
  });
});

describe("allow-list through the wire", () => {
  test("hidden, browser and gap commands answer unknown-command", async () => {
    const { tab, session } = openTab(absentSocket(), recordedLog());
    const names = [
      "open_external",
      "notify_os",
      "save_file",
      "pick_file",
      "update_status",
      "os_reauth",
      "open_data_dir",
      "engine_retarget",
      "pick_folder_open",
      "pick_folder",
    ];
    names.forEach((name, index) => {
      session.receive(invokeText(index + 1, name, undefined));
    });
    await waitFor("every refusal to be answered", () => tab.frames().length === names.length);
    const answers = tab.frames().map((frame) => [ownField(frame, "id"), ownField(frame, "error")]);
    expect(answers).toEqual(names.map((_name, index) => [index + 1, "unknown-command"]));
  });

  test("an origin command works and answers with its value", async () => {
    const { tab, session } = openTab(absentSocket(), recordedLog());
    session.receive(invokeText(4, "shell_take_intents"));
    session.receive(invokeText(5, "shell_capabilities"));
    await waitFor("both answers", () => tab.frames().length === 2);
    expect(replyOf(tab.frames(), 4)).toEqual({ t: "reply", id: 4, ok: true, value: [] });
    expect(replyOf(tab.frames(), 5)).toEqual({
      t: "reply",
      id: 5,
      ok: true,
      value: { kind: "web" },
    });
  });

  test("a rejected command keeps its payload as the error", async () => {
    const { tab, session } = openTab(absentSocket(), recordedLog());
    // `app_roots_set`은 목록 모양이 틀리면 `bad_shape`로 거절한다. 던진 `ShellError`의 값(문자열)이 거절 값이 된다
    session.receive(invokeText(6, "app_roots_set", { entries: "not-a-list" }));
    await waitFor("the rejection", () => tab.frames().length === 1);
    expect(replyOf(tab.frames(), 6)).toEqual({ t: "reply", id: 6, ok: false, error: "bad_shape" });
  });

  test("a close-channel frame answers nothing", () => {
    const { tab, session } = openTab(absentSocket(), recordedLog());
    session.receive(encodeFrame({ t: "close-channel", id: 9 }));
    expect(tab.texts()).toEqual([]);
    expect(tab.closes()).toEqual([]);
  });
});

describe("binary values on the wire", () => {
  test("a Uint8Array survives the frame encoding byte for byte", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const text = encodeFrame({ t: "channel", id: 3, message: bytes });
    expect(text).toContain('"$bytes"');
    expect(decodeFrame(text)).toEqual({ t: "channel", id: 3, message: bytes });
  });
});

describe("two tabs over one service connection each", () => {
  test("channels, bytes and close are per tab, and a closed tab stops answering", async () => {
    const service = await startFakeService();
    services.push(service);
    const logA = recordedLog();
    const logB = recordedLog();
    const a = openTab(service.socketPath, logA, "dev_a");
    const b = openTab(service.socketPath, logB, "dev_b");
    await waitFor("both tabs to connect", () => service.connections.length === 2);

    // 두 탭이 같은 채널 번호(1, 2)를 쓴다. 번호는 탭 안에서만 뜻이 있다
    const attach = invokeText(1, "engine_attach", {
      onBytes: { [CHANNEL_KEY]: 1 },
      onState: { [CHANNEL_KEY]: 2 },
    });
    a.session.receive(attach);
    b.session.receive(attach);
    await waitFor(
      "the engine to run in both tabs",
      () =>
        engineKindsOf(a.tab, 1, 2).includes("running") &&
        engineKindsOf(b.tab, 1, 2).includes("running"),
    );
    const epochA = epochOf(replyOf(a.tab.frames(), 1));
    const epochB = epochOf(replyOf(b.tab.frames(), 1));
    expect(typeof epochA === "number" && epochA > 0).toBe(true);
    expect(typeof epochB === "number" && epochB > 0).toBe(true);
    // 소켓 엔진은 프로세스가 아니다. 화면 스키마(pid는 1 이상 또는 null)를 지키도록 pid는 null이다
    const attachedState = ownField(ownField(replyOf(a.tab.frames(), 1), "value"), "state");
    const runningPids = [
      attachedState,
      ...a.tab.frames().map((frame) => ownField(frame, "message")),
    ]
      .filter((state) => ownField(state, "kind") === "running")
      .map((state) => ownField(state, "pid"));
    expect(runningPids.length).toBeGreaterThan(0);
    expect(runningPids.every((pid) => pid === null)).toBe(true);

    // 이진 본문이 서비스까지 바이트 그대로 간다. 줄 끝 0x0a와 UTF-8이 아닌 바이트를 섞는다
    const bodyA = new Uint8Array([...ENCODER.encode("A-write\n"), 0xff, 0x00, 0x80]);
    a.session.receive(
      encodeFrame({
        t: "invoke",
        id: 2,
        cmd: "engine_write",
        args: { headers: { "x-fresnel-epoch": String(epochA) }, body: bodyA },
      }),
    );
    await waitFor("tab A's write to reach the service", () =>
      service.connections.some((connection) => connection.received().length === bodyA.length),
    );
    const connA = service.connections.find((connection) =>
      connection.receivedText().includes("A-write"),
    );
    expect(connA?.received()).toEqual(bodyA);
    expect(replyOf(a.tab.frames(), 2)).toEqual({ t: "reply", id: 2, ok: true, value: null });

    b.session.receive(
      encodeFrame({
        t: "invoke",
        id: 2,
        cmd: "engine_write",
        args: { headers: { "x-fresnel-epoch": String(epochB) }, body: ENCODER.encode("B-write\n") },
      }),
    );
    await waitFor("tab B's write to reach the service", () =>
      service.connections.some((connection) => connection.receivedText().includes("B-write")),
    );
    const connB = service.connections.find((connection) =>
      connection.receivedText().includes("B-write"),
    );
    expect(connA === connB).toBe(false);

    // 서비스가 각 연결에 답을 보낸다. 각 탭은 자기 연결의 바이트만 자기 채널로 받는다
    connA?.write(ENCODER.encode("for-A\n"));
    connB?.write(ENCODER.encode("for-B\n"));
    await waitFor(
      "both answers to arrive",
      () =>
        channelTextOf(a.tab.frames(), 1) === "for-A\n" &&
        channelTextOf(b.tab.frames(), 1) === "for-B\n",
    );
    expect(channelTextOf(a.tab.frames(), 1)).toBe("for-A\n");
    expect(channelTextOf(b.tab.frames(), 1)).toBe("for-B\n");

    // 탭 A를 닫는다. A의 연결만 끝나고 B는 그대로 살아 있다
    a.session.close();
    await waitFor("tab A's service connection to end", () => connA?.closed() === true);
    expect(connB?.closed()).toBe(false);
    connB?.write(ENCODER.encode("more-B\n"));
    await waitFor(
      "tab B to still receive",
      () => channelTextOf(b.tab.frames(), 1) === "for-B\nmore-B\n",
    );
    expect(channelTextOf(a.tab.frames(), 1)).toBe("for-A\n");

    const framesAtClose = a.tab.frames().length;
    a.session.receive(invokeText(9, "shell_take_intents"));
    expect(a.tab.frames().length).toBe(framesAtClose);
    expect(logA.lines.filter((line) => line.startsWith("web session closed")).length).toBe(1);

    b.session.close();
    await waitFor("tab B's service connection to end", () => connB?.closed() === true);
    expect(logB.lines.filter((line) => line.startsWith("web session closed")).length).toBe(1);
  });

  test("a service that goes away shows as a failed engine on the tab", async () => {
    const service = await startFakeService();
    services.push(service);
    const a = openTab(service.socketPath, recordedLog(), "dev_a");
    a.session.receive(
      invokeText(1, "engine_attach", {
        onBytes: { [CHANNEL_KEY]: 1 },
        onState: { [CHANNEL_KEY]: 2 },
      }),
    );
    await waitFor("the engine to run", () => engineKindsOf(a.tab, 1, 2).includes("running"));
    await service.close();
    await waitFor("the failure to reach the tab", () =>
      engineKindsOf(a.tab, 1, 2).includes("failed"),
    );
    // 마지막 상태는 실패다. 그 앞에 띄움과 실행이 있었다
    expect(engineKindsOf(a.tab, 1, 2).slice(-2)).toEqual(["running", "failed"]);
  });
});

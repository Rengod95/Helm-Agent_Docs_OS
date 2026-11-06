import { beforeEach, describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import {
  setConfiguredCloseBehavior,
  shouldQuitWhenWindowsClosed,
} from "../src/main/close-behavior.ts";
import type { ShellReply } from "../src/main/commands.ts";
import { INTENT_EVENT, sharedIntents } from "../src/main/intents.ts";
import {
  actionOf,
  createTrayModule,
  DEFAULT_TRAY_LABELS,
  labelsFit,
  runningText,
  type TrayAction,
  type TrayCreateError,
  type TrayHandle,
  type TrayLabels,
  type TrayPorts,
} from "../src/main/tray.ts";
import { type FakeContext, createFakeContext } from "./fake-context.ts";

/** 바른 요청. 시험마다 한 곳만 바꾼다 */
const VALID_LABELS: TrayLabels = {
  open: "열기",
  newThread: "새 대화",
  running: "진행 중 {count}",
  quit: "끝내기",
};
const VALID_ARGS = { labels: VALID_LABELS, running: 3 };
const REJECTED: ShellReply = { ok: false, error: "bad-request" };

interface FakeTrayOptions {
  /** 주면 트레이를 만들지 못한다. 값은 이유 코드다 */
  readonly createFailure?: TrayCreateError["reason"];
  /** true면 setLabels가 던진다 */
  readonly setLabelsThrows?: boolean;
}

interface FakeTray {
  readonly ports: TrayPorts;
  /** create에 넘어온 처음 글 */
  readonly created: TrayLabels[];
  /** setLabels로 넘어온 글 */
  readonly applied: TrayLabels[];
  readonly logs: string[];
  readonly counts: { quit: number; destroy: number };
  /** 메뉴 항목을 누른 것처럼 onAction을 부른다 */
  press(action: TrayAction): void;
}

function fakeTray(options: FakeTrayOptions = {}): FakeTray {
  const created: TrayLabels[] = [];
  const applied: TrayLabels[] = [];
  const logs: string[] = [];
  const counts = { quit: 0, destroy: 0 };
  let pressAction: ((action: TrayAction) => void) | null = null;
  const handle: TrayHandle = {
    setLabels(labels) {
      if (options.setLabelsThrows === true) throw new Error("menu item is gone");
      applied.push(labels);
    },
    destroy() {
      counts.destroy += 1;
    },
  };
  const ports: TrayPorts = {
    create(initial, onAction) {
      created.push(initial);
      pressAction = onAction;
      const failure = options.createFailure;
      return failure === undefined ? ok(handle) : err({ reason: failure });
    },
    log(line) {
      logs.push(line);
    },
    quit() {
      counts.quit += 1;
    },
  };
  return {
    ports,
    created,
    applied,
    logs,
    counts,
    press(action) {
      if (pressAction === null) throw new Error("the tray was not created");
      pressAction(action);
    },
  };
}

function start(tray: FakeTray): FakeContext {
  const fake = createFakeContext();
  createTrayModule(tray.ports).register(fake.ctx);
  return fake;
}

describe("tray menu ids", () => {
  test("menu ids map to their actions, and the running line and unknown ids to null", () => {
    expect(actionOf("open")).toBe("open");
    expect(actionOf("new_thread")).toBe("newThread");
    expect(actionOf("quit")).toBe("quit");
    expect(
      ["running", "", "Quit", "new-thread", "separator", "constructor"].map((id) => actionOf(id)),
    ).toEqual([null, null, null, null, null, null]);
  });
});

describe("tray running line and labels", () => {
  test("the count goes into every marker of the running line", () => {
    expect(runningText("진행 중 {count}", 0)).toBe("진행 중 0");
    expect(runningText("Running {count}", 12)).toBe("Running 12");
    expect(runningText("{count} of {count}", 3)).toBe("3 of 3");
    expect(runningText("no marker", 7)).toBe("no marker");
  });

  test("the first labels are the English defaults, and the running line starts at 0", () => {
    expect(DEFAULT_TRAY_LABELS).toEqual({
      open: "Open Fresnel",
      newThread: "New chat",
      running: "Running {count}",
      quit: "Quit",
    });
    expect(runningText(DEFAULT_TRAY_LABELS.running, 0)).toBe("Running 0");
  });

  test("each label is capped at 80 characters", () => {
    expect(labelsFit({ ...DEFAULT_TRAY_LABELS, open: "a".repeat(80) })).toBe(true);
    expect(labelsFit({ ...DEFAULT_TRAY_LABELS, open: "a".repeat(81) })).toBe(false);
    expect(labelsFit({ ...DEFAULT_TRAY_LABELS, newThread: "a".repeat(81) })).toBe(false);
    expect(labelsFit({ ...DEFAULT_TRAY_LABELS, running: "a".repeat(81) })).toBe(false);
    expect(labelsFit({ ...DEFAULT_TRAY_LABELS, quit: "a".repeat(81) })).toBe(false);
  });

  test("the cap counts characters, so 80 Korean characters fit and 81 do not", () => {
    // 한글 80자는 240바이트다
    expect(labelsFit({ ...DEFAULT_TRAY_LABELS, open: "가".repeat(80) })).toBe(true);
    expect(labelsFit({ ...DEFAULT_TRAY_LABELS, open: "가".repeat(81) })).toBe(false);
    // 이모지 80개는 UTF-16 단위로 160이지만 글자 수로는 80이다
    expect(labelsFit({ ...DEFAULT_TRAY_LABELS, open: "😀".repeat(80) })).toBe(true);
    expect(labelsFit({ ...DEFAULT_TRAY_LABELS, open: "😀".repeat(81) })).toBe(false);
  });
});

describe("tray module", () => {
  beforeEach(() => {
    setConfiguredCloseBehavior("tray");
  });

  test("creates the tray with the English defaults and keeps the app in tray mode", () => {
    const tray = fakeTray();
    const fake = start(tray);
    expect(tray.created).toEqual([
      { open: "Open Fresnel", newThread: "New chat", running: "Running 0", quit: "Quit" },
    ]);
    expect(tray.logs).toEqual([]);
    expect(shouldQuitWhenWindowsClosed()).toBe(false);
    expect(fake.cleanups).toHaveLength(1);
  });

  test("when the tray cannot be created it logs the reason and the window close quits", () => {
    const tray = fakeTray({ createFailure: "icon" });
    const fake = start(tray);
    expect(tray.logs).toEqual(["tray: not created (reason: icon)"]);
    expect(shouldQuitWhenWindowsClosed()).toBe(true);
    expect(fake.cleanups).toEqual([]);
  });

  test("tray_update applies the labels with the count in every running marker", async () => {
    const tray = fakeTray();
    const fake = start(tray);
    const reply = await fake.dispatch("tray_update", {
      labels: { ...VALID_LABELS, running: "진행 중 {count} / {count}" },
      running: 3,
    });
    expect(reply).toEqual({ ok: true, value: { kind: "updated" } });
    expect(tray.applied).toEqual([
      { open: "열기", newThread: "새 대화", running: "진행 중 3 / 3", quit: "끝내기" },
    ]);
  });

  test("tray_update is answered unavailable when there is no tray, and the shape is still checked", async () => {
    const fake = start(fakeTray({ createFailure: "build" }));
    expect(await fake.dispatch("tray_update", VALID_ARGS)).toEqual({
      ok: true,
      value: { kind: "unavailable" },
    });
    expect(await fake.dispatch("tray_update", { running: 0 })).toEqual(REJECTED);
  });

  test("a malformed tray_update is rejected as bad-request and applies nothing", async () => {
    const tray = fakeTray();
    const fake = start(tray);
    const malformed: unknown[] = [
      undefined,
      null,
      "labels",
      3,
      {},
      { labels: null, running: 0 },
      { labels: VALID_LABELS },
      { labels: VALID_LABELS, running: "3" },
      { labels: VALID_LABELS, running: -1 },
      { labels: VALID_LABELS, running: 1.5 },
      { labels: VALID_LABELS, running: Number.NaN },
      { labels: VALID_LABELS, running: Number.POSITIVE_INFINITY },
      { labels: { open: "a", newThread: "b", running: "c" }, running: 0 },
      { labels: { ...VALID_LABELS, quit: 1 }, running: 0 },
    ];
    const replies = await Promise.all(malformed.map((args) => fake.dispatch("tray_update", args)));
    expect(replies).toEqual(malformed.map(() => REJECTED));
    expect(tray.applied).toEqual([]);
  });

  test("tray_update rejects a label over 80 characters and applies nothing", async () => {
    const tray = fakeTray();
    const fake = start(tray);
    const long = "a".repeat(81);
    const replies = await Promise.all([
      fake.dispatch("tray_update", { ...VALID_ARGS, labels: { ...VALID_LABELS, open: long } }),
      fake.dispatch("tray_update", { ...VALID_ARGS, labels: { ...VALID_LABELS, newThread: long } }),
      fake.dispatch("tray_update", { ...VALID_ARGS, labels: { ...VALID_LABELS, running: long } }),
      fake.dispatch("tray_update", { ...VALID_ARGS, labels: { ...VALID_LABELS, quit: long } }),
    ]);
    expect(replies).toEqual([REJECTED, REJECTED, REJECTED, REJECTED]);
    expect(tray.applied).toEqual([]);
  });

  test("a failed setLabels is answered as failed set_text and logged", async () => {
    const tray = fakeTray({ setLabelsThrows: true });
    const fake = start(tray);
    expect(await fake.dispatch("tray_update", VALID_ARGS)).toEqual({
      ok: true,
      value: { kind: "failed", reason: "set_text" },
    });
    expect(tray.logs).toEqual(["tray: set_text failed"]);
  });

  test("open shows the main window and queues no intent", () => {
    sharedIntents.take(Date.now());
    const tray = fakeTray();
    const fake = start(tray);
    tray.press("open");
    expect(fake.shown.count).toBe(1);
    expect(fake.emitted).toEqual([]);
    expect(sharedIntents.take(Date.now())).toEqual([]);
  });

  test("new thread shows the window, queues a newThread intent and wakes the UI", () => {
    sharedIntents.take(Date.now());
    const tray = fakeTray();
    const fake = start(tray);
    tray.press("newThread");
    expect(fake.shown.count).toBe(1);
    expect(fake.emitted).toEqual([INTENT_EVENT]);
    expect(sharedIntents.take(Date.now())).toEqual([{ kind: "newThread" }]);
  });

  test("quit asks the ports to quit, without showing a window or queuing an intent", () => {
    sharedIntents.take(Date.now());
    const tray = fakeTray();
    const fake = start(tray);
    tray.press("quit");
    expect(tray.counts.quit).toBe(1);
    expect(fake.shown.count).toBe(0);
    expect(sharedIntents.take(Date.now())).toEqual([]);
  });

  test("the tray is destroyed when the app quits", async () => {
    const tray = fakeTray();
    const fake = start(tray);
    await Promise.all(fake.cleanups.map(async (cleanup) => cleanup()));
    expect(tray.counts.destroy).toBe(1);
  });
});

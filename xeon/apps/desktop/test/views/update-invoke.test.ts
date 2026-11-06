import { describe, expect, test } from "bun:test";
import type { InstallOutcome } from "../../src/views/update-model.ts";
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  readUpdaterStatus,
  type DownloadProgress,
  type UpdateChannelOf,
  type UpdateInvoke,
} from "../../src/views/update-invoke.ts";

// 업데이트 명령의 응답 읽기(B-10). 정상 응답, 모양이 틀린 응답, 명령 거부를 값으로 본다.
// 가짜 invoke는 부른 명령과 인자를 기록하고 답을 주며, 거부는 던진다. 가짜 채널은 보낸 진행 조각을 `onMessage`로 밀어 넣는다.

type Call = { readonly command: string; readonly onEvent: unknown };

/** 명령마다 답을 주는 가짜 invoke. `reply`가 던지면 명령이 거부된 것이다 */
function fakeInvoke(reply: (command: string) => unknown): { invoke: UpdateInvoke; calls: Call[] } {
  const calls: Call[] = [];
  const invoke: UpdateInvoke = (command, args) => {
    calls.push({ command, onEvent: args?.onEvent });
    return Promise.resolve(reply(command));
  };
  return { invoke, calls };
}

/** 채널을 흉내 낸다. 만들어진 채널의 `onMessage`를 잡아 두었다가 시험이 조각을 보낸다 */
function fakeChannel(): {
  createChannel: UpdateChannelOf;
  send: (message: unknown) => void;
  made: unknown[];
} {
  let onMessage: ((event: unknown) => void) | null = null;
  const made: unknown[] = [];
  const createChannel: UpdateChannelOf = (handler) => {
    onMessage = handler;
    const channel = { tag: "channel" };
    made.push(channel);
    return channel;
  };
  const send = (message: unknown): void => {
    onMessage?.(message);
  };
  return { createChannel, send, made };
}

/** 답마다 시험 하나씩 돌린다. 시험 순서에 기대지 않도록 모두 함께 기다린다 */
async function eachReply(
  replies: readonly (readonly [unknown, unknown])[],
  read: (reply: unknown) => Promise<unknown>,
): Promise<void> {
  const results = await Promise.all(replies.map(([reply]) => read(reply)));
  expect(results).toEqual(replies.map(([, expected]) => expected));
}

describe("readUpdaterStatus", () => {
  test("a reply with the flag and the version is read as it is, after one update_status call", async () => {
    const fake = fakeInvoke(() => ({ configured: true, currentVersion: "0.4.1" }));
    expect(await readUpdaterStatus(fake.invoke)).toEqual({
      ok: true,
      value: { configured: true, currentVersion: "0.4.1" },
    });
    expect(fake.calls.map((call) => call.command)).toEqual(["update_status"]);
  });

  test("a reply of the wrong shape or a rejected command is unreadable", async () => {
    const replies: readonly (readonly [unknown, unknown])[] = [
      [null, "unreadable"],
      ["0.4.1", "unreadable"],
      [{ configured: "yes", currentVersion: "0.4.1" }, "unreadable"],
      [{ configured: true }, "unreadable"],
      [{ configured: true, currentVersion: 4 }, "unreadable"],
    ];
    await eachReply(replies, async (reply) => {
      const read = await readUpdaterStatus(fakeInvoke(() => reply).invoke);
      return read.ok ? "readable" : read.error;
    });
    const rejected = await readUpdaterStatus(
      fakeInvoke(() => {
        throw new Error("command not found");
      }).invoke,
    );
    expect(rejected).toEqual({ ok: false, error: "unreadable" });
  });
});

describe("checkForUpdate", () => {
  test("each reply kind maps to its outcome", async () => {
    await eachReply(
      [
        [{ kind: "notConfigured" }, { kind: "notConfigured" }],
        [{ kind: "upToDate" }, { kind: "upToDate" }],
        [
          { kind: "available", version: "0.4.2", notes: "고친 점" },
          { kind: "available", version: "0.4.2", notes: "고친 점" },
        ],
        [{ kind: "offline" }, { kind: "offline" }],
        [
          { kind: "failed", reason: "no_release" },
          { kind: "failed", reason: "no_release" },
        ],
      ],
      (reply) => checkForUpdate(fakeInvoke(() => reply).invoke),
    );
  });

  test("the notes are null when they are missing or blank, and the reason is other when unknown", async () => {
    await eachReply(
      [
        [
          { kind: "available", version: "0.4.2", notes: null },
          { kind: "available", version: "0.4.2", notes: null },
        ],
        [
          { kind: "available", version: "0.4.2", notes: "  " },
          { kind: "available", version: "0.4.2", notes: null },
        ],
        [
          { kind: "failed", reason: "mystery" },
          { kind: "failed", reason: "other" },
        ],
        [{ kind: "failed" }, { kind: "failed", reason: "other" }],
      ],
      (reply) => checkForUpdate(fakeInvoke(() => reply).invoke),
    );
  });

  test("a reply of the wrong shape is a failure with reason other", async () => {
    const failure = { kind: "failed", reason: "other" };
    await eachReply(
      [
        [null, failure],
        ["available", failure],
        [{ kind: "zzz" }, failure],
        [{ kind: 3 }, failure],
        [{ kind: "available", notes: "x" }, failure],
        [{ kind: "available", version: "  ", notes: null }, failure],
      ],
      (reply) => checkForUpdate(fakeInvoke(() => reply).invoke),
    );
  });

  test("a rejected command is a failure with reason other, and the check is asked once", async () => {
    const fake = fakeInvoke(() => {
      throw new Error("boom");
    });
    expect(await checkForUpdate(fake.invoke)).toEqual({ kind: "failed", reason: "other" });
    expect(fake.calls.map((call) => call.command)).toEqual(["update_check"]);
  });
});

describe("downloadUpdate", () => {
  test("the channel is passed as onEvent, progress pieces reach onProgress, and a ready reply ends it", async () => {
    const channel = fakeChannel();
    const progress: DownloadProgress[] = [];
    const fake = fakeInvoke((command) => {
      expect(command).toBe("update_download");
      channel.send({ kind: "progress", downloaded: 512, total: 2048 });
      channel.send({ kind: "progress", downloaded: 2048, total: null });
      return { kind: "ready" };
    });
    const outcome = await downloadUpdate(fake.invoke, channel.createChannel, (p) => {
      progress.push(p);
    });
    expect(outcome).toEqual({ kind: "ready" });
    expect(fake.calls).toEqual([{ command: "update_download", onEvent: channel.made[0] }]);
    expect(progress).toEqual([
      { downloaded: 512, total: 2048 },
      { downloaded: 2048, total: null },
    ]);
  });

  test("pieces of the wrong shape are dropped, and a total of the wrong shape counts as unknown", async () => {
    const channel = fakeChannel();
    const progress: DownloadProgress[] = [];
    const fake = fakeInvoke(() => {
      channel.send(null);
      channel.send({ kind: "started" });
      channel.send({ kind: "progress", downloaded: -1, total: 10 });
      channel.send({ kind: "progress", downloaded: "3", total: 10 });
      channel.send({ kind: "progress", downloaded: 3, total: "10" });
      return { kind: "ready" };
    });
    await downloadUpdate(fake.invoke, channel.createChannel, (p) => {
      progress.push(p);
    });
    expect(progress).toEqual([{ downloaded: 3, total: null }]);
  });

  test("offline, failed with a known reason, and every other reply map to their outcome", async () => {
    await eachReply(
      [
        [{ kind: "offline" }, { kind: "offline" }],
        [
          { kind: "failed", reason: "signature" },
          { kind: "failed", reason: "signature" },
        ],
        [
          { kind: "failed", reason: "nothing_to_download" },
          { kind: "failed", reason: "nothing_to_download" },
        ],
        [
          { kind: "failed", reason: "network" },
          { kind: "failed", reason: "network" },
        ],
        [{ kind: "ready" }, { kind: "ready" }],
        [null, { kind: "failed", reason: "other" }],
        [
          { kind: "failed", reason: 7 },
          { kind: "failed", reason: "other" },
        ],
        [{ kind: "upToDate" }, { kind: "failed", reason: "other" }],
      ],
      (reply) =>
        downloadUpdate(fakeInvoke(() => reply).invoke, fakeChannel().createChannel, () => {}),
    );
  });

  test("a rejected command is a failure with reason other", async () => {
    const outcome = await downloadUpdate(
      fakeInvoke(() => {
        throw new Error("channel closed");
      }).invoke,
      fakeChannel().createChannel,
      () => {},
    );
    expect(outcome).toEqual({ kind: "failed", reason: "other" });
  });
});

describe("installUpdate", () => {
  test("a failure reply keeps its reason and an offline reply is offline", async () => {
    await eachReply(
      [
        [
          { kind: "failed", reason: "other" },
          { kind: "failed", reason: "other" },
        ],
        [{ kind: "offline" }, { kind: "offline" }],
      ],
      (reply) => installUpdate(fakeInvoke(() => reply).invoke),
    );
  });

  test("a reply that is not a failure, of the wrong shape, or a rejected command is other", async () => {
    const other: InstallOutcome = { kind: "failed", reason: "other" };
    await eachReply(
      [
        [null, other],
        [{ kind: "ready" }, other],
        [{ kind: "failed" }, other],
      ],
      (reply) => installUpdate(fakeInvoke(() => reply).invoke),
    );
    const fake = fakeInvoke(() => {
      throw new Error("worker panicked");
    });
    expect(await installUpdate(fake.invoke)).toEqual(other);
    expect(fake.calls.map((call) => call.command)).toEqual(["update_install_restart"]);
  });
});

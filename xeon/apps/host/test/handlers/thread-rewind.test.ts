import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { EventId, ItemId, ThreadId } from "@fresnel/contracts/conversation";
import type { RewindFileResult, RewindId } from "@fresnel/contracts/records";
import type { FileRewindService, RewindPreview } from "@fresnel/contracts/services";
import { WireError } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type { FileRewindPort, StartedRewind } from "../../src/types.ts";
import { FAKE_STORE_ID } from "../fixtures/fake-engine.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// L4.host-service §4.28, F.wire-settings §3.3.1 파일 되감기. 가짜 엔진 위의 처리기다: 사전 검사 순서, 파일을 먼저 되돌리는 순서,
// 되돌리기가 leaf를 먼저 옮기는 순서, 포트가 없을 때의 -32601. 실제 저장소 위의 시험은 test/int/file-rewind.int.test.ts다.

const ids = fixedIdFactory(700);
const REWIND_ID: RewindId = "rwd_0123456789abcdef";
const POSITION = { storeId: FAKE_STORE_ID, seq: 3 };
const OLD_LEAF: EventId = ids.next("evt");
const LEAF: EventId = ids.next("evt");
const TARGET: EventId = ids.next("evt");
const TURN = ids.next("trn");
const FILE_RESULT: RewindFileResult = { path: "/work/a.txt", outcome: "restored", reason: null };
const APPLIED = { rewindId: REWIND_ID, files: [FILE_RESULT], kept: [], untracked: [] };
const PREVIEW: RewindPreview = {
  toEventId: TARGET,
  files: [],
  untracked: [],
  incomplete: [],
};

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

/** 서비스 가짜. 부른 메서드를 `calls`에 적는다. 쓰지 않는 메서드는 부르면 실패한다 */
function serviceOf(calls: string[]): FileRewindService {
  return {
    preview: () => {
      calls.push("preview");
      return Promise.resolve(ok(PREVIEW));
    },
    apply: (input) => {
      calls.push(`apply:${input.scope}:${String(input.oldLeafEventId)}`);
      return Promise.resolve(ok(APPLIED));
    },
    overwrite: () => {
      calls.push("overwrite");
      return Promise.resolve(ok(APPLIED));
    },
    undoFiles: () => {
      calls.push("undoFiles");
      return Promise.resolve(ok({ rewindId: REWIND_ID, files: [FILE_RESULT] }));
    },
    turnFiles: () => {
      calls.push("turnFiles");
      return Promise.resolve(ok({ turns: [] }));
    },
    incomplete: () => {
      calls.push("incomplete");
      return Promise.resolve(ok([]));
    },
  };
}

const STARTED: StartedRewind = {
  scope: "both",
  targetEventId: TARGET,
  oldLeafEventId: OLD_LEAF,
};

function portOf(
  calls: string[],
  overrides: Partial<Omit<FileRewindPort, "service">> = {},
): FileRewindPort {
  return {
    service: serviceOf(calls),
    newRewindId: () => REWIND_ID,
    startedOf: () => Promise.resolve(ok(STARTED)),
    undoneConversationOf: () => Promise.resolve(ok(undefined)),
    ...overrides,
  };
}

test("without the file rewind port the five methods are -32601 and host.hello leaves them out of features", async () => {
  const host = createFakeHost({});
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const names = hello.features.map((feature) => feature.name);
  for (const name of [
    "thread.rewindPreview",
    "thread.rewind",
    "thread.rewindOverwrite",
    "thread.rewindUndo",
    "thread.turnFiles",
  ]) {
    expect(names).not.toContain(name);
  }
  const threadId = host.fake.seedThread();
  const to: ItemId = host.fake.ids.next("itm");
  const preview = await wireErrorOf(connection.request("thread.rewindPreview", { threadId, to }));
  expect(preview.code).toBe(-32601);
  const turnFiles = await wireErrorOf(connection.request("thread.turnFiles", { threadId }));
  expect(turnFiles.code).toBe(-32601);
  await connection.close();
});

test("the writing rewinds need the ownership, and a closed thread or an open turn is refused before any file is touched", async () => {
  const calls: string[] = [];
  // 대화 id는 가짜 엔진이 만든다. 판정 함수는 만든 뒤에 채우는 자리를 본다
  const special: { busy?: ThreadId; closed?: ThreadId } = {};
  const host = createFakeHost({
    fileRewind: portOf(calls),
    overrides: {
      threads: {
        closed: (threadId) => ok(threadId === special.closed),
        openTurnOf: (threadId) => ok(threadId === special.busy ? TURN : undefined),
      },
    },
  });
  const owned = host.fake.seedThread();
  special.busy = host.fake.seedThread();
  special.closed = host.fake.seedThread();
  const connection = await open(host);
  const to: ItemId = host.fake.ids.next("itm");

  // 소유가 없으면 3002다. 읽기는 소유 없이 된다
  const notOwner = await wireErrorOf(connection.request("thread.rewind", { threadId: owned, to }));
  expect(notOwner.code).toBe(3002);
  await connection.request("thread.rewindPreview", { threadId: owned, to });
  expect(calls).toEqual(["preview"]);

  await connection.request("thread.open", { threadId: owned, mode: "write" });
  await connection.request("thread.open", { threadId: special.busy, mode: "write" });
  // 열린 turn이 있으면 3003이고 turnId를 싣는다. 파일은 건드리지 않는다
  const busy = await wireErrorOf(
    connection.request("thread.rewind", { threadId: special.busy, to }),
  );
  expect(busy.code).toBe(3003);
  expect(busy.data.details).toEqual({ turnId: TURN });
  expect(calls).toEqual(["preview"]);

  // 닫힌 대화는 3007이다(소유를 얻은 뒤에 본다)
  await connection.request("thread.open", { threadId: special.closed, mode: "write" });
  const closed = await wireErrorOf(
    connection.request("thread.rewind", { threadId: special.closed, to }),
  );
  expect(closed.code).toBe(3007);
  expect(calls).toEqual(["preview"]);
  await connection.close();
});

test("thread.rewind moves the files first and then the conversation, and reports the new leaf", async () => {
  const calls: string[] = [];
  const host = createFakeHost({
    fileRewind: portOf(calls),
    overrides: {
      threads: {
        leafOf: () => Promise.resolve(ok(OLD_LEAF)),
        revert: () => {
          calls.push("revert");
          return Promise.resolve(ok({ position: POSITION, leaf: LEAF }));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const to: ItemId = host.fake.ids.next("itm");
  const connection = await open(host);
  await connection.request("thread.open", { threadId, mode: "write" });
  expect(await connection.request("thread.rewind", { threadId, to })).toEqual({
    rewindId: REWIND_ID,
    leaf: LEAF,
    headSeq: POSITION.seq,
    files: [FILE_RESULT],
    kept: [],
    untracked: [],
  });
  // 파일이 먼저다. 서비스는 대화를 옮기기 전의 leaf를 받는다
  expect(calls).toEqual([`apply:both:${OLD_LEAF}`, "revert"]);
  await connection.close();
});

test("a conversation revert refused after the files moved is thrown, and the files stay restored", async () => {
  const calls: string[] = [];
  const host = createFakeHost({
    fileRewind: portOf(calls),
    overrides: {
      threads: {
        leafOf: () => Promise.resolve(ok(OLD_LEAF)),
        revert: () => {
          calls.push("revert");
          return Promise.resolve(err({ kind: "turn_running", turnId: TURN }));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const to: ItemId = host.fake.ids.next("itm");
  const connection = await open(host);
  await connection.request("thread.open", { threadId, mode: "write" });
  const refused = await wireErrorOf(connection.request("thread.rewind", { threadId, to }));
  expect(refused.code).toBe(3003);
  // 파일은 이미 되돌아갔다(서비스가 적용을 끝냈다). 되돌리기로 되돌릴 수 있는 상태다
  expect(calls).toEqual([`apply:both:${OLD_LEAF}`, "revert"]);
  await connection.close();
});

test("scope files moves no conversation and scope conversation moves no file", async () => {
  const calls: string[] = [];
  const host = createFakeHost({
    fileRewind: portOf(calls),
    overrides: {
      threads: {
        leafOf: () => Promise.resolve(ok(OLD_LEAF)),
        revert: () => {
          calls.push("revert");
          return Promise.resolve(ok({ position: POSITION, leaf: LEAF }));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const to: ItemId = host.fake.ids.next("itm");
  const connection = await open(host);
  await connection.request("thread.open", { threadId, mode: "write" });
  const files = await connection.request("thread.rewind", { threadId, to, scope: "files" });
  expect(files).toEqual({
    rewindId: REWIND_ID,
    files: [FILE_RESULT],
    kept: [],
    untracked: [],
  });
  expect(calls).toEqual([`apply:files:${OLD_LEAF}`]);
  calls.length = 0;
  const conversation = await connection.request("thread.rewind", {
    threadId,
    to,
    scope: "conversation",
  });
  expect(conversation).toEqual({
    rewindId: REWIND_ID,
    leaf: LEAF,
    headSeq: POSITION.seq,
    files: [],
    kept: [],
    untracked: [],
  });
  expect(calls).toEqual(["revert"]);
  await connection.close();
});

test("rewindUndo moves the conversation back to the old leaf before the files, then reports the recorded state", async () => {
  const calls: string[] = [];
  let leaf: EventId = TARGET;
  const host = createFakeHost({
    fileRewind: portOf(calls, {
      undoneConversationOf: () => Promise.resolve(ok("restored")),
    }),
    overrides: {
      threads: {
        leafOf: () => Promise.resolve(ok(leaf)),
        restoreLeaf: (_threadId, target) => {
          calls.push(`restore:${target === OLD_LEAF ? "old" : "other"}`);
          leaf = target;
          return Promise.resolve(ok({ position: POSITION }));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  await connection.request("thread.open", { threadId, mode: "write" });
  const undone = await connection.request("thread.rewindUndo", { threadId, rewindId: REWIND_ID });
  expect(undone).toEqual({ files: [FILE_RESULT], conversation: "restored" });
  expect(calls).toEqual(["restore:old", "undoFiles"]);

  // 대화가 되감기 뒤 더 나아갔으면 대화는 건드리지 않는다
  calls.length = 0;
  leaf = LEAF;
  await connection.request("thread.rewindUndo", { threadId, rewindId: REWIND_ID });
  expect(calls).toEqual(["undoFiles"]);
  await connection.close();
});

test("an unknown rewind id is -32602 at /rewindId and a store failure of the port is the store's error", async () => {
  const unknown = createFakeHost({
    fileRewind: portOf([], { startedOf: () => Promise.resolve(ok(undefined)) }),
  });
  const unknownThread = unknown.fake.seedThread();
  const unknownConnection = await open(unknown);
  await unknownConnection.request("thread.open", { threadId: unknownThread, mode: "write" });
  const missing = await wireErrorOf(
    unknownConnection.request("thread.rewindUndo", {
      threadId: unknownThread,
      rewindId: REWIND_ID,
    }),
  );
  expect(missing.code).toBe(-32602);
  expect(missing.data.details).toEqual({
    issues: [{ path: "/rewindId", message: "unknown rewind" }],
  });
  await unknownConnection.close();

  const broken = createFakeHost({
    fileRewind: portOf([], { startedOf: () => Promise.resolve(err({ kind: "busy" })) }),
  });
  const brokenThread = broken.fake.seedThread();
  const brokenConnection = await open(broken);
  await brokenConnection.request("thread.open", { threadId: brokenThread, mode: "write" });
  const busy = await wireErrorOf(
    brokenConnection.request("thread.rewindUndo", { threadId: brokenThread, rewindId: REWIND_ID }),
  );
  expect(busy.data.kind).toBe("store.busy");
  await brokenConnection.close();
});

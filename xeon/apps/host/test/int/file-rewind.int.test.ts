import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { ItemId, JsonObject, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import { WireError, type HostConnection } from "@fresnel/contracts/wire";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, type InProcessHost } from "../../src/command-run.ts";
import type { AssembleOptions } from "../../src/types.ts";
import type { ToolStep } from "../fixtures/call-tape.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { realTapeClock, stallingModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import {
  collectEvents,
  HELLO_PARAMS,
  startTurnWhenIdle,
  type EventCollector,
} from "../fixtures/wire-client.ts";

// 파일 되감기(M4, L4.host-service 파일 되감기 절, F.wire-settings §3.3.1)의 실제 엔진 시험. 편집 도구(write, edit)는 모델 테이프가 부른다.
// 파일 내용은 응답에 없어야 한다(경로와 결과만). 시험은 실제 저장소와 임시 폴더를 쓴다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

// 승인 없이 편집 도구가 돌도록 bypass다. 승인 경로는 다른 시험이 본다
const REWIND_SETTINGS: Readonly<Record<string, unknown>> = {
  ...TAPE_SETTINGS,
  "l1.tools.permissionMode": "bypass",
};

type BuildModels = NonNullable<AssembleOptions["buildModels"]>;

/** 턴마다 도구 호출을 차례로 내고 한 마디로 끝낸다. 턴들은 한 개의 테이프 큐를 이어 쓴다 */
function turnModels(id: string, turns: readonly (readonly ToolStep[])[]): BuildModels {
  const responses = turns.flatMap((steps, turn) => [
    ...steps.map((step, index) => ({
      role: "main" as const,
      label: `turn ${String(turn + 1)} step ${String(index + 1)}: ${step.name}`,
      response: {
        type: "message" as const,
        content: [
          t.toolCall(step.name, step.args, `call_${String(turn + 1)}_${String(index + 1)}`),
        ],
        stopReason: "toolUse" as const,
      },
    })),
    {
      role: "main" as const,
      label: `turn ${String(turn + 1)} answer`,
      response: {
        type: "message" as const,
        content: [t.text("done.")],
        stopReason: "stop" as const,
      },
    },
  ]);
  return tapeBuildModels(tapeProvider(tapePlayer(tape(id, responses), { clock: realTapeClock() })));
}

const write = (path: string, content: string): ToolStep => ({
  name: "write",
  args: { path, content } satisfies JsonObject,
});

const edit = (path: string, oldText: string, newText: string): ToolStep => ({
  name: "edit",
  args: { path, edits: [{ oldText, newText }] } satisfies JsonObject,
});

interface Session {
  readonly home: EngineHome;
  readonly host: InProcessHost;
  readonly connection: HostConnection;
  readonly events: EventCollector;
  close(): Promise<void>;
}

/** 시험마다 새 엔진 홈에서 시작한다. 같은 홈을 이어 여는 시험은 `shared`로 넘긴다 */
async function start(models: BuildModels | undefined, shared?: EngineHome): Promise<Session> {
  const home = shared ?? useEngineHome();
  if (shared === undefined) writeUserSettings(home, REWIND_SETTINGS);
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    ...(models === undefined ? {} : { buildModels: models }),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const events = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  return {
    home,
    host,
    connection,
    events,
    async close() {
      await connection.close();
      await host.close();
      if (shared === undefined) home.dispose();
    },
  };
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/** 폴더 하나를 실제 경로로 만든다. 시험이 끝나면 지운다 */
function makeFolder(): { readonly dir: string; dispose(): void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "xh-rewind-")));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

async function runTurn(session: Session, threadId: ThreadId, input: string): Promise<TurnId> {
  const started = await startTurnWhenIdle(session.connection, { threadId, input });
  await session.events.waitFor(
    (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
    60_000,
  );
  return started.turnId;
}

/** 지금까지 쓴 `user` item 가운데 `index`번째(0부터)의 id */
async function userItem(session: Session, threadId: ThreadId, index: number): Promise<ItemId> {
  const read = await session.connection.request("thread.read", { threadId });
  const users = read.items.filter((item) => item.kind === "user");
  return must(users[index], `user item ${String(index)}`).itemId;
}

async function createThread(session: Session, workspace: string): Promise<ThreadId> {
  const created = await session.connection.request("thread.create", { workspace });
  return created.threadId;
}

/** 추적 밖 효과의 턴과 종류만 값으로 비교한다(도구 호출 id는 뺀다) */
function shellOf(
  effects: readonly { readonly turnId: TurnId; readonly kind: string }[],
): { readonly turnId: TurnId; readonly kind: string }[] {
  return effects.map((effect) => ({ turnId: effect.turnId, kind: effect.kind }));
}

/** 되감기 결과 목록에서 파일 이름(폴더 안 상대 이름)으로 찾는다. 경로는 정규 절대 경로다 */
function fileOf<F extends { readonly path: string }>(files: readonly F[], name: string): F {
  return must(
    files.find((file) => file.path.endsWith(`/${name}`)),
    `a file result for ${name}`,
  );
}

describe("thread.rewind (both) on the edit tools", () => {
  realTest(
    "restores edited, created and binary files and takes the conversation back to the item",
    async () => {
      const folder = makeFolder();
      try {
        writeFileSync(join(folder.dir, "notes.txt"), "original notes\n");
        const binary = Buffer.from([0, 1, 2, 255, 0, 9]);
        writeFileSync(join(folder.dir, "data.bin"), binary);
        const session = await start(
          turnModels("rewind-both", [
            [
              write("notes.txt", "agent notes\n"),
              write("fresh.txt", "fresh\n"),
              write("data.bin", "\u0000agent\u0001"),
            ],
            [edit("notes.txt", "agent notes", "second notes")],
          ]),
        );
        const threadId = await createThread(session, folder.dir);
        await runTurn(session, threadId, "first");
        const first = await userItem(session, threadId, 0);
        await runTurn(session, threadId, "second");
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("second notes\n");

        const rewound = await session.connection.request("thread.rewind", {
          threadId,
          to: first,
        });
        expect(rewound.rewindId).toMatch(/^rwd_[a-z0-9]{8,64}$/);
        expect(rewound.leaf).toBeDefined();
        expect(rewound.headSeq).toBeGreaterThan(0);
        expect(fileOf(rewound.files, "notes.txt").outcome).toBe("restored");
        expect(fileOf(rewound.files, "fresh.txt").outcome).toBe("deleted");
        expect(fileOf(rewound.files, "data.bin").outcome).toBe("restored");
        expect(rewound.kept).toEqual([]);
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("original notes\n");
        expect(existsSync(join(folder.dir, "fresh.txt"))).toBe(false);
        expect(readFileSync(join(folder.dir, "data.bin")).equals(binary)).toBe(true);
        // 파일 내용은 응답에 없다
        const wire = JSON.stringify(rewound);
        expect(wire).not.toContain("original notes");
        expect(wire).not.toContain("agent notes");
        // 대화도 그 item에서 끝난다
        const read = await session.connection.request("thread.read", { threadId });
        expect(read.items.map((item) => item.kind)).toEqual(["user"]);
        await session.close();
      } finally {
        folder.dispose();
      }
    },
    60_000,
  );
});

describe("outside edits and other conversations", () => {
  realTest(
    "kept files stay and are listed; overwrite restores one; preview and turnFiles change nothing",
    async () => {
      const folder = makeFolder();
      try {
        writeFileSync(join(folder.dir, "notes.txt"), "original\n");
        writeFileSync(join(folder.dir, "shared.txt"), "original shared\n");
        const session = await start(
          turnModels("rewind-kept", [
            [write("notes.txt", "A notes\n"), write("shared.txt", "A shared\n")],
            // 두 번째 대화가 같은 폴더의 같은 파일을 고친다
            [edit("shared.txt", "A shared", "B shared")],
          ]),
        );
        const threadA = await createThread(session, folder.dir);
        const threadB = await createThread(session, folder.dir);
        const turnA = await runTurn(session, threadA, "a1");
        const aFirst = await userItem(session, threadA, 0);
        await runTurn(session, threadB, "b1");
        // 대화 밖에서 바뀐 파일
        writeFileSync(join(folder.dir, "notes.txt"), "user notes\n");

        const preview = await session.connection.request("thread.rewindPreview", {
          threadId: threadA,
          to: aFirst,
        });
        expect(fileOf(preview.files, "notes.txt")).toMatchObject({
          action: "keep",
          reason: "changed_outside",
        });
        expect(fileOf(preview.files, "shared.txt")).toMatchObject({
          action: "keep",
          reason: "changed_outside",
        });
        expect(preview.untracked).toEqual([]);
        expect(preview.incomplete).toEqual([]);
        // 미리보기는 파일을 바꾸지 않는다
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("user notes\n");
        expect(readFileSync(join(folder.dir, "shared.txt"), "utf8")).toBe("B shared\n");

        const turnFiles = await session.connection.request("thread.turnFiles", {
          threadId: threadA,
          turnId: turnA,
        });
        expect(turnFiles.turns).toHaveLength(1);
        expect(turnFiles.incomplete).toEqual([]);
        expect(fileOf(must(turnFiles.turns[0], "a turn").files, "notes.txt")).toMatchObject({
          existedBefore: true,
          restorable: true,
          unrestorableReason: null,
          touches: 1,
        });

        const rewound = await session.connection.request("thread.rewind", {
          threadId: threadA,
          to: aFirst,
        });
        expect(fileOf(rewound.kept, "notes.txt")).toMatchObject({ reason: "changed_outside" });
        expect(fileOf(rewound.kept, "shared.txt")).toMatchObject({ reason: "changed_outside" });
        expect(fileOf(rewound.files, "notes.txt").outcome).toBe("kept_changed");
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("user notes\n");
        // 다른 대화가 고친 파일은 남는다
        expect(readFileSync(join(folder.dir, "shared.txt"), "utf8")).toBe("B shared\n");

        // 밖에서 바뀐 파일 하나만 덮어쓴다
        const overwritten = await session.connection.request("thread.rewindOverwrite", {
          threadId: threadA,
          rewindId: rewound.rewindId,
          paths: [fileOf(rewound.kept, "notes.txt").path],
        });
        expect(fileOf(overwritten.files, "notes.txt").outcome).toBe("restored");
        expect(fileOf(overwritten.kept, "shared.txt")).toBeDefined();
        expect(overwritten.kept.some((kept) => kept.path.endsWith("/notes.txt"))).toBe(false);
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("original\n");
        expect(readFileSync(join(folder.dir, "shared.txt"), "utf8")).toBe("B shared\n");
        await session.close();
      } finally {
        folder.dispose();
      }
    },
    60_000,
  );
});

describe("undo, scopes and the turn view", () => {
  realTest(
    "rewindUndo restores the files and the conversation, then says moved_on once the conversation went on",
    async () => {
      const folder = makeFolder();
      try {
        writeFileSync(join(folder.dir, "notes.txt"), "original\n");
        const session = await start(
          turnModels("rewind-undo", [
            [write("notes.txt", "turn one\n")],
            [edit("notes.txt", "turn one", "turn two")],
            [],
          ]),
        );
        const threadId = await createThread(session, folder.dir);
        const turn1 = await runTurn(session, threadId, "one");
        const first = await userItem(session, threadId, 0);
        await runTurn(session, threadId, "two");

        // 턴 보기: 턴마다 만진 파일과 미완료 되감기 목록
        const view = await session.connection.request("thread.turnFiles", { threadId });
        expect(view.turns.map((turn) => turn.turnId)).toHaveLength(2);
        expect(view.incomplete).toEqual([]);
        expect(
          fileOf(
            must(
              view.turns.find((turn) => turn.turnId === turn1),
              "turn one",
            ).files,
            "notes.txt",
          ).existedBefore,
        ).toBe(true);

        const rewound = await session.connection.request("thread.rewind", {
          threadId,
          to: first,
        });
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("original\n");

        const undone = await session.connection.request("thread.rewindUndo", {
          threadId,
          rewindId: rewound.rewindId,
        });
        expect(undone.conversation).toBe("restored");
        expect(fileOf(undone.files, "notes.txt").outcome).toBe("restored");
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("turn two\n");
        const restored = await session.connection.request("thread.read", { threadId });
        expect(restored.items.filter((item) => item.kind === "user")).toHaveLength(2);
        // 되돌리기를 다시 불러도 처음 결과다
        const again = await session.connection.request("thread.rewindUndo", {
          threadId,
          rewindId: rewound.rewindId,
        });
        expect(again.conversation).toBe("restored");

        // 파일만 되감으면 대화는 그대로이고, 되돌리기는 대화를 not_included로 답한다
        const filesOnly = await session.connection.request("thread.rewind", {
          threadId,
          to: first,
          scope: "files",
        });
        expect(filesOnly.leaf).toBeUndefined();
        expect(filesOnly.headSeq).toBeUndefined();
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("original\n");
        const kept = await session.connection.request("thread.read", { threadId });
        expect(kept.items.filter((item) => item.kind === "user")).toHaveLength(2);
        const filesUndone = await session.connection.request("thread.rewindUndo", {
          threadId,
          rewindId: filesOnly.rewindId,
        });
        expect(filesUndone.conversation).toBe("not_included");
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("turn two\n");

        // 되감은 뒤 대화가 더 나아갔다면 되돌리기는 대화를 건드리지 않는다
        const second = await session.connection.request("thread.rewind", {
          threadId,
          to: first,
        });
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("original\n");
        await runTurn(session, threadId, "three");
        const movedOn = await session.connection.request("thread.rewindUndo", {
          threadId,
          rewindId: second.rewindId,
        });
        expect(movedOn.conversation).toBe("moved_on");
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("turn two\n");
        await session.close();
      } finally {
        folder.dispose();
      }
    },
    60_000,
  );

  realTest(
    "a file over the 16 MiB limit is skipped as too_large in preview and in the rewind",
    async () => {
      const folder = makeFolder();
      try {
        // UTF-8이 아닌 바이트로 쓴다. 텍스트면 쓰기 도구가 줄 단위 변경 기록을 17 MiB 전체에 대해 계산해 시험이 끝나지 않는다.
        // 상한 검사는 내용 종류와 무관하므로 이 시험의 대상(원본 저장 상한)은 그대로다
        const big = Buffer.alloc(17 * 1024 * 1024, 0xff);
        writeFileSync(join(folder.dir, "big.bin"), big);
        const session = await start(turnModels("rewind-big", [[write("big.bin", "small\n")]]));
        const threadId = await createThread(session, folder.dir);
        await runTurn(session, threadId, "big");
        const first = await userItem(session, threadId, 0);
        const preview = await session.connection.request("thread.rewindPreview", {
          threadId,
          to: first,
        });
        expect(fileOf(preview.files, "big.bin")).toMatchObject({
          action: "skip",
          reason: "too_large",
        });
        const rewound = await session.connection.request("thread.rewind", {
          threadId,
          to: first,
        });
        expect(fileOf(rewound.files, "big.bin")).toMatchObject({
          outcome: "skipped",
          reason: "too_large",
        });
        expect(readFileSync(join(folder.dir, "big.bin"), "utf8")).toBe("small\n");
        await session.close();
      } finally {
        folder.dispose();
      }
    },
    60_000,
  );

  realTest(
    "scope conversation moves only the branch and records no file rewind",
    async () => {
      const folder = makeFolder();
      try {
        writeFileSync(join(folder.dir, "notes.txt"), "original\n");
        const session = await start(turnModels("rewind-conv", [[write("notes.txt", "agent\n")]]));
        const threadId = await createThread(session, folder.dir);
        await runTurn(session, threadId, "one");
        const first = await userItem(session, threadId, 0);
        const moved = await session.connection.request("thread.rewind", {
          threadId,
          to: first,
          scope: "conversation",
        });
        expect(moved.files).toEqual([]);
        expect(moved.leaf).toBeDefined();
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("agent\n");
        const read = await session.connection.request("thread.read", { threadId });
        expect(read.items.map((item) => item.kind)).toEqual(["user"]);
        await session.close();
      } finally {
        folder.dispose();
      }
    },
    60_000,
  );
});

describe("untracked effects", () => {
  realTest(
    "a shell command in the range is listed as untracked and is not undone; the edited file still is",
    async () => {
      const folder = makeFolder();
      try {
        writeFileSync(join(folder.dir, "notes.txt"), "original\n");
        const session = await start(
          turnModels("rewind-untracked", [
            [
              write("notes.txt", "agent\n"),
              { name: "bash", args: { command: "echo side > side.txt" } },
            ],
          ]),
        );
        const threadId = await createThread(session, folder.dir);
        const turn = await runTurn(session, threadId, "shell");
        const first = await userItem(session, threadId, 0);
        const preview = await session.connection.request("thread.rewindPreview", {
          threadId,
          to: first,
        });
        expect(shellOf(preview.untracked)).toEqual([{ turnId: turn, kind: "shell" }]);
        const rewound = await session.connection.request("thread.rewind", {
          threadId,
          to: first,
        });
        expect(shellOf(rewound.untracked)).toEqual([{ turnId: turn, kind: "shell" }]);
        expect(fileOf(rewound.files, "notes.txt").outcome).toBe("restored");
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("original\n");
        await session.close();
      } finally {
        folder.dispose();
      }
    },
    60_000,
  );
});

describe("restart and refusals", () => {
  realTest(
    "a rewind still works after the engine is closed and opened again on the same store",
    async () => {
      const folder = makeFolder();
      try {
        writeFileSync(join(folder.dir, "notes.txt"), "original\n");
        const first = await start(turnModels("rewind-restart", [[write("notes.txt", "agent\n")]]));
        const threadId = await createThread(first, folder.dir);
        await runTurn(first, threadId, "one");
        const item = await userItem(first, threadId, 0);
        await first.connection.close();
        await first.host.close();

        const second = await start(undefined, first.home);
        await second.connection.request("thread.open", { threadId, mode: "write" });
        const rewound = await second.connection.request("thread.rewind", { threadId, to: item });
        expect(fileOf(rewound.files, "notes.txt").outcome).toBe("restored");
        expect(readFileSync(join(folder.dir, "notes.txt"), "utf8")).toBe("original\n");
        await second.close();
        first.home.dispose();
      } finally {
        folder.dispose();
      }
    },
    60_000,
  );

  realTest(
    "unknown thread is 3001, a thread this connection does not own is 3002, an item off the branch is 3005",
    async () => {
      const folder = makeFolder();
      try {
        writeFileSync(join(folder.dir, "notes.txt"), "original\n");
        const session = await start(
          turnModels("rewind-refuse", [[write("notes.txt", "agent\n")], []]),
        );
        const threadId = await createThread(session, folder.dir);
        await runTurn(session, threadId, "one");
        const first = await userItem(session, threadId, 0);
        await runTurn(session, threadId, "two");
        const second = await userItem(session, threadId, 1);

        const unknown = session.host.engine.ports.ids.next("thr");
        const missing = await wireErrorOf(
          session.connection.request("thread.rewind", { threadId: unknown, to: first }),
        );
        expect(missing.code).toBe(3001);
        const missingPreview = await wireErrorOf(
          session.connection.request("thread.rewindPreview", { threadId: unknown, to: first }),
        );
        expect(missingPreview.code).toBe(3001);

        // 되감기 뒤 두 번째 user item은 가지 밖이다
        await session.connection.request("thread.rewind", { threadId, to: first });
        const off = await wireErrorOf(
          session.connection.request("thread.rewind", { threadId, to: second }),
        );
        expect(off.code).toBe(3005);
        expect(off.data.details).toEqual({ reason: "not_on_branch" });

        // 알 수 없는 되감기 식별자는 인수 오류다
        const unknownRewind = await wireErrorOf(
          session.connection.request("thread.rewindUndo", {
            threadId,
            rewindId: "rwd_aaaaaaaaaaaaaaaa",
          }),
        );
        expect(unknownRewind.code).toBe(-32602);

        // 쓰기 소유가 없는 연결은 쓰는 되감기를 못 한다. 같은 저장소를 여는 두 번째 호스트다
        const reader = await start(undefined, session.home);
        const notOwner = await wireErrorOf(
          reader.connection.request("thread.rewind", { threadId, to: first }),
        );
        expect(notOwner.code).toBe(3002);
        // 읽기는 소유 없이 된다
        const preview = await reader.connection.request("thread.rewindPreview", {
          threadId,
          to: first,
        });
        expect(preview.toEventId).toBeDefined();
        await reader.close();
        await session.close();
      } finally {
        folder.dispose();
      }
    },
    60_000,
  );

  realTest(
    "an open turn refuses every rewind with 3003",
    async () => {
      const folder = makeFolder();
      try {
        writeFileSync(join(folder.dir, "notes.txt"), "original\n");
        const session = await start(stallingModels("rewind-stall"));
        const threadId = await createThread(session, folder.dir);
        await startTurnWhenIdle(session.connection, { threadId, input: "wait" });
        const refused = await wireErrorOf(
          session.connection.request("thread.rewind", {
            threadId,
            to: session.host.engine.ports.ids.next("itm"),
          }),
        );
        expect(refused.code).toBe(3003);
        await session.connection.request("turn.interrupt", { threadId });
        await session.close();
      } finally {
        folder.dispose();
      }
    },
    60_000,
  );
});

import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { isId, type ContextRef, type ThreadId } from "@fresnel/contracts/conversation";
import {
  WireError,
  type EventWire,
  type HostConnection,
  type ThreadSummary,
} from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, type InProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, type EventCollector } from "../fixtures/wire-client.ts";

// 테스트 대화(craftChat.open, craftChat.list). 실제 엔진이고 임시 홈에서 돈다. 모델은 쓰지 않는다: 열기, 목록, 맥락 참조는 저장소가 맡는다.
// 플러그인 원본 폴더는 `<설정>/plugins/<이름>`이다. 있으면 대화의 작업 폴더가 된다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const PLUGIN = "demo-kit";
/** 글을 대화 id로 좁힌다. 모양이 맞지 않으면 시험 설정 오류다 */
function threadIdOf(text: string): ThreadId {
  if (!isId("thr", text)) throw new Error(`not a thread id: ${text}`);
  return text;
}

const NO_SUCH_THREAD = threadIdOf("thr_01ARZ3NDEKTSV4RRFFQ69G5FAX");
const NO_SUCH_TURN = "trn_01ARZ3NDEKTSV4RRFFQ69G5FAX";

interface Session {
  readonly home: EngineHome;
  readonly host: InProcessHost;
  readonly connection: HostConnection;
  readonly collector: EventCollector;
}

async function open(): Promise<Session> {
  const home = useEngineHome();
  writeUserSettings(home, TAPE_SETTINGS);
  const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  return { home, host, connection, collector };
}

async function close(session: Session): Promise<void> {
  await session.connection.close();
  await session.host.close();
  session.home.dispose();
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

/**
 * 두 목록에서 같은 값이어야 하는 칸. `headSeq`·`updatedAt`은 열 때의 시작 사건이 뒤늦게 커밋되며 움직이고,
 * `project`는 `thread.list`만 싣는 칸이라 뺀다
 */
function stableOf(row: ThreadSummary) {
  return {
    threadId: row.threadId,
    title: row.title,
    workspace: row.workspace,
    profileId: row.profileId,
    craftChat: row.craftChat,
  };
}

/** `thread.list { include: "craft" }`에서 한 대화의 행. 없으면 시험이 실패한다 */
async function craftRowOf(connection: HostConnection, threadId: string): Promise<ThreadSummary> {
  const listed = await connection.request("thread.list", { include: "craft" });
  const row = listed.threads.find((thread) => thread.threadId === threadId);
  if (row === undefined) throw new Error(`the test conversation ${threadId} is not listed`);
  return row;
}

realTest(
  "craftChat.open and craftChat.list: a test conversation without a plugin is listed only under null, reuse last returns it, reuse new makes another, and ordinary threads stay out",
  async () => {
    const session = await open();
    const { connection } = session;
    try {
      const plain = await connection.request("thread.create", { title: "일반 대화" });
      const first = await connection.request("craftChat.open", { plugin: null, intent: "첫 초안" });
      expect(first).toEqual({ threadId: expect.any(String), plugin: null, reused: false });

      // 테스트 대화는 기본 목록에 없고, `include: "craft"`에서만 보인다
      const plainList = await connection.request("thread.list", {});
      expect(plainList.threads.map((thread) => thread.threadId)).toEqual([plain.threadId]);
      const firstRow = await craftRowOf(connection, first.threadId);
      expect(firstRow).toMatchObject({
        title: "첫 초안",
        workspace: null,
        profileId: "craft",
        craftChat: { plugin: null },
      });

      // 목록은 묶이지 않은 테스트 대화만 낸다(일반 대화는 없다)
      const listedNull = await connection.request("craftChat.list", { plugin: null });
      expect(listedNull.threads.map(stableOf)).toEqual([stableOf(firstRow)]);

      // `reuse: "last"`는 그 대화를 다시 연다
      expect(await connection.request("craftChat.open", { plugin: null, reuse: "last" })).toEqual({
        threadId: first.threadId,
        plugin: null,
        reused: true,
      });
      // 기본(`new`)은 새 대화를 만든다. 목록은 최신 먼저다
      const second = await connection.request("craftChat.open", { plugin: null });
      expect(second).toEqual({ threadId: expect.any(String), plugin: null, reused: false });
      expect(second.threadId).not.toBe(first.threadId);
      const newest = await connection.request("craftChat.list", { plugin: null });
      expect(newest.threads.map((thread) => thread.threadId)).toEqual([
        second.threadId,
        first.threadId,
      ]);

      // 다른 플러그인의 목록에는 없다
      expect(await connection.request("craftChat.list", { plugin: PLUGIN })).toEqual({
        threads: [],
      });

      // 플러그인 이름이 확장 이름 문법에 맞지 않으면 거절한다
      const bad = await wireErrorOf(
        connection.request("craftChat.open", { plugin: "Bad_Name", reuse: "new" }),
      );
      expect(bad.data.kind).toBe("jsonrpc.invalidParams");
    } finally {
      await close(session);
    }
  },
  60_000,
);

realTest(
  "a plugin's test conversation runs in the plugin folder when that folder exists, and lists under its plugin only",
  async () => {
    const session = await open();
    const { connection, home } = session;
    try {
      // 플러그인 원본 폴더: <설정>/plugins/<이름>
      const folder = join(home.root, "config", "plugins", PLUGIN);
      mkdirSync(folder, { recursive: true });
      const canonical = realpathSync(folder);

      const opened = await connection.request("craftChat.open", {
        plugin: PLUGIN,
        intent: "데모 고치기",
      });
      expect(opened).toEqual({ threadId: expect.any(String), plugin: PLUGIN, reused: false });
      const row = await craftRowOf(connection, opened.threadId);
      expect(row).toMatchObject({
        title: "데모 고치기",
        workspace: canonical,
        craftChat: { plugin: PLUGIN },
      });
      const listed = await connection.request("craftChat.list", { plugin: PLUGIN });
      expect(listed.threads.map(stableOf)).toEqual([stableOf(row)]);
      expect(await connection.request("craftChat.list", { plugin: null })).toEqual({ threads: [] });

      // 원본 폴더가 없는 플러그인은 작업 폴더 없이 만든다
      const bare = await connection.request("craftChat.open", { plugin: "bare-kit" });
      const bareRow = await craftRowOf(connection, bare.threadId);
      expect(bareRow).toMatchObject({ workspace: null, craftChat: { plugin: "bare-kit" } });

      // 같은 플러그인을 `reuse: "last"`로 열면 그 대화를 다시 연다. 새 의도는 제목을 바꾸지 않는다
      expect(
        await connection.request("craftChat.open", {
          plugin: PLUGIN,
          reuse: "last",
          intent: "다른 의도",
        }),
      ).toEqual({ threadId: opened.threadId, plugin: PLUGIN, reused: true });
      const again = await craftRowOf(connection, opened.threadId);
      expect(again.title).toBe("데모 고치기");
    } finally {
      await close(session);
    }
  },
  60_000,
);

realTest(
  "craftChat.open records the context references and the intent as craft.context, and a reuse records its own",
  async () => {
    const session = await open();
    const { connection, collector } = session;
    try {
      const refs: ContextRef[] = [
        { kind: "plugin", name: PLUGIN },
        { kind: "turn", threadId: NO_SUCH_THREAD, turnId: NO_SUCH_TURN },
      ];
      const opened = await connection.request("craftChat.open", {
        plugin: null,
        intent: "맥락 시험",
        context: refs,
      });
      const first = await collector.waitFor(
        (event) => event.kind === "craft.context" && event.threadId === opened.threadId,
      );
      // 맥락은 사건 하나로 남고 참조와 의도가 그대로다
      expect(first.payload).toEqual({ refs, intent: "맥락 시험" });

      // 다시 열면 그 대화에 사건이 하나 더 남는다(의도만 있어도 남는다)
      await connection.request("craftChat.open", {
        plugin: null,
        reuse: "last",
        intent: "두 번째 의도",
      });
      await collector.waitFor(
        (event) =>
          event.kind === "craft.context" &&
          event.threadId === opened.threadId &&
          event.id !== first.id,
      );
      const contexts = collector.events
        .filter(
          (event: EventWire) =>
            event.kind === "craft.context" && event.threadId === opened.threadId,
        )
        .map((event) => event.payload);
      expect(contexts).toEqual([
        { refs, intent: "맥락 시험" },
        { refs: [], intent: "두 번째 의도" },
      ]);

      // 맥락 참조는 16개까지다
      const tooMany = await wireErrorOf(
        connection.request("craftChat.open", {
          plugin: null,
          context: Array.from({ length: 17 }, (_, index): ContextRef => ({
            kind: "plugin",
            name: `plug-${String(index)}`,
          })),
        }),
      );
      expect(tooMany.data.kind).toBe("jsonrpc.invalidParams");
    } finally {
      await close(session);
    }
  },
  60_000,
);

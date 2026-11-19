import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { smokeGroup } from "@fresnel/group-sdk/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startInputWhenIdle } from "../fixtures/wire-client.ts";

// M5c §4.1.14 6번, AGE-47: 첫 메시지를 보내기 전에 프로필을 바꾼 대화는 "그 프로필로 시작한 대화"다. 직전 프로필이 무엇이든 새 프로필의
// 시작 Drive가 첫 메시지를 받는다(`delivered`). 첫 메시지 뒤의 전환은 시작 Drive를 시작하지 않는다(스펙 기본값, 미결 3).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const REPLIES = Array.from({ length: 6 }, (_, index) => ({
  role: "main" as const,
  label: `reply ${index}`,
  response: { type: "message" as const, content: [t.text("ok.")], stopReason: "stop" as const },
}));

type Outcome = "delivered" | "turn";

realTest(
  "thread.setProfile before the first message starts the new profile's start drive whatever the previous profile was; after it, it does not",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    // driveTurns 0, followUps 0인 스모크 그룹은 첫 메시지를 받고 처리하지 않는다: 시작 Drive가 있으면 `delivered`, 없으면 코어 루프의 turn이다
    const group = smokeGroup({ followUps: 0, driveTurns: 0 });
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      extraPlugins: [{ manifest: group.manifest, extension: group.entry }],
      buildModels: tapeBuildModels(
        tapeProvider(tapePlayer(tape("switch", REPLIES), { clock: realTapeClock() })),
      ),
    });
    try {
      const connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      const name = group.manifest.name;
      const put = (id: string, startDrive: string | null) =>
        connection.request("profile.put", {
          profile: { id, title: id, plugins: [{ name }], settings: [], startDrive },
          baseRev: null,
        });
      await put("plain", null);
      await put("review", name);
      await put("review2", name);

      let counter = 0;
      const send = async (threadId: ThreadId, input: string): Promise<Outcome> => {
        counter += 1;
        const result = await startInputWhenIdle(connection, {
          threadId,
          input,
          requestId: `req-${counter}`,
        });
        return "turnId" in result ? "turn" : "delivered";
      };
      const settled = async (from: number): Promise<void> => {
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && collector.events.indexOf(event) >= from,
          20_000,
        );
      };
      const createFrom = async (from: string | undefined): Promise<ThreadId> =>
        (await connection.request("thread.create", from === undefined ? {} : { profileId: from }))
          .threadId;

      // 첫 메시지 전의 전환: 직전 프로필이 기본, 시작 Drive 없는 프로필, 시작 Drive 있는 프로필이어도 결과가 같다
      const beforeFirst = async (from: string | undefined): Promise<Outcome> => {
        const threadId = await createFrom(from);
        await connection.request("thread.setProfile", { threadId, profileId: "review" });
        return await send(threadId, "hello");
      };
      const before = {
        default: await beforeFirst(undefined),
        plain: await beforeFirst("plain"),
        review2: await beforeFirst("review2"),
      };
      expect(before).toEqual({ default: "delivered", plain: "delivered", review2: "delivered" });

      // 기준: 처음부터 시작 Drive 프로필로 만든 대화
      expect(await send(await createFrom("review"), "hello")).toBe("delivered");

      // 프로필 없이 만든 새 대화는 같은 폴더에서 마지막으로 쓴 프로필로 열린다(U5): 위 대화들이 review로 바뀌었으므로 처음부터 시작 Drive가 있다.
      // "기본 → 리뷰"를 반복해 시험하면 첫 번 뒤에는 칩이 이미 리뷰라서 전환이 아무 일도 아니다
      const recent = await createFrom(undefined);
      expect(await send(recent, "hello")).toBe("delivered");

      // 첫 메시지 뒤(턴이 끝난 뒤)의 전환은 시작 Drive를 시작하지 않는다
      const mark = collector.events.length;
      const afterDone = await createFrom("plain");
      expect(await send(afterDone, "one")).toBe("turn");
      await settled(mark);
      await connection.request("thread.setProfile", { threadId: afterDone, profileId: "review" });
      expect(await send(afterDone, "two")).toBe("turn");
      await settled(mark + 1);

      // 첫 메시지를 받은 직후 턴이 도는 중의 전환도 마찬가지다
      const duringTurn = await createFrom("plain");
      expect(await send(duringTurn, "one")).toBe("turn");
      await connection.request("thread.setProfile", { threadId: duringTurn, profileId: "review" });
      expect(
        collector.events.filter(
          (event) =>
            event.kind === "lease.acquired" && JSON.stringify(event.payload).includes(duringTurn),
        ),
      ).toEqual([]);
    } finally {
      await host.close();
      home.dispose();
    }
  },
  120_000,
);

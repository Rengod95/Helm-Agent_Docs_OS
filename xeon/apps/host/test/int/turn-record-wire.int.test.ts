import { join } from "node:path";
import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import {
  WireError,
  type HostConnection,
  type ServerNotificationParams,
} from "@fresnel/contracts/wire";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { openMeasureStore } from "../../src/assembly/measure/store.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// 턴 기록 읽기·표시·구독과 테스트 실행 비교(M5d, `turn-record-metrics.md` §3.5, §3.8, §4.8)를 실제 엔진에서 시험한다.
// 턴은 테이프 모델로 돌린다. 답마다 입력 토큰 수가 정해져 있어 기록의 값을 그 수와 비교한다.
// 읽기 값은 쓴 값과 맞아야 한다. 표시(`turnRecord.mark`)는 wire로 다시 읽을 길이 없어 측정 저장소에서 읽는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 테이프의 입력 토큰 수. 턴 순서대로 쓰인다 */
const INPUT_TOKENS = [1234, 1300, 1400] as const;

type Delta = ServerNotificationParams<"turnRecord.delta">;

/** 턴 기록 알림을 모은다. 기다림은 알림이 올 때 깨어나고, 시간을 폴링하지 않는다 */
function collectDeltas(connection: HostConnection) {
  const deltas: Delta[] = [];
  const waiters = new Set<{ match: (delta: Delta) => boolean; done: (delta: Delta) => void }>();
  connection.onNotification("turnRecord.delta", (params) => {
    deltas.push(params);
    for (const waiter of Array.from(waiters)) {
      if (waiter.match(params)) {
        waiters.delete(waiter);
        waiter.done(params);
      }
    }
  });
  return {
    deltas,
    waitFor(match: (delta: Delta) => boolean, timeoutMs = 10_000): Promise<Delta> {
      const existing = deltas.find(match);
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise<Delta>((resolve, reject) => {
        const waiter = {
          match,
          done(delta: Delta) {
            clearTimeout(timer);
            resolve(delta);
          },
        };
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`no matching turnRecord.delta within ${timeoutMs}ms`));
        }, timeoutMs);
        waiters.add(waiter);
      });
    },
  };
}

/** 대화에 입력을 차례로 보내 턴이 끝날 때까지 기다린다. 턴 id는 보낸 순서대로 돌려준다 */
async function runTurns(
  connection: HostConnection,
  collector: ReturnType<typeof collectEvents>,
  threadId: ThreadId,
  inputs: readonly string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const input of inputs) {
    // oxlint-disable-next-line no-await-in-loop -- 턴은 앞 턴이 끝난 뒤에 시작한다 (eng.testing.guide TS-05)
    const started = await startTurnWhenIdle(connection, { threadId, input });
    // oxlint-disable-next-line no-await-in-loop -- 턴은 앞 턴이 끝난 뒤에 시작한다 (eng.testing.guide TS-05)
    await collector.waitFor(
      (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
      20_000,
    );
    ids.push(started.turnId);
  }
  return ids;
}

/** wire 오류를 꺼낸다. 다른 오류면 그대로 던진다 */
async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

realTest(
  "turnRecord.list pages the turns newest first and its scope and flag filters keep the turns they should",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const models = recordingModels(
      "turn-record-list",
      INPUT_TOKENS.map((inputTokens) => ({ text: "답", inputTokens })),
      { contextWindow: 100_000 },
    );
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: models.buildModels,
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      const [first, second, third] = await runTurns(connection, collector, created.threadId, [
        "one",
        "two",
        "three",
      ]);
      if (first === undefined || second === undefined || third === undefined) {
        throw new Bug("three turns must have run");
      }

      // 최신 순. 턴마다 요약 한 줄의 값이 같다
      const all = await connection.request("turnRecord.list", { threadId: created.threadId });
      expect(all.enabled).toBe(true);
      expect(all.level).toBe("full");
      expect(all.next).toBeNull();
      expect(
        all.items.map((item) => [
          item.turnId,
          item.status,
          item.scope,
          item.complete,
          item.profileId,
          item.stepCount,
          item.callCount,
          item.childCount,
          item.frameDepthMax,
        ]),
      ).toEqual([
        [third, "completed", "live", true, "default", 1, 0, 0, 0],
        [second, "completed", "live", true, "default", 1, 0, 0, 0],
        [first, "completed", "live", true, "default", 1, 0, 0, 0],
      ]);

      // 쪽 나눔: 두 개씩 두 쪽이고, 다음 쪽의 커서가 남은 한 턴을 준다
      const page1 = await connection.request("turnRecord.list", {
        threadId: created.threadId,
        limit: 2,
      });
      expect(page1.items.map((item) => item.turnId)).toEqual([third, second]);
      expect(typeof page1.next).toBe("string");
      const page2 = await connection.request("turnRecord.list", {
        threadId: created.threadId,
        limit: 2,
        ...(page1.next === null ? {} : { cursor: page1.next }),
      });
      expect(page2.items.map((item) => item.turnId)).toEqual([first]);
      expect(page2.next).toBeNull();

      // 범위와 플래그 거르기. 세 턴의 범위는 `live`이고, 질문과 승인 플래그는 서지 않았다
      expect(
        (
          await connection.request("turnRecord.list", {
            threadId: created.threadId,
            scope: ["live"],
          })
        ).items.map((item) => item.turnId),
      ).toEqual([third, second, first]);
      expect(
        (
          await connection.request("turnRecord.list", {
            threadId: created.threadId,
            scope: ["test"],
          })
        ).items,
      ).toEqual([]);
      expect(
        (
          await connection.request("turnRecord.list", {
            threadId: created.threadId,
            flags: ["asked"],
          })
        ).items,
      ).toEqual([]);
      // 입력 이전 훅(cap-dialog, cap-knowledge)이 메시지를 고쳐서 셋 모두 `modified` 플래그가 선다
      expect(
        (
          await connection.request("turnRecord.list", {
            threadId: created.threadId,
            flags: ["modified"],
          })
        ).items.map((item) => item.turnId),
      ).toEqual([third, second, first]);
    } finally {
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "turnRecord.get returns each turn's record with the tape's token usage, and an unknown turn is turnRecord.turnNotFound",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const models = recordingModels(
      "turn-record-get",
      INPUT_TOKENS.map((inputTokens) => ({ text: "답", inputTokens })),
      { contextWindow: 100_000 },
    );
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: models.buildModels,
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      const turnIds = await runTurns(connection, collector, created.threadId, [
        "one",
        "two",
        "three",
      ]);
      for (const [index, turnId] of turnIds.entries()) {
        // 턴마다 기록을 하나씩 읽는다(순서가 턴 순서와 맞아야 한다)
        // oxlint-disable-next-line no-await-in-loop -- 턴 기록은 턴 순서대로 하나씩 읽는다 (eng.testing.guide TS-05)
        const read = await connection.request("turnRecord.get", {
          threadId: created.threadId,
          turnId,
        });
        expect(read.enabled).toBe(true);
        expect(read.level).toBe("full");
        expect(read.absent).toBeNull();
        const record = read.record;
        if (record === null) throw new Bug("a finished turn must have a record");
        expect({
          threadId: record.threadId,
          turnId: record.turnId,
          origin: record.origin,
          status: record.status,
          scope: record.scope,
          complete: record.complete,
          profile: record.profile,
          testRun: record.testRun,
          children: record.children,
          frames: record.frames,
        }).toEqual({
          threadId: created.threadId,
          turnId,
          origin: "user",
          status: "completed",
          scope: "live",
          complete: true,
          profile: { id: "default", rev: 0, source: "builtin", inherited: false },
          testRun: null,
          children: [],
          frames: [],
        });
        // 단계 하나, 모델 호출 하나. 호출의 입력 토큰은 이 턴에 답한 테이프 값이다
        expect(record.steps.map((step) => step.stepIndex)).toEqual([0]);
        const calls = record.steps[0]?.modelCalls ?? [];
        expect(calls.map((call) => [call.provider, call.modelId, call.stopReason])).toEqual([
          ["tape", "tape-1", "stop"],
        ]);
        expect(calls[0]?.usage.input).toBe(INPUT_TOKENS[index]);
      }

      // 없는 턴은 기록이 아니라 turnRecord.turnNotFound(3501)다
      const missing = await wireErrorOf(
        connection.request("turnRecord.get", {
          threadId: created.threadId,
          turnId: "trn_never_ran",
        }),
      );
      expect([missing.code, missing.data.kind]).toEqual([3501, "turnRecord.turnNotFound"]);
    } finally {
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

/** 알림 묶음의 행에서 훅 행만 꺼낸다 */
function hooksOf(rows: readonly { readonly kind: string }[] | undefined): readonly object[] {
  return (rows ?? []).flatMap((row) =>
    row.kind === "hook" && "hook" in row && typeof row.hook === "object" && row.hook !== null
      ? [row.hook]
      : [],
  );
}

realTest(
  "turnRecord.watch sends each watched turn's step and final deltas, and after unwatch the turn's deltas stop while the other sub keeps hearing it",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const models = recordingModels(
      "turn-record-watch",
      INPUT_TOKENS.map((inputTokens) => ({ text: "답", inputTokens })),
      { contextWindow: 100_000 },
    );
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: models.buildModels,
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    const deltas = collectDeltas(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      const watchA = await connection.request("turnRecord.watch", { threadId: created.threadId });
      const watchB = await connection.request("turnRecord.watch", { threadId: created.threadId });
      expect(watchA.level).toBe("full");
      expect(watchB.level).toBe("full");
      expect(watchA.sub).not.toBe(watchB.sub);

      // 턴 하나마다 알림 셋: 훅이 끝난 직후의 알림(단계 번호 1, `final` 거짓), 단계 0의 묶음(`final` 거짓), 턴 행을 실은 마지막 묶음(`final` 참).
      // 단계 끝 뒤에 끝난 훅은 마지막 묶음에서 `late` 표지를 달고 한 번 더 간다
      const [first, second] = await runTurns(connection, collector, created.threadId, [
        "one",
        "two",
      ]);
      if (first === undefined || second === undefined) throw new Bug("two turns must have run");
      // 두 구독 모두 끝 알림까지 받았음을 확인하고 나서 알림의 모양을 비교한다
      await deltas.waitFor(
        (delta) => delta.sub === watchB.sub && delta.turnId === second && delta.final,
      );
      const shapeOf = (sub: string, turnId: string) =>
        deltas.deltas
          .filter((delta) => delta.sub === sub && delta.turnId === turnId)
          .map((delta) => [
            delta.threadId,
            delta.stepIndex,
            delta.final,
            delta.rows[0]?.kind,
            delta.rows.at(-1)?.kind,
          ]);
      const expectedShape = [
        [created.threadId, 1, false, "hook", "hook"],
        [created.threadId, 0, false, "step", "hook"],
        [created.threadId, null, true, "hook", "turn"],
      ];
      expect(shapeOf(watchA.sub, first)).toEqual(expectedShape);
      expect(shapeOf(watchB.sub, first)).toEqual(expectedShape);
      expect(shapeOf(watchA.sub, second)).toEqual(expectedShape);
      expect(shapeOf(watchB.sub, second)).toEqual(expectedShape);
      // 끝 알림의 마지막 행은 턴 행이고 상태와 완결 여부를 싣는다
      const finalA = deltas.deltas.find(
        (delta) => delta.sub === watchA.sub && delta.turnId === first && delta.final,
      );
      expect(finalA?.rows.at(-1)).toEqual({ kind: "turn", status: "completed", complete: true });
      // 먼저 간 훅 행과 마지막 묶음의 늦은 행은 같은 훅이고(같은 이름과 등록 id), 뒤의 것에만 `late`가 붙는다
      const liveA = deltas.deltas.find(
        (delta) =>
          delta.sub === watchA.sub &&
          delta.turnId === first &&
          !delta.final &&
          delta.stepIndex === 1,
      );
      const liveHooks = hooksOf(liveA?.rows);
      const lateHooks = hooksOf(finalA?.rows);
      expect(liveHooks.length).toBeGreaterThan(0);
      expect(
        liveHooks.map((hook) => [
          "hook" in hook ? hook.hook : null,
          "registrationId" in hook ? hook.registrationId : null,
          "late" in hook ? hook.late : undefined,
        ]),
      ).toEqual(
        lateHooks.map((hook) => [
          "hook" in hook ? hook.hook : null,
          "registrationId" in hook ? hook.registrationId : null,
          undefined,
        ]),
      );
      expect(lateHooks.every((hook) => "late" in hook && hook.late === true)).toBe(true);

      // A를 끊으면 A의 알림은 더 오지 않고, B는 다음 턴도 계속 받는다
      expect(await connection.request("turnRecord.unwatch", { sub: watchA.sub })).toEqual({});
      const [third] = await runTurns(connection, collector, created.threadId, ["three"]);
      if (third === undefined) throw new Bug("the third turn must have run");
      // 기록 사건 하나는 살아 있는 구독 모두에 알림을 보낸다. B의 끝 알림을 기다리면 같은 사건의 A 몫도 이미 지나갔다
      await deltas.waitFor(
        (delta) => delta.sub === watchB.sub && delta.turnId === third && delta.final,
      );
      expect(shapeOf(watchB.sub, third)).toEqual(expectedShape);
      expect(shapeOf(watchA.sub, third)).toEqual([]);
      // A의 알림 턴 순서는 끊기 전 두 턴뿐이다(턴마다 두 개)
      expect(
        deltas.deltas.filter((delta) => delta.sub === watchA.sub).map((d) => d.turnId),
      ).toEqual([first, first, first, second, second, second]);
    } finally {
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "turnRecord.search finds each turn's hook runs by plugin and outcome, and pages by cursor",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const models = recordingModels(
      "turn-record-search",
      INPUT_TOKENS.map((inputTokens) => ({ text: "답", inputTokens })),
      { contextWindow: 100_000 },
    );
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: models.buildModels,
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      const [first, second, third] = await runTurns(connection, collector, created.threadId, [
        "one",
        "two",
        "three",
      ]);
      if (first === undefined || second === undefined || third === undefined) {
        throw new Bug("three turns must have run");
      }

      // cap-dialog는 턴마다 입력 이전 훅에서 고친다(outcome modified). 최신 턴이 앞에 온다
      const modified = await connection.request("turnRecord.search", {
        plugin: "cap-dialog",
        hook: "input.agent.before",
        outcome: "modified",
        period: { days: 1 },
      });
      expect(modified.next).toBeNull();
      expect(
        modified.items.map((item) => [item.threadId, item.turnId, item.plugin, item.outcome]),
      ).toEqual([
        [created.threadId, third, "cap-dialog", "modified"],
        [created.threadId, second, "cap-dialog", "modified"],
        [created.threadId, first, "cap-dialog", "modified"],
      ]);
      expect(modified.items.every((item) => typeof item.hookSeq === "number")).toBe(true);
      // hookSeq는 턴 안에서 세는 순번이다(대화 전체 카운터가 아니다): 첫 턴은 대화 시작 훅 넷과 입력 훅 둘이 앞서 6이고, 뒤 턴은 2다
      expect(modified.items.map((item) => item.hookSeq)).toEqual([2, 2, 6]);

      // cap-web은 턴마다 한 번 통과한다. 두 쪽으로 나눠 받으면 같은 턴이 중복 없이 모인다
      const pass1 = await connection.request("turnRecord.search", {
        plugin: "cap-web",
        period: { days: 1 },
        limit: 2,
      });
      expect(pass1.items.map((item) => [item.turnId, item.outcome])).toEqual([
        [third, "pass"],
        [second, "pass"],
      ]);
      expect(typeof pass1.next).toBe("string");
      const pass2 = await connection.request("turnRecord.search", {
        plugin: "cap-web",
        period: { days: 1 },
        limit: 2,
        ...(pass1.next === null ? {} : { cursor: pass1.next }),
      });
      expect(pass2.items.map((item) => [item.turnId, item.outcome])).toEqual([[first, "pass"]]);
      expect(pass2.next).toBeNull();

      // 맞는 결과가 없는 거르기는 빈 목록이다: cap-web에는 `asked` 결과가 없고, 없는 플러그인 이름도 빈 목록이다
      expect(
        (
          await connection.request("turnRecord.search", {
            plugin: "cap-web",
            outcome: "asked",
            period: { days: 1 },
          })
        ).items,
      ).toEqual([]);
      expect(
        (
          await connection.request("turnRecord.search", {
            plugin: "no-such-plugin",
            period: { days: 1 },
          })
        ).items,
      ).toEqual([]);
    } finally {
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "turnRecord.mark writes the mark to the measure store, a second mark replaces the first, and unknown turns and threads are refused",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const models = recordingModels(
      "turn-record-mark",
      INPUT_TOKENS.map((inputTokens) => ({ text: "답", inputTokens })),
      { contextWindow: 100_000 },
    );
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: models.buildModels,
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    try {
      let threadId = "";
      let turnIds: string[] = [];
      try {
        await connection.request("host.hello", HELLO_PARAMS);
        await connection.request("events.subscribe", { from: "head" });
        const created = await connection.request("thread.create", {});
        threadId = created.threadId;
        turnIds = await runTurns(connection, collector, created.threadId, ["one", "two", "three"]);
        const [first, second] = turnIds;
        if (first === undefined || second === undefined) {
          throw new Bug("three turns must have run");
        }
        expect(
          await connection.request("turnRecord.mark", {
            threadId,
            turnId: first,
            plugin: "cap-dialog",
            mark: "followed",
          }),
        ).toEqual({});
        // 같은 턴과 플러그인에 다시 표시하면 앞의 표시를 바꾼다
        expect(
          await connection.request("turnRecord.mark", {
            threadId,
            turnId: first,
            plugin: "cap-dialog",
            mark: "not_followed",
          }),
        ).toEqual({});
        expect(
          await connection.request("turnRecord.mark", {
            threadId,
            turnId: second,
            plugin: "cap-web",
            mark: "followed",
          }),
        ).toEqual({});
        const missingTurn = await wireErrorOf(
          connection.request("turnRecord.mark", {
            threadId,
            turnId: "trn_never_ran",
            plugin: "cap-web",
            mark: "followed",
          }),
        );
        expect([missingTurn.code, missingTurn.data.kind]).toEqual([
          3501,
          "turnRecord.turnNotFound",
        ]);
        const missingThread = await wireErrorOf(
          connection.request("turnRecord.mark", {
            threadId: "thr_never_made",
            turnId: first,
            plugin: "cap-web",
            mark: "followed",
          }),
        );
        expect([missingThread.code, missingThread.data.kind]).toEqual([3001, "thread.notFound"]);
      } finally {
        await host.close();
      }

      // wire 응답에는 표시가 없어(턴 기록 모양에 `marks`가 없다) 측정 저장소의 `tr_mark`를 다시 읽어 확인한다
      const opened = openMeasureStore(join(home.dataDir, "measure.db"));
      if (!opened.ok) throw new Bug("the measure database must exist after the turns");
      const [first, second, third] = turnIds;
      if (first === undefined || second === undefined || third === undefined) {
        throw new Bug("three turns must have run");
      }
      const marksOf = (turnId: string) => {
        const rows = opened.value.getMarks(threadId, turnId);
        if (!rows.ok) throw new Bug("the measure database must be readable");
        return rows.value.map((row) => [row.ref, row.mark, row.plugin]);
      };
      expect(marksOf(first)).toEqual([["cap-dialog", "not_followed", "cap-dialog"]]);
      expect(marksOf(second)).toEqual([["cap-web", "followed", "cap-web"]]);
      expect(marksOf(third)).toEqual([]);
      opened.value.close();
    } finally {
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "testRun.compare puts two runs of one base profile side by side with their turn and call counts, and a live thread is testRun.notATestRun",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const models = recordingModels(
      "turn-record-compare",
      [
        { text: "답", inputTokens: 1000 },
        { text: "답", inputTokens: 1000 },
        { text: "답", inputTokens: 1000 },
      ],
      { contextWindow: 100_000 },
    );
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: models.buildModels,
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      await connection.request("profile.put", {
        profile: {
          id: "work",
          title: "Work",
          plugins: [{ name: "cap-workspace" }],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      const runA = await connection.request("testRun.start", {
        baseProfileId: "work",
        drafts: [],
        runGroupId: "grp-a",
      });
      const runB = await connection.request("testRun.start", {
        baseProfileId: "work",
        drafts: [],
        runGroupId: "grp-b",
      });
      const runC = await connection.request("testRun.start", {
        baseProfileId: "work",
        drafts: [],
        runGroupId: "grp-c",
      });
      const [turnA] = await runTurns(connection, collector, runA.threadId, ["같은 질문"]);
      const [turnB] = await runTurns(connection, collector, runB.threadId, ["같은 질문"]);
      await runTurns(connection, collector, runC.threadId, ["다른 질문"]);
      if (turnA === undefined || turnB === undefined) throw new Bug("each run must have a turn");

      // 테스트 실행 턴은 `test` 범위로 남는다(구성은 기준 프로필과 묶음 id, 초안 없음이다)
      const recordA = await connection.request("turnRecord.get", {
        threadId: runA.threadId,
        turnId: turnA,
      });
      expect(recordA.record?.scope).toBe("test");
      expect(recordA.record?.testRun).toEqual({
        runGroupId: "grp-a",
        baseProfileId: "work",
        drafts: [],
      });

      // 첫 사용자 입력의 HMAC이 `tr_thread.input_hash`에 남고, 입력 원문은 남지 않는다
      const opened = openMeasureStore(join(home.dataDir, "measure.db"));
      if (!opened.ok) throw new Bug("the measure database must exist after the turns");
      const hashOf = (threadId: ThreadId): string | null => {
        const row = opened.value.getThread(threadId);
        if (!row.ok) throw new Bug("the measure database must be readable");
        return row.value?.inputHash ?? null;
      };
      const hashA = hashOf(runA.threadId);
      expect(hashA).toMatch(/^[0-9a-f]{16}$/);
      expect(hashOf(runB.threadId)).toBe(hashA);
      expect(hashOf(runC.threadId)).toMatch(/^[0-9a-f]{16}$/);
      expect(hashOf(runC.threadId)).not.toBe(hashA);
      opened.value.close();

      // 같은 입력의 두 실행은 `sameInput`이 참이고, 입력이 다른 실행이 끼면 거짓이다
      const different = await connection.request("testRun.compare", {
        threadIds: [runA.threadId, runC.threadId],
      });
      expect(different.sameInput).toBe(false);
      const compared = await connection.request("testRun.compare", {
        threadIds: [runA.threadId, runB.threadId],
      });
      expect(compared.sameInput).toBe(true);
      expect(compared.columns).toEqual([
        { threadId: runA.threadId, label: "#1", versionIds: [] },
        { threadId: runB.threadId, label: "#2", versionIds: [] },
      ]);
      const rowOf = (name: string) => compared.rows.find((row) => row.row === name);
      expect(Object.keys(rowOf("turns")?.values ?? {}).toSorted()).toEqual(
        [runA.threadId, runB.threadId].toSorted(),
      );
      expect(rowOf("turns")).toEqual({
        row: "turns",
        values: {
          [runA.threadId]: { value: 1, state: "exact" },
          [runB.threadId]: { value: 1, state: "exact" },
        },
        observation: true,
      });
      expect(rowOf("calls")?.values[runA.threadId]).toEqual({ value: 0, state: "exact" });
      expect(rowOf("blocked_calls")?.values[runB.threadId]).toEqual({ value: 0, state: "exact" });
      expect(compared.rows.map((row) => row.row)).toContain("hook.outcomes.pass");

      // 대화 하나가 테스트 실행이 아니면 testRun.notATestRun(3312)이다
      const live = await connection.request("thread.create", {});
      const notTest = await wireErrorOf(
        connection.request("testRun.compare", {
          threadIds: [runA.threadId, live.threadId],
        }),
      );
      expect([notTest.code, notTest.data.kind]).toEqual([3312, "testRun.notATestRun"]);
    } finally {
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "turnRecord.get fills record.testRun for a test run made by thread.create too: the profile the turn ran under is the base and there are no drafts",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const models = recordingModels(
      "turn-record-plain-test-run",
      [{ text: "답", inputTokens: 1000 }],
      { contextWindow: 100_000 },
    );
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: models.buildModels,
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", { testRun: true });
      const [turnId] = await runTurns(connection, collector, created.threadId, ["질문"]);
      if (turnId === undefined) throw new Bug("the run must have a turn");
      const read = await connection.request("turnRecord.get", {
        threadId: created.threadId,
        turnId,
      });
      expect(read.record?.scope).toBe("test");
      expect(read.record?.testRun).toEqual({
        runGroupId: null,
        baseProfileId: "default",
        drafts: [],
      });
    } finally {
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

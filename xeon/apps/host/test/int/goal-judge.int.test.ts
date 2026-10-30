import { expect, test } from "bun:test";
import { WorkGoalsKey, type Notice } from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import type { ServerNotificationParams } from "@xeon/contracts/wire";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import { createHostConnection } from "../../src/client.ts";
import { hostLimitsOf } from "../../src/assembly/settings-sources.ts";
import { settingReaderOf, startHost, stopHost } from "../../src/host-runtime.ts";
import { createInProcessTransportFactory } from "../../src/transport/in-process.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, until } from "../fixtures/wire-client.ts";

// X6 (int, M3-REQ-90, M3-REQ-16): 실제 엔진에서 목표 판정이 `l1.agents.judge.maxRuns`에 이르면 turn이 끝나고, 알림은 연결된 클라이언트 두 개에 한 번씩만 간다.
// 목표 설정의 UI 경로는 아직 없어서 시험용 확장이 `work.goals`의 `set`으로 건다. 주 모델과 판정 모델은 테이프가 답하고, 판정 모델은 역할 `judge`로 돈다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 세션 범위 `l1.agents.judge.maxRuns`. 세 번 모두 미달이면 목표가 limit_reached로 끝난다 */
const MAX_RUNS = 3;
/** 파일 범위 값. 세션 값을 읽지 못하는 agentsSource는 이 값에서 세 번째 판정을 capped로 막아 판정이 두 번에 그친다 */
const FILE_MAX_RUNS = 2;
const GOAL_CONDITION = "The report section is written and checked against the sources.";
/** thread 이름을 이 값으로 바꾸면 시험용 확장이 목표를 건다(`session.info.after`) */
const SET_GOAL_ON_RENAME = "목표를 건다";
/** 알림 묶음 창(1초, cap-dialog NOTICE_COALESCE_MS)을 넘겨 기다린다. 묶이지 않은 두 번째 알림이 있으면 이 사이에 온다 */
const COALESCE_WINDOW_PASS_MS = 1500;

const MAIN_MODEL = "tape-1";
const JUDGE_MODEL = "tape-judge";

/** 목표 설정 확장 본체. thread 이름이 정해진 값이 되면 `work.goals.set`을 부른다 */
const goalExtension: ExtensionEntry = ({ manifest: loaded, scope }) => {
  scope(loaded.name, {}, (g) => {
    g.on("session.info.after", async ({ threadId, name }) => {
      if (name !== SET_GOAL_ON_RENAME) return;
      await g
        .capability(WorkGoalsKey)
        .set({ condition: GOAL_CONDITION }, { requestId: `goal-probe:${threadId}` });
    });
  });
};

/** 목표 설정 확장의 모듈. 확장이 쓰는 능력(`work.goals`)을 `requires`에 적는다 */
function goalProbe(): HostPluginModule {
  const manifest = defineManifest({
    schemaVersion: 1,
    name: "goal-probe",
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./index.ts",
    points: ["session.info.after"],
    requires: [{ id: "work.goals", range: "^1.0.0" }],
    usesDrive: false,
    trust: { level: "builtin" },
  });
  return { manifest, extension: goalExtension };
}

// 주 역할 답 두 개(판정 한 번마다 모델이 한 번 더 답한다)와 판정 답 두 개(모두 미달)
const player = tapePlayer(
  tape("goal-judge/limit-reached", [
    {
      role: "main",
      label: "first answer",
      response: {
        type: "message",
        content: [t.text("The first draft is done.")],
        stopReason: "stop",
      },
    },
    {
      role: "main",
      label: "second answer",
      response: {
        type: "message",
        content: [t.text("The second draft is done.")],
        stopReason: "stop",
      },
    },
    {
      role: "main",
      label: "third answer",
      response: {
        type: "message",
        content: [t.text("The third draft is done.")],
        stopReason: "stop",
      },
    },
    {
      role: "judge",
      label: "judge 1: not met",
      response: {
        type: "message",
        content: [
          t.toolCall(
            "final_answer",
            {
              verdict: "not_met",
              rationale: "The report section is still missing.",
              missing: ["the report section"],
            },
            "judge_call_1",
          ),
        ],
        stopReason: "toolUse",
      },
    },
    {
      role: "judge",
      label: "judge 2: not met",
      response: {
        type: "message",
        content: [
          t.toolCall(
            "final_answer",
            {
              verdict: "not_met",
              rationale: "The report section is still missing.",
              missing: ["the report section"],
            },
            "judge_call_2",
          ),
        ],
        stopReason: "toolUse",
      },
    },
    {
      role: "judge",
      label: "judge 3: not met",
      response: {
        type: "message",
        content: [
          t.toolCall(
            "final_answer",
            {
              verdict: "not_met",
              rationale: "The report section is still missing.",
              missing: ["the report section"],
            },
            "judge_call_3",
          ),
        ],
        stopReason: "toolUse",
      },
    },
  ]),
  { clock: realTapeClock() },
);
// 판정 역할은 역할 라우팅(`l1.models.routing.judge`)이 고른 모델로 가고, 테이프는 모델 id로 역할을 정한다
const handle = tapeProvider(player, {
  models: [{ id: MAIN_MODEL }, { id: JUDGE_MODEL }],
  roleOf: (model) => (model.id === JUDGE_MODEL ? "judge" : "main"),
});

realTest(
  "a goal the judge never meets ends the turn at the judge limit, settles limit_reached and notifies each client once",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, {
      ...TAPE_SETTINGS,
      "l1.agents.judge.maxRuns": FILE_MAX_RUNS,
      "l1.models.routing.judge": `tape/${JUDGE_MODEL}`,
    });
    const running = await startHost({
      mode: "in-process",
      devChecks: true,
      defaultGroups: false,
      osNotifier: null,
      buildModels: tapeBuildModels(handle),
      extraPlugins: [goalProbe()],
    });
    const attach = () => {
      const pair = createInProcessTransportFactory({ devChecks: true })();
      running.hub.serve(pair.server, {
        limits: hostLimitsOf(settingReaderOf(running.engine)),
        devChecks: true,
      });
      return createHostConnection(pair.client);
    };
    const first = attach();
    const second = attach();
    await first.request("host.hello", HELLO_PARAMS);
    await second.request("host.hello", HELLO_PARAMS);
    const seenFirst: ServerNotificationParams<"notify.delivered">[] = [];
    const seenSecond: ServerNotificationParams<"notify.delivered">[] = [];
    first.onNotification("notify.delivered", (params) => {
      seenFirst.push(params);
    });
    second.onNotification("notify.delivered", (params) => {
      seenSecond.push(params);
    });
    const collector = collectEvents(first);
    await first.request("events.subscribe", { from: "head" });

    const created = await first.request("thread.create", {});
    await first.request("settings.set", {
      key: "l1.agents.judge.maxRuns",
      value: MAX_RUNS,
      scope: "session",
      threadId: created.threadId,
    });
    await first.request("thread.rename", {
      threadId: created.threadId,
      title: SET_GOAL_ON_RENAME,
    });
    await collector.waitFor((event) => event.kind === "work.goal_set");
    await first.request("turn.start", { threadId: created.threadId, input: "hi" });
    await collector.waitFor((event) => event.kind === "turn.completed");
    expect(await until(() => seenFirst.length >= 1 && seenSecond.length >= 1, 5000)).toBe(true);
    // 묶음 창을 넘겨도 두 번째 알림이 오지 않아야 한다
    await Bun.sleep(COALESCE_WINDOW_PASS_MS);

    // 목표 흐름: 설정, 판정 세 번(실행 번호 1, 2, 3), 한도 종결 한 번, 턴 완료 한 번
    const kinds = collector.events
      .map((event) => event.kind)
      .filter((kind) =>
        ["work.goal_set", "work.goal_judged", "work.goal_settled", "turn.completed"].includes(kind),
      );
    expect(kinds).toEqual([
      "work.goal_set",
      "work.goal_judged",
      "work.goal_judged",
      "work.goal_judged",
      "work.goal_settled",
      "turn.completed",
    ]);
    const judged = collector.events.filter((event) => event.kind === "work.goal_judged");
    expect(judged.map((event) => event.payload)).toMatchObject([
      { goalId: "g1", n: 1, verdict: { met: false }, judgeKind: "model" },
      { goalId: "g1", n: 2, verdict: { met: false }, judgeKind: "model" },
      { goalId: "g1", n: 3, verdict: { met: false }, judgeKind: "model" },
    ]);
    const settled = collector.events.filter((event) => event.kind === "work.goal_settled");
    expect(settled.map((event) => event.payload)).toEqual([
      { goalId: "g1", status: "limit_reached", judgments: 3 },
    ]);
    const turnDone = collector.events.filter((event) => event.kind === "turn.completed");
    expect(turnDone.map((event) => event.payload)).toMatchObject([{ status: "completed" }]);

    // 모델 호출: 주 역할은 답할 때마다 한 번, 판정 역할은 판정마다 한 번. 테이프의 답을 모두 쓰고 어긋남이 없어야 한다
    expect(handle.calls().map((call) => `${call.role}:${call.modelId}`)).toEqual([
      "main:tape-1",
      "judge:tape-judge",
      "main:tape-1",
      "judge:tape-judge",
      "main:tape-1",
      "judge:tape-judge",
    ]);
    expect(handle.mismatches()).toEqual([]);
    expect(player.remaining()).toBe(0);

    // 알림: 목표 종결 알림 하나가 두 클라이언트에 한 번씩 간다. 뒤의 turn.completed 알림은 같은 묶음에 든다
    const [settledEvent] = settled;
    const [turnEvent] = turnDone;
    if (settledEvent === undefined || turnEvent === undefined) {
      throw new Error("the goal did not settle or the turn did not complete");
    }
    const goalNotice: Notice = {
      kind: "completed",
      title: "목표 판정 한도에 도달했다",
      body: "판정 3회",
      seq: settledEvent.seq,
      sourceType: "work.goal_settled",
    };
    expect(seenFirst.map((params) => params.notice)).toEqual([goalNotice]);
    expect(seenFirst.map((params) => params.threadId)).toEqual([created.threadId]);
    expect(seenSecond.map((params) => params.notice)).toEqual([goalNotice]);
    expect(seenSecond.map((params) => params.threadId)).toEqual([created.threadId]);

    // notify.list는 묶지 않아서 두 알림을 모두 돌려준다
    const listed = await second.request("notify.list", { afterSeq: 0 });
    const turnNotice: Notice = {
      kind: "completed",
      title: "작업이 끝났다",
      body: null,
      seq: turnEvent.seq,
      sourceType: "turn.completed",
    };
    expect(listed.notices).toEqual([goalNotice, turnNotice]);

    await first.close();
    await second.close();
    await stopHost(running);
    home.dispose();
  },
  30_000,
);

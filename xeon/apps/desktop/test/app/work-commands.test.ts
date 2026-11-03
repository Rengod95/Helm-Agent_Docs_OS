import { describe, expect, test } from "bun:test";
import type { GoalStatusResult, WorkTasksListResult } from "@fresnel/contracts/wire";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 목표와 작업 명령(`commands.work`)을 가짜 엔진 위에서 끝까지 돌린다. 읽기는 대화 id 하나로 가고, 목표 명령은 `command.run`에
// `/goal` 줄을 그대로 싣는다(확인 값 없음). 값은 `toEqual`로 비교한다.

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.find((entry) => entry.method === method)?.params;

describe("goal.status and work.tasks.list read by thread", () => {
  test("the goal comes back as the host sent it, and the thread id is the only param", async () => {
    const goal: NonNullable<GoalStatusResult["goal"]> = {
      condition: "시험이 모두 통과한다",
      status: "active",
      judged: 2,
      maxJudgments: 3,
      lastVerdict: { met: false, reason: "e2e 2개 실패" },
    };
    const { app, params } = await liveApp({ results: { "goal.status": { goal } } });
    const read = await app.commands.work.goal(thr(1));
    expect(paramsOf(params, "goal.status")).toEqual({ threadId: thr(1) });
    expect(read).toEqual({ ok: true, value: { goal } });
    await app.stop();
  });

  test("a conversation with no goal reads as a null goal", async () => {
    const { app } = await liveApp({ results: { "goal.status": { goal: null } } });
    expect(await app.commands.work.goal(thr(1))).toEqual({ ok: true, value: { goal: null } });
    await app.stop();
  });

  test("the task list comes back as the host sent it", async () => {
    const tasks: WorkTasksListResult["tasks"] = [
      { taskId: "t1", content: "단위 통일", status: "done", blockedBy: null },
      { taskId: "t2", content: "문서 고치기", status: "pending", blockedBy: "빌드 실패" },
    ];
    const { app, params } = await liveApp({ results: { "work.tasks.list": { tasks } } });
    const read = await app.commands.work.tasks(thr(1));
    expect(paramsOf(params, "work.tasks.list")).toEqual({ threadId: thr(1) });
    expect(read).toEqual({ ok: true, value: { tasks } });
    await app.stop();
  });

  test("a host without the goal method gives unsupported, not a value", async () => {
    const { app } = await liveApp({
      errors: { "goal.status": { code: -32601, kind: "jsonrpc.methodNotFound" } },
    });
    expect(await app.commands.work.goal(thr(1))).toEqual({
      ok: false,
      error: { kind: "unsupported" },
    });
    await app.stop();
  });
});

describe("goalCommand sends the /goal line through command.run", () => {
  test("setting a goal sends the whole line as text with no confirmShell", async () => {
    const { app, params } = await liveApp({
      results: {
        "command.run": { status: "done", name: "goal", message: "목표를 걸었어요", result: {} },
      },
    });
    const ran = await app.commands.work.goalCommand(thr(1), "/goal 시험이 모두 통과한다");
    expect(paramsOf(params, "command.run")).toEqual({
      threadId: thr(1),
      text: "/goal 시험이 모두 통과한다",
    });
    expect(ran).toEqual({
      ok: true,
      value: { status: "done", name: "goal", message: "목표를 걸었어요", result: {} },
    });
    await app.stop();
  });

  test("clearing a goal sends the fixed clear line", async () => {
    const { app, params } = await liveApp({
      results: {
        "command.run": { status: "done", name: "goal", message: null, result: null },
      },
    });
    await app.commands.work.goalCommand(thr(1), "/goal clear");
    expect(paramsOf(params, "command.run")).toEqual({ threadId: thr(1), text: "/goal clear" });
    await app.stop();
  });
});

import { describe, expect, test } from "bun:test";
import type { App } from "../../src/app/bootstrap.ts";
import { approvalRequest, evt, thr } from "../state/helpers.ts";
import { engineFake, makeAppOver, until, type EngineExtra } from "./support.ts";

// 응답이 "이미 해결됨"(closed)이면 카드를 잠깐 보인 뒤 대기열에서 빼고, host가 모르는 승인(gone)은 지우기 명령이 뺀다.
// 예약기는 직접 넘긴다. 실제 시간을 기다리지 않고 2.5초 예약을 부른다.

/** 시간을 직접 넘기는 예약기. `fire(ms)`는 그 지연으로 건 예약을 모두 부르고 뺀다 */
function manualScheduler() {
  const timers: { readonly ms: number; readonly run: () => void }[] = [];
  return {
    setTimeout(run: () => void, ms: number): number {
      timers.push({ ms, run });
      return timers.length;
    },
    clearTimeout(): void {},
    /** 아직 부르지 않은 예약의 지연 목록 */
    delays: (): number[] => timers.map((timer) => timer.ms),
    fire(ms: number): void {
      const due = timers.filter((timer) => timer.ms === ms);
      const rest = timers.filter((timer) => timer.ms !== ms);
      timers.splice(0, timers.length, ...rest);
      for (const timer of due) timer.run();
    },
  };
}

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([], undefined, extra);
  const timers = manualScheduler();
  const app = makeAppOver(engine.fake.ipc, { scheduler: timers });
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, timers, methods: engine.methods };
}

/** approval.list 결과가 들어온 것과 같이 승인 하나를 거울에 넣는다. 이미 해결된 승인도 목록에 다시 들어올 수 있다 */
function listApproval(app: App): void {
  app.engine.ingest({
    type: "approvals",
    approvals: [{ approvalId: evt(7), seq: 4, request: approvalRequest(thr(1)) }],
  });
  app.engine.flush();
}

/** 승인 하나를 대기열에 넣고, 들어갔는지 확인한다 */
function queueOne(app: App): void {
  listApproval(app);
  expect(app.engine.read.getState().approvals.ids).toEqual([evt(7)]);
}

describe("an already-resolved answer takes the approval out after the card has shown it", () => {
  test("the closed mark stays for the linger time, then the approval leaves the queue", async () => {
    const { app, timers } = await liveApp({
      results: { "approval.respond": { applied: false, reason: "already_resolved" } },
    });
    queueOne(app);
    await app.commands.respondApproval(evt(7), { decision: "deny" });
    expect(app.ui.read.getState().approvalSends).toEqual({ [evt(7)]: "closed" });
    expect(timers.delays()).toContain(2_500);

    // 표시를 보이는 동안에는 대기열에 남는다
    app.engine.flush();
    expect(app.engine.read.getState().approvals.ids).toEqual([evt(7)]);

    timers.fire(2_500);
    app.engine.flush();
    expect(app.engine.read.getState().approvals.ids).toEqual([]);
    expect(app.engine.read.getState().approvals.byId).toEqual({});
    expect(app.ui.read.getState().approvalSends).toEqual({});
    await app.stop();
  });

  test("a card whose answer is being sent again is not taken out by the earlier linger", async () => {
    let answers = 0;
    const { app, timers } = await liveApp({
      resultFor: (method) => {
        if (method !== "approval.respond") return undefined;
        answers += 1;
        // 첫 답은 이미 해결됨, 둘째 답은 적용됨(승인 응답이 대기열 빠짐을 기다리는 "보내는 중")
        return answers === 1 ? { applied: false, reason: "already_resolved" } : { applied: true };
      },
    });
    queueOne(app);
    await app.commands.respondApproval(evt(7), { decision: "deny" });
    await app.commands.respondApproval(evt(7), { decision: "deny" });
    expect(app.ui.read.getState().approvalSends).toEqual({ [evt(7)]: "sending" });

    timers.fire(2_500);
    app.engine.flush();
    expect(app.engine.read.getState().approvals.ids).toEqual([evt(7)]);
    await app.stop();
  });
});

describe("a gone approval stays until the user removes it", () => {
  test("unknown_approval marks the card gone, sets no timer, and dismissApproval removes it locally", async () => {
    const { app, timers, methods } = await liveApp({
      results: { "approval.respond": { applied: false, reason: "unknown_approval" } },
    });
    queueOne(app);
    await app.commands.respondApproval(evt(7), { decision: "deny" });
    expect(app.ui.read.getState().approvalSends).toEqual({ [evt(7)]: "gone" });
    expect(timers.delays()).not.toContain(2_500);

    app.engine.flush();
    expect(app.engine.read.getState().approvals.ids).toEqual([evt(7)]);

    app.commands.dismissApproval(evt(7));
    app.engine.flush();
    expect(app.engine.read.getState().approvals.ids).toEqual([]);
    expect(app.engine.read.getState().approvals.byId).toEqual({});
    expect(app.ui.read.getState().approvalSends).toEqual({});
    // 지우기는 host에 아무것도 보내지 않는다. approval.respond는 처음 한 번뿐이다
    expect(methods.filter((method) => method === "approval.respond")).toHaveLength(1);
    await app.stop();
  });

  test("a dismissed approval does not come back from a later approvals input", async () => {
    const { app } = await liveApp({
      results: { "approval.respond": { applied: false, reason: "unknown_approval" } },
    });
    queueOne(app);
    await app.commands.respondApproval(evt(7), { decision: "deny" });
    app.commands.dismissApproval(evt(7));
    app.engine.flush();
    // 재설정 뒤 목록 복원이 같은 승인을 다시 주어도 되살아나지 않는다
    listApproval(app);
    expect(app.engine.read.getState().approvals.ids).toEqual([]);
    await app.stop();
  });
});

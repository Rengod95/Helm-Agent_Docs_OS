import { describe, expect, test } from "bun:test";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until } from "./support.ts";

// 덧씌우기(overlay)는 호출자가 넘길 때만 turn.start에 실린다. 넘기지 않은 기존 호출은 지금과 같은 모양이다.

const turnStarts = (params: { method: string; params: unknown }[]): unknown[] =>
  params.filter((entry) => entry.method === "turn.start").map((entry) => entry.params);

describe("sendTurn passes the overlay to turn.start only when the caller gives one", () => {
  test("an overlay rides on that turn, and a turn without one sends no overlay key", async () => {
    const { fake, params } = engineFake([summary(thr(1))]);
    const app = makeApp(fake);
    await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
    await app.commands.sendTurn(thr(1), "src를 봐 줘", "req-1", undefined, "followUp", [
      { plugin: "review-kit", entry: "review" },
    ]);
    await app.commands.sendTurn(thr(1), "hi", "req-2");
    expect(turnStarts(params)).toEqual([
      {
        threadId: thr(1),
        input: "src를 봐 줘",
        requestId: "req-1",
        whenBusy: "followUp",
        overlay: [{ plugin: "review-kit", entry: "review" }],
      },
      { threadId: thr(1), input: "hi", requestId: "req-2", whenBusy: "followUp" },
    ]);
    await app.stop();
  });

  test("a turn with an overlay is sent as input, not read as a slash command", async () => {
    const { fake, params } = engineFake([summary(thr(1))]);
    const app = makeApp(fake);
    await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
    const sent = await app.commands.sendTurn(
      thr(1),
      "/review src",
      "req-3",
      undefined,
      "followUp",
      [{ plugin: "helm", entry: "review" }],
    );
    expect(sent).toEqual({ ok: true, value: null });
    expect(params.filter((entry) => entry.method === "command.run")).toHaveLength(0);
    expect(turnStarts(params)).toEqual([
      {
        threadId: thr(1),
        input: "/review src",
        requestId: "req-3",
        whenBusy: "followUp",
        overlay: [{ plugin: "helm", entry: "review" }],
      },
    ]);
    await app.stop();
  });
});

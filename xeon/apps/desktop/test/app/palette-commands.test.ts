import { describe, expect, test } from "bun:test";
import type { ThreadCompactResult, TurnResumeResult } from "@fresnel/contracts/wire";
import { summary, thr, trn } from "../state/helpers.ts";
import { engineFake, makeApp, until } from "./support.ts";

// 명령 팔레트가 쓰는 명령(`compactThread`, `resumeTurn`, `runCommandLine`)과 실행 횟수 저장(`paletteUses`, `savePaletteUses`)을
// 가짜 엔진과 가짜 셸 위에서 끝까지 돌린다. 값은 `toEqual`로 비교한다.

async function liveApp(extra: Parameters<typeof engineFake>[2]) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
  return { app, ...engine };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.find((entry) => entry.method === method)?.params;

describe("palette thread actions", () => {
  test("compaction sends the thread id only and a skipped result comes back as the host sent it", async () => {
    const skipped: ThreadCompactResult = { status: "skipped", why: "nothing_to_summarize" };
    const { app, params } = await liveApp({ results: { "thread.compact": skipped } });
    expect(await app.commands.compactThread(thr(1))).toEqual({ ok: true, value: skipped });
    expect(paramsOf(params, "thread.compact")).toEqual({ threadId: thr(1) });
    await app.stop();
  });

  test("resuming a run sends the thread id and a resumed result comes back as the host sent it", async () => {
    const resumed: TurnResumeResult = { status: "resumed", turnId: trn(1), from: "tools" };
    const { app, params } = await liveApp({ results: { "turn.resume": resumed } });
    expect(await app.commands.resumeTurn(thr(1))).toEqual({ ok: true, value: resumed });
    expect(paramsOf(params, "turn.resume")).toEqual({ threadId: thr(1) });
    await app.stop();
  });

  test("a command line goes to command.run as it is, and an unknown command is not sent as chat", async () => {
    const { app, params } = await liveApp({
      results: { "command.run": { status: "not_command" } },
    });
    expect(await app.commands.runCommandLine(thr(1), "/helm start")).toEqual({
      ok: true,
      value: { status: "not_command" },
    });
    expect(paramsOf(params, "command.run")).toEqual({ threadId: thr(1), text: "/helm start" });
    expect(params.some((entry) => entry.method === "turn.start")).toBe(false);
    await app.stop();
  });
});

describe("palette use counts", () => {
  test("nothing saved reads as no counts, and saved counts read back and are kept in the local file", async () => {
    const { app, fake } = await liveApp({});
    expect(app.commands.paletteUses()).toEqual({});
    expect(await app.commands.savePaletteUses({ "thread.new": 2 })).toBe(true);
    expect(app.commands.paletteUses()).toEqual({ "thread.new": 2 });
    expect(fake.settingsFile["l4.desktop.window.paletteUses"]).toEqual({ "thread.new": 2 });
    await app.stop();
  });
});

describe("last viewed thread", () => {
  test("nothing saved reads as none, a saved id reads back and is kept in the local file, and an empty save clears it", async () => {
    const { app, fake } = await liveApp({});
    expect(app.commands.lastThreadId()).toBeNull();
    expect(await app.commands.saveLastThread(thr(1))).toBe(true);
    expect(app.commands.lastThreadId()).toBe(thr(1));
    expect(fake.settingsFile["l4.desktop.window.lastThread"]).toBe(thr(1));
    expect(await app.commands.saveLastThread(null)).toBe(true);
    expect(app.commands.lastThreadId()).toBeNull();
    await app.stop();
  });
});

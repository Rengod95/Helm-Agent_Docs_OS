import { describe, expect, test } from "bun:test";
import { STORE, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 대화 행 메뉴 명령(H4)을 가짜 엔진 위에서 끝까지 돌린다. wire params는 `toEqual`로 정확히 비교한다.

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.filter((entry) => entry.method === method).map((entry) => entry.params);

const POSITION = { storeId: STORE, seq: 1 };

describe("thread row menu commands", () => {
  test("rename sends the new title for that thread", async () => {
    const { app, params } = await liveApp({ results: { "thread.rename": { position: POSITION } } });
    const done = await app.commands.renameThread(thr(1), "새 이름");
    expect(done).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "thread.rename")).toEqual([{ threadId: thr(1), title: "새 이름" }]);
  });

  test("close sends only the thread id", async () => {
    const { app, params } = await liveApp({ results: { "thread.close": {} } });
    const done = await app.commands.closeThread(thr(2));
    expect(done).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "thread.close")).toEqual([{ threadId: thr(2) }]);
  });

  test("selecting another conversation closes the one being left, once", async () => {
    const { app, params } = await liveApp({ results: { "thread.close": {} } });
    app.commands.selectThread(thr(1));
    expect(paramsOf(params, "thread.close")).toEqual([]);
    app.commands.selectThread(thr(2));
    await until(() => paramsOf(params, "thread.close").length > 0, "close sent");
    app.commands.selectThread(thr(2));
    expect(paramsOf(params, "thread.close")).toEqual([{ threadId: thr(1) }]);
  });

  test("delete sends the thread id and then reads the list again", async () => {
    const { app, params } = await liveApp({ results: { "thread.delete": {} } });
    const before = paramsOf(params, "thread.list").length;
    const done = await app.commands.deleteThread(thr(3));
    expect(done).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "thread.delete")).toEqual([{ threadId: thr(3) }]);
    await until(() => paramsOf(params, "thread.list").length > before, "list reload");
  });

  test("a host refusal comes back as a rejected value and nothing is reloaded", async () => {
    const { app, params } = await liveApp({
      errors: { "thread.delete": { code: 3004, kind: "thread.hasForks" } },
    });
    const before = paramsOf(params, "thread.list").length;
    const done = await app.commands.deleteThread(thr(3));
    expect(done.ok).toBe(false);
    expect(paramsOf(params, "thread.list").length).toBe(before);
  });

  test("notices list asks from the start", async () => {
    const { app, params } = await liveApp({
      results: { "notify.list": { notices: [], nextSeq: 0 } },
    });
    const listed = await app.commands.notices.list();
    expect(listed).toEqual({ ok: true, value: { notices: [], nextSeq: 0 } });
    expect(paramsOf(params, "notify.list")).toEqual([{ afterSeq: 0 }]);
  });
});

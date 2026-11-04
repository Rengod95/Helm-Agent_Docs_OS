import { describe, expect, test } from "bun:test";
import { itm, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 대화 내보내기 명령(`exportThread`)을 가짜 엔진 위에서 끝까지 돌린다. 쪽마다 `thread.export`를 부르고, 앞 쪽의 `next`를
// `after`로 넘기며, 쪽들이 한 문서로 이어지는지 본다. wire params는 `toEqual`로 정확히 비교한다.

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.filter((entry) => entry.method === method).map((entry) => entry.params);

const FIRST_PAGE = {
  format: "markdown",
  filename: "대화.md",
  chunk: "# 대화\n",
  next: itm(2),
  itemCount: 1,
};
const LAST_PAGE = { format: "markdown", filename: "대화.md", chunk: "## User\nhi\n", itemCount: 1 };

describe("thread export command", () => {
  test("each page is asked with the previous next as after, and the chunks join into one document", async () => {
    const pages = [FIRST_PAGE, LAST_PAGE];
    let reads = 0;
    const { app, params } = await liveApp({
      resultFor: (method) => {
        if (method !== "thread.export") return undefined;
        const reply = pages[reads];
        reads += 1;
        return reply;
      },
    });
    expect(await app.commands.exportThread(thr(1), "markdown")).toEqual({
      ok: true,
      value: { filename: "대화.md", content: "# 대화\n## User\nhi\n", itemCount: 2 },
    });
    expect(paramsOf(params, "thread.export")).toEqual([
      { threadId: thr(1), format: "markdown" },
      { threadId: thr(1), format: "markdown", after: itm(2) },
    ]);
    await app.stop();
  });

  test("a page that fails stops the export: the refusal comes back and no further page is asked", async () => {
    let calls = 0;
    const { app, params } = await liveApp({
      resultFor: (method) => (method === "thread.export" ? FIRST_PAGE : undefined),
      failFor: (method) => {
        if (method !== "thread.export") return undefined;
        calls += 1;
        return calls === 2 ? { code: 3005, kind: "thread.invalidTarget" } : undefined;
      },
    });
    const done = await app.commands.exportThread(thr(1), "json");
    expect(done.ok).toBe(false);
    expect(paramsOf(params, "thread.export")).toEqual([
      { threadId: thr(1), format: "json" },
      { threadId: thr(1), format: "json", after: itm(2) },
    ]);
    await app.stop();
  });
});

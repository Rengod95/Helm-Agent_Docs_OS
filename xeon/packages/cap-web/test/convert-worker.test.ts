import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { convert, type ConvertInput } from "../src/fetch/convert/convert.ts";
import { createWorkerConvertRunner, directConvertRunner } from "../src/fetch/convert-runner.ts";

const input: ConvertInput = {
  bytes: new Uint8Array(readFileSync(new URL("./fixtures/html/article.html", import.meta.url))),
  contentType: "text/html; charset=utf-8",
  baseUrl: "https://blog.example/posts/xeon",
  extractor: "readability",
};

async function probeWorker(): Promise<unknown> {
  const worker = new Worker(new URL("../src/fetch/convert-worker.ts", import.meta.url));
  const reply = new Promise<unknown>((resolve) => {
    worker.once("message", resolve);
  });
  worker.postMessage({ id: 1, probe: true }, []);
  const data = await reply;
  await worker.terminate();
  return data;
}

describe("convert worker", () => {
  test("the worker strips the network globals before importing the conversion module", async () => {
    const reply = await probeWorker();
    expect(reply).toEqual({
      id: 1,
      probe: [
        ["fetch", "undefined"],
        ["WebSocket", "undefined"],
        ["EventSource", "undefined"],
        ["XMLHttpRequest", "undefined"],
        // 소켓 API는 부르면 던지는 함수로 바꿨다. `Bun.fetch`는 쓰기 불가·설정 불가라 Bun 1.4.3에서 막을 길이 없다(알려진 틈, WEB-R16 검사가 변환 모듈의 `Bun.` 접근을 막는다)
        ["Bun.connect", "blocked"],
        ["Bun.listen", "blocked"],
        ["Bun.udpSocket", "blocked"],
        ["Bun.serve", "blocked"],
        ["Bun.fetch", "Bun.fetch is read-only and non-configurable in Bun 1.4.3"],
      ],
    });
    // 이 프로세스의 전역은 그대로다
    expect(typeof Reflect.get(globalThis, "fetch")).toBe("function");
    expect(typeof Bun.fetch).toBe("function");
    expect(typeof Bun.connect).toBe("function");
  });

  test("a worker run gives the same result as the direct call", async () => {
    const runner = createWorkerConvertRunner({ timeoutMs: 20_000 });
    const signal = new AbortController().signal;
    const viaWorker = await runner.convert(input, signal);
    const direct = await directConvertRunner().convert(input, signal);
    await runner.close();
    expect(viaWorker.ok).toBe(true);
    expect(viaWorker).toEqual(direct);
    expect(direct).toEqual({ ok: true, value: convert(input) });
  });

  test("an aborted request is refused before reaching the worker", async () => {
    const runner = createWorkerConvertRunner();
    const controller = new AbortController();
    controller.abort();
    const outcome = await runner.convert(input, controller.signal);
    await runner.close();
    expect(outcome).toEqual({ ok: false, error: { kind: "aborted" } });
  });
});

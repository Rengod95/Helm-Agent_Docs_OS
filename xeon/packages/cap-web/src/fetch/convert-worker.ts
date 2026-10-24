import { parentPort } from "node:worker_threads";

// L2.web.spec §4.9.3 WEB-R16 실행 위치: 변환은 Worker 하나에서 돈다. 시작 코드가 네트워크 전역을 지운 뒤에야 변환
// 모듈을 import한다(정적 import는 지우기 전에 평가되므로 동적 import를 쓴다). 이 파일은 convert/ 밖이라 globalThis를 쓸 수 있다.

const REMOVED_GLOBALS = ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"] as const;

for (const name of REMOVED_GLOBALS) Reflect.deleteProperty(globalThis, name);

const port = parentPort;
if (port === null) {
  throw new Error("convert-worker must run inside a worker thread");
}

const { convert } = await import("./convert/convert.ts");

port.on("message", (message: unknown) => {
  const id: unknown =
    typeof message === "object" && message !== null ? Reflect.get(message, "id") : undefined;
  const probe: unknown =
    typeof message === "object" && message !== null ? Reflect.get(message, "probe") : undefined;
  if (typeof id !== "number") return;
  if (probe === true) {
    // 시험용: 지운 전역이 정말 없는지 알린다
    port.postMessage({
      id,
      probe: REMOVED_GLOBALS.map((name) => [name, typeof Reflect.get(globalThis, name)]),
    });
    return;
  }
  const input: unknown =
    typeof message === "object" && message !== null ? Reflect.get(message, "input") : undefined;
  if (typeof input !== "object" || input === null) {
    port.postMessage({ id, error: "missing input" });
    return;
  }
  const bytes: unknown = Reflect.get(input, "bytes");
  const contentType: unknown = Reflect.get(input, "contentType");
  const baseUrl: unknown = Reflect.get(input, "baseUrl");
  const extractor: unknown = Reflect.get(input, "extractor");
  if (
    !(bytes instanceof Uint8Array) ||
    typeof contentType !== "string" ||
    typeof baseUrl !== "string" ||
    (extractor !== "readability" && extractor !== "defuddle")
  ) {
    port.postMessage({ id, error: "malformed input" });
    return;
  }
  port.postMessage({ id, result: convert({ bytes, contentType, baseUrl, extractor }) });
});

import { parentPort } from "node:worker_threads";

// L2.web.spec §4.9.3 WEB-R16 실행 위치: 변환은 Worker 하나에서 돈다. 시작 코드가 네트워크 전역을 지운 뒤에야 변환
// 모듈을 import한다(정적 import는 지우기 전에 평가되므로 동적 import를 쓴다). 이 파일은 convert/ 밖이라 globalThis를 쓸 수 있다.

const REMOVED_GLOBALS = ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"] as const;
/**
 * `Bun` 객체의 네트워크 진입점. 전역 `fetch`를 지워도 `Bun.fetch`와 소켓 API는 남는다. 속성을 지울 수는 없다(`globalThis.Bun`과
 * 그 속성은 설정 불가). 쓰기 가능한 소켓 API는 부르면 던지는 함수로 바꾸고, 쓰기 불가인 `Bun.fetch`는 Bun 1.4.3에서 막을 길이 없어
 * 열려 있다(`BUN_FETCH_OPEN`). 변환 모듈의 `Bun.` 접근은 WEB-R16 검사(`check-layers`)가 막는다.
 */
const REPLACED_BUN_MEMBERS = ["connect", "listen", "udpSocket", "serve"] as const;
const BUN_FETCH_OPEN = "Bun.fetch is read-only and non-configurable in Bun 1.4.3";
const DISABLED_MARKER = "disabled in the convert worker";

for (const name of REMOVED_GLOBALS) Reflect.deleteProperty(globalThis, name);

/** 바꾸지 못하면(쓰기 불가) 시작을 멈춘다. 네트워크 길이 열린 채로 변환하지 않는다 */
const bun: unknown = Reflect.get(globalThis, "Bun");
if (typeof bun === "object" && bun !== null) {
  for (const name of REPLACED_BUN_MEMBERS) {
    const replaced = Reflect.set(bun, name, () => {
      throw new Error(`Bun.${name} is ${DISABLED_MARKER}`);
    });
    if (!replaced) throw new Error(`convert-worker could not replace Bun.${name}`);
  }
}

/** 시험용: 이 Bun 멤버를 부르면 막혀 있는가 */
function bunMemberState(name: string): string {
  const target: unknown = Reflect.get(globalThis, "Bun");
  if (typeof target !== "object" || target === null) return "absent";
  const member: unknown = Reflect.get(target, name);
  if (typeof member !== "function") return "absent";
  if (name === "fetch") return BUN_FETCH_OPEN;
  try {
    Reflect.apply(member, target, []);
    return "open";
  } catch (caught) {
    return caught instanceof Error && caught.message.includes(DISABLED_MARKER) ? "blocked" : "open";
  }
}

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
      probe: [
        ...REMOVED_GLOBALS.map((name) => [name, typeof Reflect.get(globalThis, name)]),
        ...[...REPLACED_BUN_MEMBERS, "fetch"].map((name) => [`Bun.${name}`, bunMemberState(name)]),
      ],
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

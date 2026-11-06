import { parentPort } from "node:worker_threads";
// 순서가 의미다: 전역을 지우는 모듈이 변환 모듈보다 먼저 평가되어야 한다
import {
  BUN_FETCH_OPEN,
  DISABLED_MARKER,
  REMOVED_GLOBALS,
  REPLACED_BUN_MEMBERS,
} from "./convert-lockdown.ts";
import { convert } from "./convert/convert.ts";

// L2.web.spec §4.9.3 WEB-R16 실행 위치: 변환은 Worker 하나에서 돈다. `convert-lockdown.ts`가 먼저 평가되어 네트워크 전역을
// 지운 뒤에 변환 모듈이 평가된다(정적 import 순서. 동적 import는 컴파일 사이드카에 묶이지 않는다). 이 파일은 convert/ 밖이라 globalThis를 쓸 수 있다.

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

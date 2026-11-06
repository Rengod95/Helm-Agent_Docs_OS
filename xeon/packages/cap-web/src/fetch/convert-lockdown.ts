// 변환 Worker의 첫 import. 모듈은 import 순서대로 평가되므로 이 파일이 네트워크 전역을 지운 뒤에야 변환 모듈이 평가된다
// (L2.web.spec §4.9.3 WEB-R16). 동적 import는 컴파일 사이드카에 묶이지 않아 정적 import 순서로 같은 보장을 얻는다.
// 이 파일은 convert/ 밖이라 globalThis를 쓸 수 있다.

export const REMOVED_GLOBALS = ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"] as const;
/**
 * `Bun` 객체의 네트워크 진입점. 전역 `fetch`를 지워도 `Bun.fetch`와 소켓 API는 남는다. 속성을 지울 수는 없다(`globalThis.Bun`과
 * 그 속성은 설정 불가). 쓰기 가능한 소켓 API는 부르면 던지는 함수로 바꾸고, 쓰기 불가인 `Bun.fetch`는 Bun 1.4.3에서 막을 길이 없어
 * 열려 있다(`BUN_FETCH_OPEN`). 변환 모듈의 `Bun.` 접근은 WEB-R16 검사(`check-layers`)가 막는다.
 */
export const REPLACED_BUN_MEMBERS = ["connect", "listen", "udpSocket", "serve"] as const;
export const BUN_FETCH_OPEN = "Bun.fetch is read-only and non-configurable in Bun 1.4.3";
export const DISABLED_MARKER = "disabled in the convert worker";

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

// `/shell` WebSocket 프레임과 바이트 부호화. 서버(session)와 브라우저 shim이 같이 쓰므로 node 전용 API를 쓰지 않는다.
// 프레임은 JSON 텍스트 한 줄이다. `Uint8Array`는 `{"$bytes": "<base64>"}`로 실려 가고 받는 쪽이 되돌린다.

/** 브라우저 → 게이트웨이 */
export type ClientFrame =
  /** 셸 명령. `args` 안의 `{ $channel: n }`은 브라우저가 연 채널이다 */
  | { readonly t: "invoke"; readonly id: number; readonly cmd: string; readonly args: unknown }
  | { readonly t: "close-channel"; readonly id: number };

/** 게이트웨이 → 브라우저 */
export type ServerFrame =
  | { readonly t: "reply"; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly t: "reply"; readonly id: number; readonly ok: false; readonly error: unknown }
  | { readonly t: "channel"; readonly id: number; readonly message: unknown }
  | { readonly t: "event"; readonly name: string };

/** `/shell` 프레임 하나의 최대 글자 수. 넘으면 연결을 닫는다 */
export const MAX_SHELL_FRAME_CHARS: number = 8 * 1024 * 1024;

const BYTES_KEY = "$bytes";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** 값을 JSON 글자로. `Uint8Array`는 `$bytes`로 바꾼다 */
export function encodeFrame(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item instanceof Uint8Array ? { [BYTES_KEY]: toBase64(item) } : item,
  );
}

/** JSON 글자를 값으로. `{"$bytes": "..."}`는 `Uint8Array`가 된다. 모양이 틀리면 던진다(호출자가 거절 처리) */
export function decodeFrame(text: string): unknown {
  return JSON.parse(text, (_key, item: unknown) => {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      const keys = Object.keys(item);
      const first = keys[0];
      if (keys.length === 1 && first === BYTES_KEY) {
        const encoded: unknown = Object.getOwnPropertyDescriptor(item, BYTES_KEY)?.value;
        if (typeof encoded === "string") return fromBase64(encoded);
      }
    }
    return item;
  });
}

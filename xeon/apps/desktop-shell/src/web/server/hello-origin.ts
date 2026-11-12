// `/wire` 위쪽 바이트(브라우저 → 서비스)에서 `host.hello`를 찾아 `client.origin: "remote"`와 `client.deviceId`를 덧붙인다(L4.remote.spec §8.9).
// 게이트웨이가 항상 붙이고 클라이언트가 보낸 같은 필드는 덮어쓴다. 표시는 권한을 줄이는 쪽으로만 쓰이므로(`approval.respond` 거절) 속여도 얻는 것이 없다.
// 메시지 경계는 믿지 않으므로 줄(JSON Lines) 단위로 이어 붙인다. hello가 아닌 줄은 바이트 그대로 보낸다.
// hello는 실패한 뒤 다시 보낼 수 있으므로(서비스가 연결을 awaitingHello에 남긴다) 연결이 끝날 때까지 모든 줄을 본다.
import { parseJson } from "@fresnel/contracts";

const NEWLINE = 0x0a;
const BACKSLASH = 0x5c;
const HELLO_METHOD = "host.hello";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 한 줄(줄바꿈 제외)이 hello일 수 있는가. 키 이름은 `\\u` 이스케이프로 숨길 수 있으므로 백슬래시도 후보다 */
function mayBeHello(line: Uint8Array): boolean {
  if (line.includes(BACKSLASH)) return true;
  return decoder.decode(line).includes("hello");
}

/** hello 줄이면 표시를 덧붙인 줄을, 아니면 null을 돌려준다 */
function markedLine(line: Uint8Array, deviceId: string): Uint8Array | null {
  const parsed = parseJson(decoder.decode(line));
  if (!parsed.ok) return null;
  const message = parsed.value;
  if (!isRecord(message) || message["method"] !== HELLO_METHOD) return null;
  const params = message["params"];
  if (!isRecord(params)) return null;
  const client = params["client"];
  if (!isRecord(client)) return null;
  const marked = {
    ...message,
    params: { ...params, client: { ...client, origin: "remote", deviceId } },
  };
  return encoder.encode(JSON.stringify(marked));
}

export interface HelloMarker {
  /** 위쪽 바이트를 받아 서비스에 쓸 바이트를 돌려준다. 끝나지 않은 줄은 다음 호출까지 잡아 둔다 */
  feed(bytes: Uint8Array): Uint8Array;
  /** 잡아 둔 바이트의 크기(상한 검사용) */
  held(): number;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

export function createHelloMarker(deviceId: string): HelloMarker {
  let tail: Uint8Array = new Uint8Array(0);
  return {
    feed(bytes) {
      const joined = tail.byteLength === 0 ? bytes : concat([tail, bytes]);
      const lastBreak = joined.lastIndexOf(NEWLINE);
      if (lastBreak === -1) {
        tail = joined;
        return new Uint8Array(0);
      }
      tail = joined.slice(lastBreak + 1);
      const out: Uint8Array[] = [];
      let start = 0;
      while (start <= lastBreak) {
        const end = joined.indexOf(NEWLINE, start);
        const line = joined.subarray(start, end);
        const marked = mayBeHello(line) ? markedLine(line, deviceId) : null;
        out.push(marked ?? line, joined.subarray(end, end + 1));
        start = end + 1;
      }
      return concat(out);
    },
    held() {
      return tail.byteLength;
    },
  };
}

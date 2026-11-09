// 인증서를 만드는 데 필요한 만큼의 DER(ASN.1) 인코더. `node:crypto`에는 인증서 생성 API가 없고 새 의존을 더하지 않으므로 직접 쓴다.
// 읽는 쪽은 `X509Certificate`가 맡는다. 여기는 쓰기뿐이다.

/** 길이 필드(DER 정의 길이 형식) */
function lengthBytes(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  let rest = length;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** 태그, 길이, 내용 */
export function tlv(tag: number, ...parts: readonly Uint8Array[]): Uint8Array {
  const content = concat(parts);
  return concat([Uint8Array.of(tag), lengthBytes(content.byteLength), content]);
}

export function derSequence(...parts: readonly Uint8Array[]): Uint8Array {
  return tlv(0x30, ...parts);
}

export function derSet(...parts: readonly Uint8Array[]): Uint8Array {
  return tlv(0x31, ...parts);
}

/** 양의 정수(빅엔디언 바이트). 앞의 0을 줄이고, 최상위 비트가 서 있으면 0x00을 붙인다 */
export function derPositiveInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.byteLength - 1 && bytes[start] === 0) start += 1;
  const trimmed = bytes.subarray(start);
  const first = trimmed[0] ?? 0;
  return first >= 0x80
    ? tlv(0x02, Uint8Array.of(0), trimmed)
    : tlv(0x02, trimmed.byteLength === 0 ? Uint8Array.of(0) : trimmed);
}

export function derSmallInteger(value: number): Uint8Array {
  return derPositiveInteger(Uint8Array.of(value));
}

export function derBoolean(value: boolean): Uint8Array {
  return tlv(0x01, Uint8Array.of(value ? 0xff : 0x00));
}

export function derOctetString(bytes: Uint8Array): Uint8Array {
  return tlv(0x04, bytes);
}

/** 사용하지 않는 비트 수 `unused`를 앞에 둔 비트 문자열 */
export function derBitString(bytes: Uint8Array, unused: number): Uint8Array {
  return tlv(0x03, Uint8Array.of(unused), bytes);
}

export function derUtf8String(text: string): Uint8Array {
  return tlv(0x0c, new TextEncoder().encode(text));
}

/** 점으로 쓴 OID(`2.5.29.17`)를 DER 내용으로 */
export function derOid(dotted: string): Uint8Array {
  const arcs = dotted.split(".").map((part) => Number.parseInt(part, 10));
  const [first = 0, second = 0, ...rest] = arcs;
  const bytes: number[] = [first * 40 + second];
  for (const arc of rest) {
    const group: number[] = [arc & 0x7f];
    let remaining = Math.floor(arc / 128);
    while (remaining > 0) {
      group.unshift((remaining & 0x7f) | 0x80);
      remaining = Math.floor(remaining / 128);
    }
    bytes.push(...group);
  }
  return tlv(0x06, Uint8Array.from(bytes));
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

/** 2050년 전은 UTCTime, 그 뒤는 GeneralizedTime(RFC 5280 4.1.2.5). 초 단위, 항상 Z */
export function derTime(epochMs: number): Uint8Array {
  const date = new Date(Math.floor(epochMs / 1000) * 1000);
  const year = date.getUTCFullYear();
  const rest = `${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(
    date.getUTCMinutes(),
  )}${two(date.getUTCSeconds())}Z`;
  if (year < 2050) {
    return tlv(0x17, new TextEncoder().encode(`${two(year % 100)}${rest}`));
  }
  return tlv(0x18, new TextEncoder().encode(`${String(year).padStart(4, "0")}${rest}`));
}

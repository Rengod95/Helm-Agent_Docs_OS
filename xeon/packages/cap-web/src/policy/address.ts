// L2.web.spec §4.6.2, §4.6.3. IP 주소를 파싱하고 범위 표로 분류하는 순수 함수다. 외부 라이브러리를 쓰지 않는다.

export type AddressClass =
  /** 공개 주소 */
  | "public"
  /** 사설망(10/8, 172.16/12, 192.168/16, fc00::/7, CGNAT). 설정으로만 연다 */
  | "private"
  /** 루프백과 미지정 주소(0.0.0.0/8, 127/8, ::1, ::). 사설망 허용으로도 열지 않는다 */
  | "loopback"
  /** 링크 로컬(169.254/16, fe80::/10) */
  | "link_local"
  /** 문서용, 벤치마크, 멀티캐스트, 예약 범위 */
  | "reserved"
  /** 클라우드 메타데이터 주소. 항상 거부 */
  | "metadata";

const METADATA_V4: ReadonlySet<string> = new Set([
  "169.254.169.254",
  "169.254.170.2",
  "100.100.100.200",
]);

/** 점 네 개 표기의 IPv4. 각 마디는 0~255 십진수 */
export function parseIpv4(text: string): readonly [number, number, number, number] | undefined {
  const parts = text.split(".");
  if (parts.length !== 4) return undefined;
  const numbers: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return undefined;
    const value = Number.parseInt(part, 10);
    if (value > 255) return undefined;
    numbers.push(value);
  }
  const [a, b, c, d] = numbers;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return undefined;
  return [a, b, c, d];
}

type Hextets = readonly [number, number, number, number, number, number, number, number];

function hexPair(v4: readonly [number, number, number, number]): [string, string] {
  return [((v4[0] << 8) | v4[1]).toString(16), ((v4[2] << 8) | v4[3]).toString(16)];
}

function parseHextetList(text: string): number[] | undefined {
  if (text === "") return [];
  const out: number[] = [];
  for (const group of text.split(":")) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined;
    out.push(Number.parseInt(group, 16));
  }
  return out;
}

/** 대괄호와 영역 ID(%eth0)를 벗기고 8개 16비트 값으로 푼다. 끝의 점 네 개 표기(::ffff:1.2.3.4)도 받는다 */
export function parseIpv6(text: string): Hextets | undefined {
  let body = text.replace(/^\[/, "").replace(/\]$/, "");
  const zone = body.indexOf("%");
  if (zone !== -1) body = body.slice(0, zone);
  if (!body.includes(":")) return undefined;
  if (body.includes(".")) {
    const cut = body.lastIndexOf(":");
    const v4 = parseIpv4(body.slice(cut + 1));
    if (v4 === undefined) return undefined;
    const [hi, lo] = hexPair(v4);
    body = `${body.slice(0, cut + 1)}${hi}:${lo}`;
  }
  const halves = body.split("::");
  if (halves.length > 2) return undefined;
  let groups: number[] | undefined;
  if (halves.length === 1) {
    groups = parseHextetList(body);
    if (groups?.length !== 8) return undefined;
  } else {
    const head = parseHextetList(halves[0] ?? "");
    const tail = parseHextetList(halves[1] ?? "");
    if (head === undefined || tail === undefined) return undefined;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return undefined;
    groups = [...head, ...Array.from({ length: missing }, () => 0), ...tail];
  }
  const [h0, h1, h2, h3, h4, h5, h6, h7] = groups;
  if (
    h0 === undefined ||
    h1 === undefined ||
    h2 === undefined ||
    h3 === undefined ||
    h4 === undefined ||
    h5 === undefined ||
    h6 === undefined ||
    h7 === undefined
  ) {
    return undefined;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7];
}

function classifyIpv4(v4: readonly [number, number, number, number]): AddressClass {
  const [a, b, c] = v4;
  if (METADATA_V4.has(v4.join("."))) return "metadata";
  if (a === 0 || a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private";
  if (a === 169 && b === 254) return "link_local";
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return "reserved";
  if (a === 198 && (b === 18 || b === 19)) return "reserved";
  if (a === 198 && b === 51 && c === 100) return "reserved";
  if (a === 203 && b === 0 && c === 113) return "reserved";
  if (a >= 224) return "reserved";
  return "public";
}

function v4Of(hi: number, lo: number): readonly [number, number, number, number] {
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
}

function classifyIpv6(h: Hextets): AddressClass {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h;
  const zeroToH5 = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0;
  if (zeroToH5 && h6 === 0 && (h7 === 0 || h7 === 1)) return "loopback";
  // IPv4 매핑(::ffff:a.b.c.d)과 옛 IPv4 호환(::a.b.c.d)은 안에 든 IPv4로 다시 검사한다
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
    return classifyIpv4(v4Of(h6, h7));
  }
  if (zeroToH5) return classifyIpv4(v4Of(h6, h7));
  // NAT64 64:ff9b::/96은 안에 든 IPv4로, 로컬 용도 64:ff9b:1::/48은 통째로 거부한다
  if (h0 === 0x64 && h1 === 0xff9b) {
    if (h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) return classifyIpv4(v4Of(h6, h7));
    if (h2 === 1) return "reserved";
  }
  // 6to4 2002::/16
  if (h0 === 0x2002) return classifyIpv4(v4Of(h1, h2));
  // 메타데이터 fd00:ec2::254는 fc00::/7보다 먼저 본다
  if (
    h0 === 0xfd00 &&
    h1 === 0x0ec2 &&
    h2 === 0 &&
    h3 === 0 &&
    h4 === 0 &&
    h5 === 0 &&
    h6 === 0 &&
    h7 === 0x254
  ) {
    return "metadata";
  }
  if ((h0 & 0xfe00) === 0xfc00) return "private";
  if ((h0 & 0xffc0) === 0xfe80) return "link_local";
  // 사이트 로컬(fec0::/10, 폐기됨), 멀티캐스트 ff00::/8
  if ((h0 & 0xffc0) === 0xfec0 || (h0 & 0xff00) === 0xff00) return "reserved";
  // 문서용 2001:db8::/32, Teredo 2001::/32
  if (h0 === 0x2001 && (h1 === 0x0db8 || h1 === 0)) return "reserved";
  return "public";
}

/** 주소 문자열을 분류한다. IP가 아니면 undefined */
export function classifyAddress(text: string): AddressClass | undefined {
  const v4 = parseIpv4(text);
  if (v4 !== undefined) return classifyIpv4(v4);
  const v6 = parseIpv6(text);
  if (v6 !== undefined) return classifyIpv6(v6);
  return undefined;
}

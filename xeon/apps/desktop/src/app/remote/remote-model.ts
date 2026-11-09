import {
  isFingerprintHex,
  type DeviceKind,
  type PairingCode,
  type RemoteDevice,
  type RemoteStatus,
} from "./remote-types.ts";

// 원격 접속 화면의 순수 함수(React 없음). 지문 표시, 페어링 남은 시간, 접속 주소, 서버 모드 판정, 기기 줄과 정렬을 맡는다.
// 시각은 부르는 쪽이 `now`로 넘긴다. 이 파일은 시계를 읽지 않는다.

/** 방금 연결한 것으로 치는 범위(밀리초) */
const RECENT_MS = 60_000;

/** 서버 모드. `service`는 이 기기 서비스만 돈다. `service+remote`는 원격 접속까지 켜져 있다 */
export type ServerMode = "off" | "service" | "service+remote";

/** 마지막 연결 표시 종류. `now`는 방금, `ago`는 그 전, `never`는 한 번도 없음이다 */
export type LastSeenKind = "never" | "now" | "ago";

/** 기기 한 줄. 마지막 연결 표시 종류를 덧붙인다 */
export interface DeviceRow {
  readonly id: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly createdAt: number;
  readonly lastSeenAt: number | null;
  readonly address: string | null;
  readonly lastSeenKind: LastSeenKind;
}

/** 지문을 콜론으로 나눈 대문자 쌍으로 바꾼다(`ab12…` → `AB:12:…`). 64자 소문자 16진수가 아니면 null이다 */
export function fingerprintDisplay(hex: string): string | null {
  if (!isFingerprintHex(hex)) return null;
  const pairs: string[] = [];
  for (let i = 0; i < hex.length; i += 2) pairs.push(hex.slice(i, i + 2).toUpperCase());
  return pairs.join(":");
}

/** 페어링 코드가 남은 밀리초. 만료했으면 0이다(음수가 되지 않는다) */
export function pairingRemainingMs(code: PairingCode, now: number): number {
  return Math.max(0, code.expiresAt - now);
}

/** 만료했는가. 만료 시각에 이르면 만료다 */
export function isPairingExpired(code: PairingCode, now: number): boolean {
  return now >= code.expiresAt;
}

/** 남은 밀리초를 `M:SS`로 쓴다. 초는 올림이라 시간이 남은 동안에는 `0:00`이 되지 않는다. 음수는 `0:00`이다 */
export function pairingRemainingLabel(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 호스트가 IPv6 주소(콜론이 든 값)면 URL에 쓰도록 대괄호로 감싼다. 이미 감싸였으면 그대로다 */
function bracketedHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/**
 * 접속 주소. 호스트마다 `https://<호스트>:<TLS 포트>`를 앞에 두고, 루프백 포트가 열려 있으면
 * `http://127.0.0.1:<루프백 포트>`를 뒤에 둔다. 포트가 null이면 그 종류의 주소는 없다.
 */
export function accessUrls(status: RemoteStatus): readonly string[] {
  const urls: string[] = [];
  if (status.tlsPort !== null) {
    for (const host of status.hosts) urls.push(`https://${bracketedHost(host)}:${status.tlsPort}`);
  }
  if (status.loopbackPort !== null) urls.push(`http://127.0.0.1:${status.loopbackPort}`);
  return urls;
}

/**
 * 서버 모드. 원격 접속이 켜져 있고 꺼진 상태가 아니면 `service+remote`다. 그 밖에 이 기기 서비스가 돌면 `service`다.
 * 상태를 못 읽었으면(null) 서비스가 도는지만 본다.
 */
export function serverModeOf(status: RemoteStatus | null, serviceRunning: boolean): ServerMode {
  if (status !== null && status.enabled && status.state !== "off") return "service+remote";
  return serviceRunning ? "service" : "off";
}

function lastSeenKindOf(lastSeenAt: number | null, now: number): LastSeenKind {
  if (lastSeenAt === null) return "never";
  return now - lastSeenAt <= RECENT_MS ? "now" : "ago";
}

/** 기기 한 대를 화면 줄로 바꾼다 */
export function deviceRowOf(device: RemoteDevice, now: number): DeviceRow {
  return {
    id: device.id,
    name: device.name,
    kind: device.kind,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    address: device.address,
    lastSeenKind: lastSeenKindOf(device.lastSeenAt, now),
  };
}

/** 최근 연결 순 비교. 한 번도 연결하지 않은 기기는 뒤로, 같은 자리에서는 나중에 등록한 것이 앞이다 */
function byRecency(a: RemoteDevice, b: RemoteDevice): number {
  if (a.lastSeenAt !== b.lastSeenAt) {
    if (a.lastSeenAt === null) return 1;
    if (b.lastSeenAt === null) return -1;
    return b.lastSeenAt - a.lastSeenAt;
  }
  return b.createdAt - a.createdAt;
}

/** 기기 목록을 최근 연결 순으로 정렬한 새 배열을 돌려준다. 입력은 바꾸지 않는다 */
export function sortDevices(devices: readonly RemoteDevice[]): readonly RemoteDevice[] {
  return devices.toSorted(byRecency);
}

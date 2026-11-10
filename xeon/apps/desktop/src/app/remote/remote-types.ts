import { err, ok, type Result } from "@fresnel/contracts";

// 원격 접속(서버 모드)의 값 모양과 응답 검사. 계약 패키지에 `host.remote.*`가 들어오기 전까지 이 파일이 모양을 정한다.
// 병합 때는 이 타입과 검사를 계약 타입으로 바꾼다. 응답은 `unknown`이라 `as` 없이 typeof, Array.isArray, 자기 속성으로 좁힌다.
// 한 줄이라도 모양이 틀리면 값 전체를 `bad-reply`로 거절한다(일부만 살리지 않는다).

/** 원격 접속 상태. `off`는 꺼짐, `starting`은 띄우는 중, `failed`는 띄우지 못함이다 */
export type RemoteState = "off" | "starting" | "running" | "failed";
/** 인증서 출처. 자체 서명이거나 사용자가 준 인증서다 */
export type CertSource = "self-signed" | "user";
/** 기기 종류. 웹 브라우저로 붙은 기기거나 데스크톱 셸이다 */
export type DeviceKind = "web" | "desktop";

/** 원격 접속 상태의 오류 한 줄. 엔진이 준 종류와 문장이다 */
interface RemoteStatusError {
  readonly kind: string;
  readonly message: string;
}

/** `host.remote.status`와 `host.remote.setEnabled`의 값 */
export interface RemoteStatus {
  readonly enabled: boolean;
  readonly state: RemoteState;
  /** 이 기기 루프백 HTTP 포트. 꺼졌거나 아직 열리지 않았으면 null */
  readonly loopbackPort: number | null;
  /** TLS 리스너 포트. 꺼졌거나 아직 열리지 않았으면 null */
  readonly tlsPort: number | null;
  /** 접속 주소로 알릴 호스트 이름과 IP 목록 */
  readonly hosts: readonly string[];
  /** 인증서 지문. 소문자 16진수 64자이고, 인증서가 없으면 null */
  readonly fingerprint: string | null;
  readonly certSource: CertSource | null;
  /** 웹 푸시를 보낼 수 있는가 */
  readonly pushAvailable: boolean;
  readonly error: RemoteStatusError | null;
}

/** `host.remote.pair`의 값. 만료 시각은 epoch 밀리초다 */
export interface PairingCode {
  readonly code: string;
  readonly expiresAt: number;
}

/** 페어링된 기기 한 대. `lastSeenAt`이 null이면 한 번도 연결하지 않았다 */
export interface RemoteDevice {
  readonly id: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly createdAt: number;
  readonly lastSeenAt: number | null;
  readonly address: string | null;
}

/** 해제 대상. 기기 하나(`id`)거나 전부(`all`)다 */
export type RevokeTarget = { readonly id: string } | { readonly all: true };

/** `host.remote.revoke`의 값. `revoked`는 실제로 해제한 기기 수다 */
export interface RevokeResult {
  readonly revoked: number;
}

/**
 * 원격 명령의 오류. `remote-off`는 원격 접속이 꺼져 있다는 뜻이다. `unsupported`는 엔진이 `host.remote.*`를 모른다(-32601, 옛 서비스)는 뜻이고
 * 엔진 오프라인·시간 초과와 따로 알린다. `bad-reply`는 응답 모양이 틀렸다는 뜻이다.
 * `failed`는 그 밖의 실패이고, 엔진이 준 문장이 있으면 `message`에 남긴다.
 */
export type RemoteError =
  | { readonly kind: "remote-off" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "bad-reply" }
  | { readonly kind: "failed"; readonly message: string | null };

const BAD_REPLY: RemoteError = { kind: "bad-reply" };
const REMOTE_STATES: readonly RemoteState[] = ["off", "starting", "running", "failed"];
const FINGERPRINT_HEX = /^[0-9a-f]{64}$/;

/** 지문 문자열이 소문자 16진수 64자인가. 표시와 검사가 같은 기준을 쓴다 */
export function isFingerprintHex(text: string): boolean {
  return FINGERPRINT_HEX.test(text);
}

// ── 좁히기 ──────────────────────────────────────────────────────────────

/** 객체가 자기 속성으로 가진 값. 객체가 아니거나 없으면 undefined다. 상속 속성은 보지 않는다 */
function ownField(value: unknown, name: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const field: unknown = Object.getOwnPropertyDescriptor(value, name)?.value;
  return field;
}

function isRemoteState(value: unknown): value is RemoteState {
  return REMOTE_STATES.some((state) => state === value);
}

function isDeviceKind(value: unknown): value is DeviceKind {
  return value === "web" || value === "desktop";
}

function isCertSourceOrNull(value: unknown): value is CertSource | null {
  return value === null || value === "self-signed" || value === "user";
}

/** 포트 번호. 열린 포트는 1부터 65535까지의 정수다 */
function isPortOrNull(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535)
  );
}

/** 0 이상의 정수. 밀리초 시각과 기기 수가 이 모양이다 */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isFingerprintOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && isFingerprintHex(value));
}

function isHostList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((host: unknown) => isNonEmptyText(host));
}

/** 상태의 오류 한 줄. 없으면 null, 모양이 틀리면 undefined다 */
function statusErrorOf(value: unknown): RemoteStatusError | null | undefined {
  if (value === null) return null;
  const kind = ownField(value, "kind");
  const message = ownField(value, "message");
  if (typeof kind !== "string" || typeof message !== "string") return undefined;
  return { kind, message };
}

/** 기기 한 대. 모양이 틀리면 null이다 */
function deviceOf(value: unknown): RemoteDevice | null {
  const id = ownField(value, "id");
  const name = ownField(value, "name");
  const kind = ownField(value, "kind");
  const createdAt = ownField(value, "createdAt");
  const lastSeenAt = ownField(value, "lastSeenAt");
  const address = ownField(value, "address");
  if (
    !isNonEmptyText(id) ||
    typeof name !== "string" ||
    !isDeviceKind(kind) ||
    !isCount(createdAt) ||
    !(lastSeenAt === null || isCount(lastSeenAt)) ||
    !isTextOrNull(address)
  ) {
    return null;
  }
  return { id, name, kind, createdAt, lastSeenAt, address };
}

// ── 응답 검사 ──────────────────────────────────────────────────────────

/** `host.remote.status`와 `host.remote.setEnabled`의 응답을 읽는다 */
export function parseStatus(reply: unknown): Result<RemoteStatus, RemoteError> {
  const enabled = ownField(reply, "enabled");
  const state = ownField(reply, "state");
  const loopbackPort = ownField(reply, "loopbackPort");
  const tlsPort = ownField(reply, "tlsPort");
  const hosts = ownField(reply, "hosts");
  const fingerprint = ownField(reply, "fingerprint");
  const certSource = ownField(reply, "certSource");
  const pushAvailable = ownField(reply, "pushAvailable");
  const error = statusErrorOf(ownField(reply, "error"));
  if (
    typeof enabled !== "boolean" ||
    !isRemoteState(state) ||
    !isPortOrNull(loopbackPort) ||
    !isPortOrNull(tlsPort) ||
    !isHostList(hosts) ||
    !isFingerprintOrNull(fingerprint) ||
    !isCertSourceOrNull(certSource) ||
    typeof pushAvailable !== "boolean" ||
    error === undefined
  ) {
    return err(BAD_REPLY);
  }
  return ok({
    enabled,
    state,
    loopbackPort,
    tlsPort,
    hosts,
    fingerprint,
    certSource,
    pushAvailable,
    error,
  });
}

/** `host.remote.pair`의 응답을 읽는다 */
export function parsePairing(reply: unknown): Result<PairingCode, RemoteError> {
  const code = ownField(reply, "code");
  const expiresAt = ownField(reply, "expiresAt");
  if (!isNonEmptyText(code) || !isCount(expiresAt)) return err(BAD_REPLY);
  return ok({ code, expiresAt });
}

/** `host.remote.devices`의 응답(`{ devices }`)을 읽는다. 기기 목록의 순서는 응답 그대로다 */
export function parseDevices(reply: unknown): Result<readonly RemoteDevice[], RemoteError> {
  const list = ownField(reply, "devices");
  if (!Array.isArray(list)) return err(BAD_REPLY);
  const devices: RemoteDevice[] = [];
  for (const item of list) {
    const device = deviceOf(item);
    if (device === null) return err(BAD_REPLY);
    devices.push(device);
  }
  return ok(devices);
}

/** `host.remote.revoke`의 응답을 읽는다 */
export function parseRevoked(reply: unknown): Result<RevokeResult, RemoteError> {
  const revoked = ownField(reply, "revoked");
  if (!isCount(revoked)) return err(BAD_REPLY);
  return ok({ revoked });
}

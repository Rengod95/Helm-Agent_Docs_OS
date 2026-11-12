import {
  parseTargetAddress,
  pinAddress,
  pinOfAddress,
  type TargetAddressReason,
} from "@fresnel/client";
import { assertNever } from "@fresnel/contracts";

// 연결 주소 칸의 순수 모델(DOM 없음). 방식별 칸 값을 저장 주소 문자열로 조립하고, 붙여넣은 주소를 방식과 칸으로 푼다.
// 형식 검사는 `parseTargetAddress`·`pinAddress`(client)가 한다. 컴퓨터 추가 모델(`add-computer-model.ts`)이 쓴다.

/** 연결 방식 */
type HostKind = "ssh" | "wss" | "unix" | "tcp";

export interface SshFields {
  /** 사용자(선택). 비우면 `user@`가 없다 */
  readonly user: string;
  readonly host: string;
  /** 포트(선택). 비우면 기본 22를 쓴다 */
  readonly port: string;
  /** 원격 서비스 소켓의 절대 경로 */
  readonly socket: string;
}

interface WssFields {
  /** 호스트와 포트(`host[:port]`). 포트를 비우면 8443이다. `https://`나 `wss://`를 붙여도 된다 */
  readonly address: string;
  /** 서버 인증서 지문(선택). `:`·공백·대문자를 받는다. 비우면 처음 연결 때 확인해 고정한다 */
  readonly pin: string;
}

interface UnixFields {
  /** 이 컴퓨터의 소켓 경로(절대 경로) */
  readonly path: string;
}

interface TcpFields {
  /** 이 컴퓨터 안의 포트 번호. 주소는 항상 127.0.0.1이다 */
  readonly port: string;
}

export interface HostFieldsByKind {
  readonly ssh: SshFields;
  readonly wss: WssFields;
  readonly unix: UnixFields;
  readonly tcp: TcpFields;
}

/** 방식과 그 방식의 칸. 방식이 칸의 짝을 정하므로 한 값으로 든다 */
export type HostFields = {
  readonly [K in HostKind]: { readonly kind: K } & HostFieldsByKind[K];
}[HostKind];

const DEFAULT_WEB_PORT = 8443;
const WEB_PREFIX = /^(?:https|wss):\/\//i;

/** `https://`·`wss://`를 `wss://`로 바꾸고, 권한부(호스트[:포트])에 포트가 없으면 8443을 붙인다. 경로는 그대로 둔다 */
function webBaseOf(text: string): string {
  const rest = text.replace(WEB_PREFIX, "");
  const slash = rest.indexOf("/");
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? "" : rest.slice(slash);
  const hasPort = /:\d+$/.test(authority);
  return `wss://${hasPort ? authority : `${authority}:${String(DEFAULT_WEB_PORT)}`}${path}`;
}

/** 웹 주소 칸에 보이는 모양. IPv6는 대괄호로 감싼다 */
function displayWeb(host: string, port: number): string {
  return `${host.includes(":") ? `[${host}]` : host}:${String(port)}`;
}

function composeSsh(fields: SshFields): string {
  const host = fields.host.trim();
  if (host === "") return "";
  const user = fields.user.trim();
  const port = fields.port.trim();
  const socket = fields.socket.trim();
  return `ssh://${user === "" ? "" : `${user}@`}${host}${port === "" ? "" : `:${port}`}${socket}`;
}

function composeWss(fields: WssFields): string {
  const address = fields.address.trim();
  if (address === "") return "";
  const base = webBaseOf(address);
  const pin = fields.pin.replace(/\s+/g, "");
  if (pin === "") return base;
  const pinned = pinAddress(base, pin);
  return pinned.ok ? pinned.address : base;
}

function composeUnix(fields: UnixFields): string {
  const path = fields.path.trim();
  return path === "" ? "" : `unix:${path}`;
}

function composeTcp(fields: TcpFields): string {
  const port = fields.port.trim();
  return port === "" ? "" : `tcp://127.0.0.1:${port}`;
}

const COMPOSERS: { readonly [K in HostKind]: (fields: HostFieldsByKind[K]) => string } = {
  ssh: composeSsh,
  wss: composeWss,
  unix: composeUnix,
  tcp: composeTcp,
};

/** 칸을 저장할 주소 문자열로 조립한다. 필수 칸이 비었으면 빈 문자열이다. 검사는 하지 않는다(`parseTargetAddress`가 한다) */
export function composeAddress<K extends HostKind>(kind: K, fields: HostFieldsByKind[K]): string {
  return COMPOSERS[kind](fields);
}

/** 방식과 칸을 한 값으로 받아 조립한다 */
export function composeFields(fields: HostFields): string {
  return composeAddress(fields.kind, fields);
}

/** 붙여넣은 전체 주소를 방식과 칸으로 푼다. 검사는 `parseTargetAddress`가 하고, 거절 사유를 그대로 돌려준다 */
export type HostParse =
  | { readonly ok: true; readonly fields: HostFields }
  | { readonly ok: false; readonly reason: TargetAddressReason };

export function fieldsOfAddress(text: string): HostParse {
  const trimmed = text.trim();
  const address = WEB_PREFIX.test(trimmed) ? webBaseOf(trimmed) : trimmed;
  const parsed = parseTargetAddress(address);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const target = parsed.target;
  switch (target.kind) {
    case "unix":
      return { ok: true, fields: { kind: "unix", path: target.path } };
    case "ssh":
      return {
        ok: true,
        fields: {
          kind: "ssh",
          user: target.user ?? "",
          host: target.host,
          port: target.port === null ? "" : String(target.port),
          socket: target.socket,
        },
      };
    case "tcp":
      return { ok: true, fields: { kind: "tcp", port: String(target.port) } };
    case "wss":
      return {
        ok: true,
        fields: {
          kind: "wss",
          address: displayWeb(target.host, target.port),
          pin: pinOfAddress(address) ?? "",
        },
      };
    default:
      return assertNever(target, "TargetAddress");
  }
}

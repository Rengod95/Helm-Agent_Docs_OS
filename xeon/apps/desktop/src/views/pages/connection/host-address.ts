import {
  addTarget,
  parseTargetAddress,
  pinAddress,
  pinOfAddress,
  type TargetAddress,
  type TargetAddressReason,
  type TargetEntry,
} from "@fresnel/client";
import { assertNever } from "@fresnel/contracts";

// 연결 주소 칸의 순수 모델(DOM 없음). 방식별 칸 값을 저장 주소 문자열로 조립하고, 붙여넣은 주소를 방식과 칸으로 풀고,
// 칸마다 오류를 가린다. 검사 규칙은 `parseTargetAddress`·`pinAddress`·`addTarget`이 한다. 여기서는 칸 값을 그 검사에
// 넣어 어느 칸 탓인지 가린다. 칸 값을 자리 표시 주소에 넣어 풀어 보고, 풀린 값이 칸 값과 같을 때만 그 칸이 맞다고 본다
// (구분 문자가 칸에 섞이면 다르게 풀리므로 이렇게 잡힌다). SSH 소켓이 `/`로 시작하는지만 칸에서 따로 보는데, 조립한
// 주소에서는 그 경계가 사라져서 `relative_path` 사유를 붙이려는 것이다.

/** 연결 방식. 화면의 방식 고르기 순서는 `HOST_KINDS`다 */
export type HostKind = "ssh" | "wss" | "unix" | "tcp";

export const HOST_KINDS: readonly HostKind[] = ["ssh", "wss", "unix", "tcp"];

/** 고르기 목록의 글을 방식으로 바꾼다. 목록에 없는 글이면 undefined다 */
export function hostKindOf(text: string): HostKind | undefined {
  return HOST_KINDS.find((kind) => kind === text);
}

export interface SshFields {
  /** 사용자(선택). 비우면 `user@`가 없다 */
  readonly user: string;
  readonly host: string;
  /** 포트(선택). 비우면 기본 22를 쓴다 */
  readonly port: string;
  /** 원격 서비스 소켓의 절대 경로 */
  readonly socket: string;
}

export interface WssFields {
  /** 호스트와 포트(`host[:port]`). 포트를 비우면 8443이다. `https://`나 `wss://`를 붙여도 된다 */
  readonly address: string;
  /** 서버 인증서 지문(선택). `:`·공백·대문자를 받는다. 비우면 처음 연결 때 확인해 고정한다 */
  readonly pin: string;
}

export interface UnixFields {
  /** 이 컴퓨터의 소켓 경로(절대 경로) */
  readonly path: string;
}

export interface TcpFields {
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

/** 추가 칸 전체. 이름 칸과 방식·칸 값이다 */
export interface HostFormValue {
  /** 이름. 비우면 저장할 때 `suggestLabel`의 제안을 쓴다 */
  readonly label: string;
  readonly fields: HostFields;
}

/** 방식의 빈 칸 */
export function blankFieldsOf(kind: HostKind): HostFields {
  switch (kind) {
    case "ssh":
      return { kind, user: "", host: "", port: "", socket: "" };
    case "wss":
      return { kind, address: "", pin: "" };
    case "unix":
      return { kind, path: "" };
    case "tcp":
      return { kind, port: "" };
    default:
      return assertNever(kind, "HostKind");
  }
}

/** 방식을 바꾼다. 이름은 두고 칸은 새 방식의 빈 칸이 된다. 같은 방식이면 그대로 둔다 */
export function switchKind(value: HostFormValue, kind: HostKind): HostFormValue {
  if (value.fields.kind === kind) return value;
  return { label: value.label, fields: blankFieldsOf(kind) };
}

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

/** 웹 주소 칸의 호스트 부분(포트와 경로를 뗀다). 이름 제안에 쓴다 */
function hostOfWeb(text: string): string {
  const rest = text.trim().replace(WEB_PREFIX, "");
  const authority = rest.split("/")[0] ?? "";
  const bracketed = /^\[([^\]]*)\]/.exec(authority);
  if (bracketed !== null) return bracketed[1] ?? "";
  return authority.replace(/:\d*$/, "");
}

/** 경로의 마지막 조각. 빈 조각은 세지 않는다 */
function lastSegmentOf(path: string): string {
  const parts = path
    .trim()
    .split("/")
    .filter((part) => part !== "");
  return parts.at(-1) ?? "";
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

/** 칸을 저장할 주소 문자열로 조립한다. 필수 칸이 비었으면 빈 문자열이다. 검사는 하지 않는다(`checkHostForm`이 한다) */
export function composeAddress<K extends HostKind>(kind: K, fields: HostFieldsByKind[K]): string {
  return COMPOSERS[kind](fields);
}

/** 방식과 칸을 한 값으로 받아 조립한다 */
export function composeFields(fields: HostFields): string {
  return composeAddress(fields.kind, fields);
}

const LABELS: { readonly [K in HostKind]: (fields: HostFieldsByKind[K]) => string } = {
  ssh: (fields) => fields.host.trim() || lastSegmentOf(fields.socket),
  wss: (fields) => hostOfWeb(fields.address),
  unix: (fields) => lastSegmentOf(fields.path) || fields.path.trim(),
  tcp: (fields) => {
    const port = fields.port.trim();
    return port === "" ? "" : `127.0.0.1:${port}`;
  },
};

/** 이름 칸을 비웠을 때 쓸 이름 제안. 호스트 이름, 없으면 소켓·경로의 마지막 조각, TCP는 `127.0.0.1:<포트>` */
export function suggestLabel<K extends HostKind>(kind: K, fields: HostFieldsByKind[K]): string {
  return LABELS[kind](fields);
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

/** 칸 이름. 오류가 어느 칸 탓인지 가리킨다. `target`은 칸 밖의 오류(같은 주소가 이미 있음 등)다 */
export type HostFieldKey =
  | "user"
  | "host"
  | "port"
  | "socket"
  | "address"
  | "pin"
  | "path"
  | "target";

/** 칸 오류 사유. 주소 사유에 지문 형식 오류를 더한다 */
type HostReason = TargetAddressReason | "duplicate" | "bad_fingerprint";

export interface HostFieldError {
  readonly field: HostFieldKey;
  readonly reason: HostReason;
}

/** 조립한 자리 표시 주소를 풀어 사유를 본다. 풀었는데 `same`이 거짓이면 칸 값이 구분 문자를 품은 것이다 */
function reasonOfText(text: string, same: (target: TargetAddress) => boolean): HostReason | null {
  const parsed = parseTargetAddress(text);
  if (!parsed.ok) return parsed.reason;
  return same(parsed.target) ? null : "bad_format";
}

function sshErrors(fields: SshFields): HostFieldError[] {
  const user = fields.user.trim();
  const host = fields.host.trim();
  const port = fields.port.trim();
  const socket = fields.socket.trim();
  const errors: HostFieldError[] = [];
  const add = (field: HostFieldKey, reason: HostReason | null): void => {
    if (reason !== null) errors.push({ field, reason });
  };
  if (host === "") add("host", "empty");
  else
    add(
      "host",
      reasonOfText(
        `ssh://${host}/x`,
        (t) => t.kind === "ssh" && t.host === host && t.user === null && t.port === null,
      ),
    );
  if (user !== "")
    add(
      "user",
      reasonOfText(`ssh://${user}@box/x`, (t) => t.kind === "ssh" && t.user === user),
    );
  if (port !== "")
    add(
      "port",
      reasonOfText(`ssh://box:${port}/x`, (t) => t.kind === "ssh" && t.port === Number(port)),
    );
  if (socket === "") add("socket", "empty");
  else if (!socket.startsWith("/")) add("socket", "relative_path");
  else
    add(
      "socket",
      reasonOfText(`ssh://box${socket}`, (t) => t.kind === "ssh" && t.socket === socket),
    );
  return errors;
}

function wssErrors(fields: WssFields): HostFieldError[] {
  const address = fields.address.trim();
  const pin = fields.pin.replace(/\s+/g, "");
  if (address === "") return [{ field: "address", reason: "empty" }];
  const base = webBaseOf(address);
  const errors: HostFieldError[] = [];
  const addressReason = reasonOfText(base, (t) => t.kind === "wss");
  if (addressReason !== null) errors.push({ field: "address", reason: addressReason });
  // 주소가 틀리면 pinAddress가 `not_wss`를 돌려주므로 지문 오류는 주소가 맞을 때만 나온다
  if (pin !== "") {
    const pinned = pinAddress(base, pin);
    if (!pinned.ok && pinned.reason === "bad_fingerprint") {
      errors.push({ field: "pin", reason: "bad_fingerprint" });
    }
  }
  return errors;
}

function unixErrors(fields: UnixFields): HostFieldError[] {
  const path = fields.path.trim();
  if (path === "") return [{ field: "path", reason: "empty" }];
  const reason = reasonOfText(`unix:${path}`, (t) => t.kind === "unix" && t.path === path);
  return reason === null ? [] : [{ field: "path", reason }];
}

function tcpErrors(fields: TcpFields): HostFieldError[] {
  const port = fields.port.trim();
  if (port === "") return [{ field: "port", reason: "empty" }];
  const reason = reasonOfText(
    `tcp://127.0.0.1:${port}`,
    (t) => t.kind === "tcp" && t.port === Number(port),
  );
  return reason === null ? [] : [{ field: "port", reason }];
}

/** 칸마다의 오류. 빈 배열이면 칸은 모두 맞다(같은 주소가 있는지는 `checkHostForm`이 본다) */
export function fieldErrorsOf(fields: HostFields): readonly HostFieldError[] {
  switch (fields.kind) {
    case "ssh":
      return sshErrors(fields);
    case "wss":
      return wssErrors(fields);
    case "unix":
      return unixErrors(fields);
    case "tcp":
      return tcpErrors(fields);
    default:
      return assertNever(fields, "HostFields");
  }
}

/** 추가 칸 검사 결과. 맞으면 저장할 대상 한 줄과 바뀐 목록을, 틀리면 칸별 오류를 돌려준다 */
export type HostCheck =
  | { readonly ok: true; readonly entry: TargetEntry; readonly list: readonly TargetEntry[] }
  | { readonly ok: false; readonly errors: readonly HostFieldError[] };

/**
 * 추가 칸을 저장 가능한지 본다. 칸 오류가 있으면 그것을 주고, 없으면 조립한 주소를 `addTarget`에 넣는다
 * (형식은 이미 칸에서 맞았고, 여기서는 같은 주소나 같은 id를 거른다). 이름이 비었으면 `suggestLabel`을 쓴다.
 */
export function checkHostForm(
  value: HostFormValue,
  items: readonly TargetEntry[],
  id: string,
): HostCheck {
  const errors = fieldErrorsOf(value.fields);
  if (errors.length > 0) return { ok: false, errors };
  const address = composeFields(value.fields).trim();
  const label = value.label.trim() || suggestLabel(value.fields.kind, value.fields) || address;
  const added = addTarget(items, { id, label, address });
  if (!added.ok) return { ok: false, errors: [{ field: "target", reason: added.reason }] };
  return { ok: true, entry: { id, label, address }, list: added.list };
}

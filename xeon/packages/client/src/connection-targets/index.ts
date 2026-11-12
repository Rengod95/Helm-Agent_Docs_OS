import { parse } from "@fresnel/contracts";
import { Type } from "typebox";
import { parseTargetAddress, type TargetAddressReason } from "./address.ts";

export * from "./address.ts";

// 원격 대상 목록(P-08, 데스크톱 로컬 설정 `TARGETS_KEY`). 주소 문법은 `endpoint.ts`를 그대로 쓰고,
// 화면이 받을 사유만 바꾼다. 저장하는 주소는 루프백 TCP, Unix, SSH, `wss`(LAN·외부 게이트웨이, TLS)다.
// 평문 비루프백 `tcp://`는 받지 않는다(L4.remote.spec §9). 다른 컴퓨터는 `wss://`나 `ssh://`로 붙는다.

// ── 지문 고정(TOFU)과 토큰 보관 이름 ───────────────────────────────────

/** `wss` 주소의 서버 지문. 다른 종류나 고정 전이면 null이다 */
export function pinOfAddress(address: string): string | null {
  const parsed = parseTargetAddress(address);
  return parsed.ok && parsed.target.kind === "wss" ? parsed.target.pin : null;
}

export type PinAddressResult =
  | { readonly ok: true; readonly address: string }
  | { readonly ok: false; readonly reason: "not_wss" | "bad_fingerprint" };

/**
 * 사용자가 확인한 지문을 `wss` 주소에 고정한다(`wss://host:port/pin/<sha256>`). 이미 고정돼 있으면 새 지문으로 바꾼다
 * (지문 변경을 사용자가 다시 확인한 경우). 지문은 64자리 16진수이고 `:` 구분자와 대문자를 받는다.
 */
export function pinAddress(address: string, fingerprint: string): PinAddressResult {
  const parsed = parseTargetAddress(address);
  if (!parsed.ok || parsed.target.kind !== "wss") return { ok: false, reason: "not_wss" };
  const pin = fingerprint.replaceAll(":", "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pin)) return { ok: false, reason: "bad_fingerprint" };
  const { host, port } = parsed.target;
  const shown = host.includes(":") ? `[${host}]` : host;
  return { ok: true, address: `wss://${shown}:${String(port)}/pin/${pin}` };
}

/** 지문 고정을 지운 주소. 지문이 바뀐 서버를 다시 확인할 때 쓴다. `wss`가 아니면 null이다 */
export function unpinAddress(address: string): string | null {
  const parsed = parseTargetAddress(address);
  if (!parsed.ok || parsed.target.kind !== "wss") return null;
  const { host, port } = parsed.target;
  return `wss://${host.includes(":") ? `[${host}]` : host}:${String(port)}`;
}

/**
 * 기기 토큰을 OS 보안 저장소에 둘 때의 항목 이름(`platform-secrets`의 `TokenVault` account). 지문 고정과 무관하게
 * `host:port`로만 정해서, 지문을 새로 고정해도 토큰을 다시 입력하지 않는다. `wss`가 아니면 null이다.
 */
export function tokenAccountOf(address: string): string | null {
  const parsed = parseTargetAddress(address);
  if (!parsed.ok || parsed.target.kind !== "wss") return null;
  const { host, port } = parsed.target;
  return `${host.includes(":") ? `[${host}]` : host.toLowerCase()}:${String(port)}`;
}

// ── 대상 목록 ──────────────────────────────────────────────────────────

/** 대상 목록 한 줄. id는 화면이 만든다 */
export type TargetEntry = { readonly id: string; readonly label: string; readonly address: string };

/**
 * 로컬 설정 키. 셸이 쓰기를 허용하는 접두사(`l4.desktop.window.`) 안에 둔다. `l4.desktop.targets`는 접두사 밖이라 셸이 거부한다
 * (옛 Tauri 구현(커밋 424f338a)의 `desktop_settings.rs` `UI_KEY_PREFIXES`; 지금은 apps/desktop-shell의 `desktop-settings.ts`).
 */
export const TARGETS_KEY = "l4.desktop.window.targets";

/** 대상이 이 개수를 넘으면 검색 입력을 보인다 */
export const TARGET_SEARCH_THRESHOLD = 20;

export type AddTargetResult =
  | { readonly ok: true; readonly list: readonly TargetEntry[] }
  | { readonly ok: false; readonly reason: TargetAddressReason | "duplicate" };

/** 대상을 더한다. 주소 형식을 검사하고, 같은 주소나 같은 id가 있으면 거부한다. 입력 목록은 바꾸지 않는다 */
export function addTarget(list: readonly TargetEntry[], entry: TargetEntry): AddTargetResult {
  const address = entry.address.trim();
  const checked = parseTargetAddress(address);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  if (list.some((item) => item.address === address || item.id === entry.id)) {
    return { ok: false, reason: "duplicate" };
  }
  return { ok: true, list: [...list, { id: entry.id, label: entry.label, address }] };
}

/** id가 같은 대상을 뺀다 */
export function removeTarget(list: readonly TargetEntry[], id: string): readonly TargetEntry[] {
  return list.filter((item) => item.id !== id);
}

/** 이름과 주소에서 대소문자를 가리지 않고 찾는다. 빈 검색어는 전체다 */
export function filterTargets(list: readonly TargetEntry[], query: string): readonly TargetEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return list;
  return list.filter(
    (item) =>
      item.label.toLowerCase().includes(needle) || item.address.toLowerCase().includes(needle),
  );
}

const TargetEntrySchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String(),
  address: Type.String({ minLength: 1 }),
});

/**
 * 저장된 값을 목록으로 읽는다. 배열이 아니면 빈 목록이다. 형식이 틀린 항목, 주소가 해석되지 않는 항목,
 * 비루프백 TCP, 중복은 버린다.
 */
export function targetsStorageOf(value: unknown): readonly TargetEntry[] {
  const items = parse(Type.Array(Type.Unknown()), value);
  if (!items.ok) return [];
  let list: readonly TargetEntry[] = [];
  for (const item of items.value) {
    const checked = parse(TargetEntrySchema, item);
    if (!checked.ok) continue;
    const added = addTarget(list, checked.value);
    if (added.ok) list = added.list;
  }
  return list;
}

// ── 연결 실패 문장 ─────────────────────────────────────────────────────

/**
 * 연결 실패 종류. 클라이언트에는 `AttachError` union이 없어 화면이 이 값으로 묶는다. 엔진이 멈춘 원인(stderr 첫 줄)과
 * 세션의 `hello` 실패 코드를 여기로 옮긴다(연결 화면 `attachFailureOfExit`·`attachFailureOf`).
 */
export type AttachFailureKind =
  | "tunnel"
  | "hostKey"
  | "fingerprint"
  /** 처음 붙는 `wss` 서버의 인증서를 아직 믿지 않았다. 지문을 보여 확인받으면 고정한다 */
  | "certUntrusted"
  | "auth"
  | "tokenMissing"
  | "protocol"
  | "socketMissing"
  | "refused"
  | "timeout"
  | "permission"
  | "other";

/**
 * 연결 실패 종류마다 화면이 바로 해 줄 수 있는 조치. `null`이면 사용자가 밖에서 고쳐야 한다(문장만 보인다).
 * - `confirm_fingerprint`: 서버 지문을 읽어 보여 주고 확인받아 주소에 고정한다(`wss`).
 * - `repair`: 연결 코드를 받아 기기 토큰을 다시 받는다(`wss`).
 * - `preflight`: 대상의 연결 시험(호스트 키 확인, 설치·서비스·버전 확인)을 돌린다(`ssh`).
 * - `retry`: 같은 대상으로 다시 붙는다.
 */
export type AttachFixAction = "confirm_fingerprint" | "repair" | "preflight" | "retry";

const ATTACH_FIX_ACTIONS: Readonly<Record<AttachFailureKind, AttachFixAction | null>> = {
  tunnel: "preflight",
  hostKey: "preflight",
  fingerprint: "confirm_fingerprint",
  certUntrusted: "confirm_fingerprint",
  auth: "repair",
  tokenMissing: "repair",
  protocol: "preflight",
  socketMissing: "preflight",
  refused: "retry",
  timeout: "retry",
  permission: null,
  other: "retry",
};

/** 연결 실패 종류에 화면이 붙일 자동 조치. 없으면 `null`이다 */
export function attachFixActionOf(kind: AttachFailureKind): AttachFixAction | null {
  return ATTACH_FIX_ACTIONS[kind];
}

/** 연결 실패 원인 한 줄의 메시지 키 */
export function attachErrorKey(
  kind: AttachFailureKind,
): `desktop.connection.error.${AttachFailureKind}` {
  return `desktop.connection.error.${kind}`;
}

/** 연결 실패 해결 한 줄의 메시지 키. 원인 줄 바로 아래에 보인다 */
export function attachFixKey(
  kind: AttachFailureKind,
): `desktop.connection.error.${AttachFailureKind}.fix` {
  return `desktop.connection.error.${kind}.fix`;
}

export * from "./preflight.ts";

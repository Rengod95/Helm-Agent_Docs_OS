import { assertNever, parse } from "@fresnel/contracts";
import { Type } from "typebox";
import { parseServiceEndpoint, type EndpointParseError } from "../endpoint.ts";

// 원격 대상 목록(P-08, 데스크톱 로컬 설정 `TARGETS_KEY`). 주소 문법은 `endpoint.ts`를 그대로 쓰고,
// 화면이 받을 사유만 바꾼다. 저장하는 주소는 루프백 TCP이거나 Unix·SSH 주소다. 비루프백 TCP는 SSH 터널이나 사설망을 쓴다.

/** 대상 주소의 해석 결과. 화면이 연결 방식을 고르는 데 쓴다 */
export type TargetAddress =
  | { readonly kind: "unix"; readonly path: string }
  | {
      readonly kind: "ssh";
      readonly user: string | null;
      readonly host: string;
      readonly port: number | null;
      readonly socket: string;
    }
  | { readonly kind: "tcp"; readonly host: string; readonly port: number };

export type TargetAddressReason = "empty" | "bad_format" | "relative_path" | "non_loopback";

export type ParseTargetResult =
  | { readonly ok: true; readonly target: TargetAddress }
  | { readonly ok: false; readonly reason: TargetAddressReason };

/** 받는 형식의 머리. 절대 경로만 쓴 주소(`/abs`)는 여기에 없다 */
const SCHEMES: readonly string[] = ["unix:", "ssh://", "tcp://"];
/** 루프백으로 보는 TCP 호스트. IPv6는 괄호를 뗀 `::1`이다 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "localhost"]);

/** `unix:` 뒤에 내용이 있는데 절대 경로가 아닌 경우 */
function isRelativeUnixPath(trimmed: string): boolean {
  if (!trimmed.startsWith("unix:")) return false;
  const rest = trimmed.slice("unix:".length);
  return rest !== "" && !rest.startsWith("/");
}

/** 엔진 쪽 해석 오류를 화면의 사유로 바꾼다 */
function reasonOf(error: EndpointParseError, trimmed: string): TargetAddressReason {
  switch (error.kind) {
    case "empty":
      return "empty";
    case "unknown_scheme":
      return "bad_format";
    case "invalid":
      return error.part === "path" && isRelativeUnixPath(trimmed) ? "relative_path" : "bad_format";
    default:
      return assertNever(error, "EndpointParseError");
  }
}

/** 대상 주소를 해석한다. 문법은 `parseServiceEndpoint`를 쓰고 루프백 검사만 더한다 */
export function parseTargetAddress(text: string): ParseTargetResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (!SCHEMES.some((scheme) => trimmed.startsWith(scheme))) {
    return { ok: false, reason: "bad_format" };
  }
  const parsed = parseServiceEndpoint(trimmed);
  if (!parsed.ok) return { ok: false, reason: reasonOf(parsed.error, trimmed) };
  const endpoint = parsed.value;
  switch (endpoint.kind) {
    case "unix":
      return { ok: true, target: { kind: "unix", path: endpoint.path } };
    case "ssh": {
      // `[user@]host`에서 나눈다. 사용자와 호스트에는 `@`가 들어가지 않는다(endpoint.ts의 문자 규칙)
      const at = endpoint.target.indexOf("@");
      return {
        ok: true,
        target: {
          kind: "ssh",
          user: at < 0 ? null : endpoint.target.slice(0, at),
          host: at < 0 ? endpoint.target : endpoint.target.slice(at + 1),
          port: endpoint.port ?? null,
          socket: endpoint.remoteSocket,
        },
      };
    }
    case "tcp":
      if (!LOOPBACK_HOSTS.has(endpoint.host.toLowerCase())) {
        return { ok: false, reason: "non_loopback" };
      }
      return { ok: true, target: { kind: "tcp", host: endpoint.host, port: endpoint.port } };
    default:
      return assertNever(endpoint, "ServiceEndpoint");
  }
}

// ── 대상 목록 ──────────────────────────────────────────────────────────

/** 대상 목록 한 줄. id는 화면이 만든다 */
export type TargetEntry = { readonly id: string; readonly label: string; readonly address: string };

/**
 * 로컬 설정 키. 셸이 쓰기를 허용하는 접두사(`l4.desktop.window.`) 안에 둔다. `l4.desktop.targets`는 접두사 밖이라 셸이 거부한다
 * (src-tauri/src/desktop_settings.rs `UI_KEY_PREFIXES`).
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

/** 연결 실패 종류. 클라이언트에는 `AttachError` union이 없어 화면이 이 넷으로 묶는다 */
export type AttachFailureKind = "tunnel" | "auth" | "protocol" | "other";

/** 연결 실패 종류의 메시지 키 */
export function attachErrorKey(
  kind: AttachFailureKind,
): `desktop.connection.error.${AttachFailureKind}` {
  return `desktop.connection.error.${kind}`;
}

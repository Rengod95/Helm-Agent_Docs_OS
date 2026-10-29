import { attemptAsync, parseJson, type Result } from "@xeon/contracts";
import { WireError, type WireParams, type WireResult } from "@xeon/contracts/wire";
import {
  ACCOUNTS_KEY,
  RATE_LIMIT_KEY,
  ROTATION_ACK_KEY,
  type AccountEntry,
  type RateLimitEntry,
} from "./accounts.ts";

// 사용자 설정 파일(`settings.readFile`·`settings.writeFile`, F.wire-settings.spec §3.3.1)에 모델 계정 설정을 쓴다.
// 파일 전체를 다시 쓰므로 편집하지 않은 키와 키 순서는 그대로 둔다(L4.settings-ui.spec §4.2.3).

/** 바꿀 값. 주지 않은 키는 파일에 그대로 남는다 */
export interface AccountsEdits {
  readonly accounts?: readonly AccountEntry[];
  readonly rateLimit?: Readonly<Record<string, RateLimitEntry>>;
  readonly acknowledged?: boolean;
}

/** 파일 원문을 읽어 편집 값만 바꾼 원문을 만든다. 빈 문자열은 빈 객체다. JSON 객체가 아니면 `not_object`다 */
export function settingsFileWith(
  text: string,
  edits: AccountsEdits,
): Result<string, { readonly kind: "not_object" }> {
  const read: Result<unknown, unknown> =
    text.trim() === "" ? { ok: true, value: {} } : parseJson(text);
  if (!read.ok || !isJsonObject(read.value)) return { ok: false, error: { kind: "not_object" } };
  // 기존 키에 대입하면 그 자리가 그대로 남는다. 새 키는 끝에 붙는다
  const next: Record<string, unknown> = { ...read.value };
  if (edits.accounts !== undefined) next[ACCOUNTS_KEY] = edits.accounts;
  if (edits.rateLimit !== undefined) next[RATE_LIMIT_KEY] = edits.rateLimit;
  if (edits.acknowledged !== undefined) next[ROTATION_ACK_KEY] = edits.acknowledged;
  return { ok: true, value: `${JSON.stringify(next, null, 2)}\n` };
}

function isJsonObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 와이어 호출 두 개가 쓰는 연결. 메서드 이름과 모양은 F 와이어 메서드 표에서 가져오므로 타입 검사된다. `HostConnection`이 이 모양을 만족한다 */
export type AccountsWireMethod = "settings.readFile" | "settings.writeFile";

export interface AccountsConnection {
  request<M extends AccountsWireMethod>(method: M, params: WireParams<M>): Promise<WireResult<M>>;
}

/**
 * 저장 실패.
 * - `not_object`: 파일이 JSON 객체가 아니어서 편집할 수 없다(파일은 건드리지 않았다)
 * - `conflict`: 읽은 뒤 파일이 바뀌었다(`settings.fileConflict`). 다시 읽고 합친 뒤 보낸다
 * - `host`: 호스트가 낸 다른 오류(예: `settings.fileInvalid`, 스키마 위반)
 * - `transport`: 응답을 받지 못했다(연결이 닫혔거나 시한이 지났다). `cause`는 `HostClientError`다
 */
export type SaveModelAccountsError =
  | { readonly kind: "not_object" }
  | { readonly kind: "conflict" }
  | { readonly kind: "host"; readonly error: WireError }
  | { readonly kind: "transport"; readonly cause: unknown };

/**
 * 사용자 설정 파일을 읽고 편집 값을 넣어 같은 `baseSha256`으로 다시 쓴다. 읽기와 쓰기 사이에 파일이 바뀌면 `conflict`다.
 * 성공하면 새 파일의 해시를 돌려준다.
 */
export async function saveModelAccounts(
  connection: AccountsConnection,
  edits: AccountsEdits,
): Promise<Result<{ readonly sha256: string }, SaveModelAccountsError>> {
  const read = await callWire(() => connection.request("settings.readFile", { scope: "user" }));
  if (!read.ok) return read;
  const text = settingsFileWith(read.value.text, edits);
  if (!text.ok) return { ok: false, error: text.error };
  const written = await callWire(() =>
    connection.request("settings.writeFile", {
      scope: "user",
      text: text.value,
      baseSha256: read.value.sha256,
    }),
  );
  if (!written.ok) return written;
  return { ok: true, value: { sha256: written.value.sha256 } };
}

/** 와이어 호출 하나를 `Result`로 바꾼다. 던진 값은 종류를 나눠 담는다 */
async function callWire<T>(work: () => PromiseLike<T>): Promise<Result<T, SaveModelAccountsError>> {
  const outcome = await attemptAsync(work);
  if (outcome.ok) return outcome;
  return { ok: false, error: failureOf(outcome.error.cause) };
}

function failureOf(cause: unknown): SaveModelAccountsError {
  if (!(cause instanceof WireError)) return { kind: "transport", cause };
  if (cause.data.kind === "settings.fileConflict") return { kind: "conflict" };
  return { kind: "host", error: cause };
}

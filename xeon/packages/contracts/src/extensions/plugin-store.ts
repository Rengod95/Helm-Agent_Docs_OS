// 플러그인 전용 저장소(대화에 묶이지 않는 플러그인별 JSON 키-값 저장소). 정본은 X.primitives.spec §4.6.7.
// 이름 공간은 호출한 플러그인(확장 이름)이고, ext-host가 등록 레코드의 extension에서 정한다. 플러그인 입력은 이름 공간을 고르지 못한다.
// 실패는 던지지 않고 `{kind}` 값으로 돌려준다(`StateUpdateError`와 같은 방식).

import type { Result } from "../base/index.ts";
import type { JsonValue } from "../conversation/index.ts";
import type { ExtensionName } from "./name.ts";

/** 키 형식: 소문자나 숫자로 시작하고 소문자, 숫자, `.`, `_`, `-`만 쓰며 64자 이하다 */
export const PLUGIN_STORE_KEY_PATTERN = "^[a-z0-9][a-z0-9._-]{0,63}$";
/** 목록 접두 형식: 키 문자만 쓰고 비어 있을 수 있다(전체 목록) */
export const PLUGIN_STORE_PREFIX_PATTERN = "^[a-z0-9._-]{0,64}$";

/** 한도(값 64 KiB, 총량 1 MiB, 키 256개). 값은 직렬화(JSON 텍스트)의 UTF-8 바이트 수로 잰다 */
export const PLUGIN_STORE_LIMITS = {
  /** 값 하나의 직렬화 상한(바이트) */
  valueBytes: 65536,
  /** 플러그인당 키 수 상한 */
  keys: 256,
  /** 플러그인당 값 총량 상한(바이트). 모든 키의 직렬화 크기 합 */
  totalBytes: 1048576,
} as const;

export const PLUGIN_STORE_ERROR_KINDS = [
  "store_key_invalid",
  "store_value_too_large",
  "store_full",
  "storage_unavailable",
] as const;
export type PluginStoreErrorKind = (typeof PLUGIN_STORE_ERROR_KINDS)[number];

/** 저장소 실패. 던지지 않고 값으로 돌려준다. `cause`는 포트가 던진 값을 싣는 자리이고 프로토콜에는 싣지 않는다 */
export interface PluginStoreError {
  readonly kind: PluginStoreErrorKind;
  readonly cause?: unknown;
}

/** `list`의 한 항목. 목록은 키 오름차순이다 */
export interface PluginStoreEntry {
  readonly key: string;
  readonly value: JsonValue;
}

/**
 * `g.pluginStore`. 대화가 없는 확장 메서드(`ctx.threadId === null`)에서도 쓴다.
 * `get`과 `list`는 어디서나 읽는다. `put`과 `delete`는 확장 메서드 처리기 안에서만 쓰고, `readOnly` 메서드에서는 거부한다(X.primitives.spec §4.6.7).
 * 쓰기 규칙을 어기면 `PrimitiveError`를 던진다(계약 위반). 형식과 한도 위반은 값으로 돌려준다.
 */
export interface PluginStoreApi {
  /** 키의 값. 없으면 null */
  get(key: string): Promise<Result<JsonValue | null, PluginStoreError>>;
  put(key: string, value: JsonValue): Promise<Result<void, PluginStoreError>>;
  /** 없는 키를 지워도 실패가 아니다 */
  delete(key: string): Promise<Result<void, PluginStoreError>>;
  /** 접두로 시작하는 키의 목록(키 오름차순). 접두를 생략하면 전부다 */
  list(prefix?: string): Promise<Result<readonly PluginStoreEntry[], PluginStoreError>>;
}

/** 포트가 돌려주는 사용량. `bytes`는 값 직렬화의 바이트 합이다 */
export interface PluginStoreUsage {
  readonly keys: number;
  readonly bytes: number;
}

/** 포트가 돌려주는 한 행. 값은 JSON 텍스트다 */
export interface PluginStoreRow {
  readonly key: string;
  readonly valueJson: string;
}

/**
 * 플러그인 전용 저장소의 호스트 포트(조립 루트가 `ExtHostDeps.pluginStore`로 넘긴다). 구현(sqlite 등)은 호스트 쪽이 고른다.
 * 모든 호출은 이름 공간 `extension` 안에서만 일어난다. ext-host는 키 형식, 값 크기, 키 수, 총량을 포트를 부르기 앞에서 강제하고
 * 포트가 돌려준 값도 믿지 않고 검사한다. 포트가 쓰기 중에 한도를 알아챈 경우에만 `store_full`을 돌려줄 수 있다.
 */
export interface PluginStorePort {
  /** 키의 JSON 텍스트. 없으면 null */
  get(extension: ExtensionName, key: string): Promise<Result<string | null, PluginStoreError>>;
  /** 값의 JSON 텍스트를 쓴다(같은 키는 덮어쓴다) */
  put(
    extension: ExtensionName,
    key: string,
    valueJson: string,
  ): Promise<Result<void, PluginStoreError>>;
  delete(extension: ExtensionName, key: string): Promise<Result<void, PluginStoreError>>;
  /** 접두로 시작하는 행(순서는 정하지 않는다. ext-host가 키로 정렬한다) */
  list(
    extension: ExtensionName,
    prefix: string,
  ): Promise<Result<readonly PluginStoreRow[], PluginStoreError>>;
  usage(extension: ExtensionName): Promise<Result<PluginStoreUsage, PluginStoreError>>;
  /** 플러그인 제거 때 그 이름 공간을 모두 지운다(X.primitives.spec §4.6.7) */
  clear(extension: ExtensionName): Promise<Result<void, PluginStoreError>>;
}

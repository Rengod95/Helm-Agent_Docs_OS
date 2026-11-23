// 플러그인 전용 저장소의 호스트 쪽 규칙(X.primitives.spec §4.6.7). 키 형식, 값 크기, 키 수, 총량을 포트를 부르기 앞에서 강제한다.
// 포트는 신뢰하지 않는다: 포트가 던지거나 돌려준 값이 맞지 않으면 `storage_unavailable` 값으로 바꾼다.
// 쓰기 자격(어느 문맥에서 쓸 수 있는가)은 이 파일이 아니라 g를 만드는 host-api.ts가 본다.

import { attemptAsync, err, ok, parse, parseJson, type Result } from "@fresnel/contracts";
import { JsonValueSchema, toJsonValue, type JsonValue } from "@fresnel/contracts/conversation";
import {
  PLUGIN_STORE_KEY_PATTERN,
  PLUGIN_STORE_LIMITS,
  PLUGIN_STORE_PREFIX_PATTERN,
  type ExtensionName,
  type PluginStoreEntry,
  type PluginStoreError,
  type PluginStorePort,
} from "@fresnel/contracts/extensions";
import { PrimitiveError } from "./errors.ts";

const KEY_REGEX = new RegExp(PLUGIN_STORE_KEY_PATTERN);
const PREFIX_REGEX = new RegExp(PLUGIN_STORE_PREFIX_PATTERN);
const encoder = new TextEncoder();

/** 이름 공간(확장 이름)을 받는 저장소 연산. `createRegistrationApi`가 g마다 등록 레코드의 확장 이름을 넘긴다 */
export interface PluginStoreService {
  get(extension: ExtensionName, key: string): Promise<Result<JsonValue | null, PluginStoreError>>;
  put(
    extension: ExtensionName,
    key: string,
    value: JsonValue,
  ): Promise<Result<void, PluginStoreError>>;
  delete(extension: ExtensionName, key: string): Promise<Result<void, PluginStoreError>>;
  list(
    extension: ExtensionName,
    prefix: string,
  ): Promise<Result<readonly PluginStoreEntry[], PluginStoreError>>;
}

function byteLengthOf(text: string): number {
  return encoder.encode(text).byteLength;
}

/** 포트 호출 하나. 던진 값은 `storage_unavailable`의 `cause`로 옮긴다 */
async function portCall<T>(
  task: () => Promise<Result<T, PluginStoreError>>,
): Promise<Result<T, PluginStoreError>> {
  const called = await attemptAsync(task);
  if (!called.ok) return err({ kind: "storage_unavailable", cause: called.error.cause });
  return called.value;
}

/** 포트가 준 JSON 텍스트를 값으로 옮긴다. 맞지 않으면 저장 데이터 손상이므로 `storage_unavailable`이다 */
function decodeText(text: string): Result<JsonValue, PluginStoreError> {
  const parsedText = parseJson(text);
  if (!parsedText.ok) return err({ kind: "storage_unavailable", cause: parsedText.error });
  const checked = parse(JsonValueSchema, parsedText.value);
  if (!checked.ok) return err({ kind: "storage_unavailable", cause: checked.error });
  return ok(checked.value);
}

async function writeOf(
  store: PluginStorePort,
  extension: ExtensionName,
  key: string,
  text: string,
): Promise<Result<void, PluginStoreError>> {
  const used = await portCall(() => store.usage(extension));
  if (!used.ok) return err(used.error);
  const previous = await portCall(() => store.get(extension, key));
  if (!previous.ok) return err(previous.error);
  const replacedBytes = previous.value === null ? null : byteLengthOf(previous.value);
  const keys = used.value.keys + (replacedBytes === null ? 1 : 0);
  const totalBytes = used.value.bytes - (replacedBytes ?? 0) + byteLengthOf(text);
  if (keys > PLUGIN_STORE_LIMITS.keys || totalBytes > PLUGIN_STORE_LIMITS.totalBytes) {
    return err({ kind: "store_full" });
  }
  const written = await portCall(() => store.put(extension, key, text));
  return written.ok ? ok(undefined) : err(written.error);
}

/** 포트가 없으면 어떤 연산도 `storage_unavailable`이다 */
const NO_PORT: PluginStoreError = { kind: "storage_unavailable" };

/**
 * 플러그인 전용 저장소 서비스를 만든다. `port`가 없으면(조립에 저장소가 없다) 형식이 맞는 연산은 `storage_unavailable`을 돌려준다.
 * 쓰기(`put`, `delete`)는 확장 이름마다 한 줄로 세운다. 한도 검사와 쓰기 사이에 다른 쓰기가 끼어 한도를 넘지 않게 하려는 것이다.
 */
export function createPluginStoreService(port: PluginStorePort | undefined): PluginStoreService {
  const tails = new Map<ExtensionName, Promise<void>>();

  function queued<T>(extension: ExtensionName, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(extension) ?? Promise.resolve();
    const result = previous.then(task);
    const settled: Promise<void> = Promise.allSettled([result]).then(() => {
      if (tails.get(extension) === settled) tails.delete(extension);
      return undefined;
    });
    tails.set(extension, settled);
    return result;
  }

  return {
    async get(extension, key) {
      if (!KEY_REGEX.test(key)) return err({ kind: "store_key_invalid" });
      if (port === undefined) return err(NO_PORT);
      const row = await portCall(() => port.get(extension, key));
      if (!row.ok) return err(row.error);
      if (row.value === null) return ok(null);
      return decodeText(row.value);
    },

    async put(extension, key, value) {
      if (!KEY_REGEX.test(key)) return err({ kind: "store_key_invalid" });
      const json = toJsonValue(value);
      if (json === undefined) {
        throw new PrimitiveError("store_value_invalid", "a plugin store value must be JSON");
      }
      const text = JSON.stringify(json);
      if (byteLengthOf(text) > PLUGIN_STORE_LIMITS.valueBytes) {
        return err({ kind: "store_value_too_large" });
      }
      if (port === undefined) return err(NO_PORT);
      const store = port;
      return queued(extension, () => writeOf(store, extension, key, text));
    },

    async delete(extension, key) {
      if (!KEY_REGEX.test(key)) return err({ kind: "store_key_invalid" });
      if (port === undefined) return err(NO_PORT);
      const store = port;
      return queued(extension, async () => {
        const deleted = await portCall(() => store.delete(extension, key));
        return deleted.ok ? ok(undefined) : err(deleted.error);
      });
    },

    async list(extension, prefix) {
      if (!PREFIX_REGEX.test(prefix)) return err({ kind: "store_key_invalid" });
      if (port === undefined) return err(NO_PORT);
      const listed = await portCall(() => port.list(extension, prefix));
      if (!listed.ok) return err(listed.error);
      const entries: PluginStoreEntry[] = [];
      for (const row of listed.value) {
        // 포트가 접두 밖의 키를 돌려주면 저장소가 어긋난 것이다
        if (!row.key.startsWith(prefix) || !KEY_REGEX.test(row.key)) {
          return err({ kind: "storage_unavailable", cause: { key: row.key } });
        }
        const decoded = decodeText(row.valueJson);
        if (!decoded.ok) return err(decoded.error);
        entries.push({ key: row.key, value: decoded.value });
      }
      entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      return ok(entries);
    },
  };
}

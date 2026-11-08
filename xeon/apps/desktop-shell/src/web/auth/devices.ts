// 기기 표(spec §8.3 3~6). 기기마다 256비트 무작위 토큰을 주고, origin에는 SHA-256 해시와 메타데이터만 둔다(원문은 어디에도 쓰지 않는다).
// 파일: `<origin 상태 폴더>/remote/devices.json`(0600, 임시 파일에 쓰고 rename). 읽기는 메모리 표로 하고 쓰기가 파일에 간다.
// 웹 기기의 로그인 유지는 슬라이딩 12시간, 절대 30일이다. 데스크톱 기기는 폐기 전까지 유효하다.
import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { err, ok, parseJson, type Clock, type Result } from "@fresnel/contracts";
import { isInteger, isRecord, ownField } from "../../main/lib/narrow.ts";
import { readTextFile, writeSecretFile, type FileError } from "./atomic-file.ts";

export const DEVICES_FILE = "devices.json";
export const SESSION_SLIDING_MS: number = 12 * 3_600_000;
export const SESSION_ABSOLUTE_MS: number = 30 * 86_400_000;
/** 마지막 접속 시각을 파일에 쓰는 최소 간격 */
export const LAST_SEEN_FLUSH_MS = 60_000;
const MAX_DEVICE_NAME_LENGTH = 64;
/** 토큰 글자 수: 32바이트의 base64url */
export const TOKEN_LENGTH = 43;

export type DeviceKind = "web" | "desktop";

interface DeviceRecord {
  readonly id: string;
  readonly name: string;
  readonly kind: DeviceKind;
  /** 토큰의 SHA-256(소문자 16진) */
  readonly tokenHash: string;
  readonly createdAt: number;
  lastSeenAt: number;
  lastAddress: string;
}

/** 화면과 위로 올라가는 기기 정보. 해시도 싣지 않는다 */
export interface DeviceInfo {
  readonly id: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly lastAddress: string;
  /** 로그인이 끝나는 시각. 데스크톱 기기는 null(만료 없음) */
  readonly sessionExpiresAt: number | null;
  readonly expired: boolean;
}

export type DeviceStoreError =
  | FileError
  | { readonly kind: "corrupt"; readonly path: string; readonly reason: string };

export type VerifyError =
  | { readonly kind: "unknown_token" }
  | { readonly kind: "expired"; readonly device: DeviceInfo };

export type DeviceNameError = { readonly kind: "invalid_device_name" };

interface NewDevice {
  readonly device: DeviceInfo;
  /** 토큰 원문. 호출자가 응답으로 한 번 내보내고 버린다 */
  readonly token: string;
}

export interface DeviceStoreOptions {
  /** `devices.json`을 둘 폴더 */
  readonly dir: string;
  readonly clock: Clock;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly sessionSlidingMs?: number;
  readonly sessionAbsoluteMs?: number;
  /** 마지막 접속 시각 저장 실패처럼 응답과 무관한 쓰기 실패를 받는다(기록용) */
  readonly onBackgroundError: (error: FileError) => void;
}

export interface DeviceStore {
  add(input: {
    readonly name: string;
    readonly kind: DeviceKind;
    readonly address: string;
  }): Result<NewDevice, DeviceNameError | FileError>;
  /** 토큰을 검사하고 마지막 접속을 갱신한다(슬라이딩). 만료한 기기는 갱신하지 않는다 */
  verify(token: string, address: string): Result<DeviceInfo, VerifyError>;
  list(): readonly DeviceInfo[];
  /** 기기를 지운다. 없으면 `null` */
  revoke(id: string): Result<DeviceInfo | null, FileError>;
  revokeAll(): Result<readonly DeviceInfo[], FileError>;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 제어 문자, 서식 문자, 줄·문단 구분자(U+2028, U+2029) */
const NAME_FORBIDDEN = new RegExp(String.raw`[\p{Cc}\p{Cf}\u2028\u2029]`, "u");

/** 기기 이름을 정리한다: 앞뒤 공백 제거, 1~64글자(UTF-16 단위), 제어 문자 없음 */
export function cleanDeviceName(name: string): Result<string, DeviceNameError> {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_DEVICE_NAME_LENGTH ||
    NAME_FORBIDDEN.test(trimmed)
  ) {
    return err({ kind: "invalid_device_name" });
  }
  return ok(trimmed);
}

function isKind(value: unknown): value is DeviceKind {
  return value === "web" || value === "desktop";
}

function recordOf(value: unknown): DeviceRecord | null {
  if (!isRecord(value)) return null;
  const id = ownField(value, "id");
  const name = ownField(value, "name");
  const kind = ownField(value, "kind");
  const tokenHash = ownField(value, "tokenHash");
  const createdAt = ownField(value, "createdAt");
  const lastSeenAt = ownField(value, "lastSeenAt");
  const lastAddress = ownField(value, "lastAddress");
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    !isKind(kind) ||
    typeof tokenHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(tokenHash) ||
    !isInteger(createdAt) ||
    !isInteger(lastSeenAt) ||
    typeof lastAddress !== "string"
  ) {
    return null;
  }
  return { id, name, kind, tokenHash, createdAt, lastSeenAt, lastAddress };
}

function loadRecords(file: string): Result<DeviceRecord[], DeviceStoreError> {
  const text = readTextFile(file);
  if (!text.ok) return text;
  if (text.value === null) return ok([]);
  const json = parseJson(text.value);
  if (!json.ok) return err({ kind: "corrupt", path: file, reason: "not_json" });
  if (!isRecord(json.value) || ownField(json.value, "version") !== 1) {
    return err({ kind: "corrupt", path: file, reason: "version" });
  }
  const list = ownField(json.value, "devices");
  if (!Array.isArray(list)) return err({ kind: "corrupt", path: file, reason: "devices" });
  const records: DeviceRecord[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const record = recordOf(item);
    if (record === null || seen.has(record.id) || seen.has(record.tokenHash)) {
      return err({ kind: "corrupt", path: file, reason: "device" });
    }
    seen.add(record.id);
    seen.add(record.tokenHash);
    records.push(record);
  }
  return ok(records);
}

export function openDeviceStore(
  options: DeviceStoreOptions,
): Result<DeviceStore, DeviceStoreError> {
  const file = `${options.dir}/${DEVICES_FILE}`;
  const loaded = loadRecords(file);
  if (!loaded.ok) return loaded;
  const random = options.randomBytes ?? ((size: number): Uint8Array => nodeRandomBytes(size));
  const slidingMs = options.sessionSlidingMs ?? SESSION_SLIDING_MS;
  const absoluteMs = options.sessionAbsoluteMs ?? SESSION_ABSOLUTE_MS;

  const byId = new Map<string, DeviceRecord>(loaded.value.map((record) => [record.id, record]));
  const byHash = new Map<string, DeviceRecord>(
    loaded.value.map((record) => [record.tokenHash, record]),
  );
  let flushedAt = options.clock.now();

  function expiryOf(record: DeviceRecord): number | null {
    return record.kind === "desktop"
      ? null
      : Math.min(record.lastSeenAt + slidingMs, record.createdAt + absoluteMs);
  }

  function infoOf(record: DeviceRecord): DeviceInfo {
    const expiresAt = expiryOf(record);
    return {
      id: record.id,
      name: record.name,
      kind: record.kind,
      createdAt: record.createdAt,
      lastSeenAt: record.lastSeenAt,
      lastAddress: record.lastAddress,
      sessionExpiresAt: expiresAt,
      expired: expiresAt !== null && expiresAt <= options.clock.now(),
    };
  }

  function persist(): Result<null, FileError> {
    const devices = [...byId.values()].map((record) => ({
      id: record.id,
      name: record.name,
      kind: record.kind,
      tokenHash: record.tokenHash,
      createdAt: record.createdAt,
      lastSeenAt: record.lastSeenAt,
      lastAddress: record.lastAddress,
    }));
    const written = writeSecretFile(file, `${JSON.stringify({ version: 1, devices }, null, 2)}\n`);
    if (written.ok) flushedAt = options.clock.now();
    return written;
  }

  function remove(record: DeviceRecord): void {
    byId.delete(record.id);
    byHash.delete(record.tokenHash);
  }

  return ok({
    add(input) {
      const name = cleanDeviceName(input.name);
      if (!name.ok) return name;
      const now = options.clock.now();
      // 새 기기를 붙이는 때에 만료한 웹 기기를 정리한다(목록에서 만료 상태를 한동안 보일 수 있게 그때까지 둔다)
      const pruned = [...byId.values()].filter((record) => infoOf(record).expired);
      for (const record of pruned) remove(record);
      const token = Buffer.from(random(32)).toString("base64url");
      const record: DeviceRecord = {
        id: `dev_${Buffer.from(random(8)).toString("hex")}`,
        name: name.value,
        kind: input.kind,
        tokenHash: hashToken(token),
        createdAt: now,
        lastSeenAt: now,
        lastAddress: input.address,
      };
      byId.set(record.id, record);
      byHash.set(record.tokenHash, record);
      const saved = persist();
      if (!saved.ok) {
        remove(record);
        for (const old of pruned) {
          byId.set(old.id, old);
          byHash.set(old.tokenHash, old);
        }
        return saved;
      }
      return ok({ device: infoOf(record), token });
    },

    verify(token, address) {
      if (token.length !== TOKEN_LENGTH) return err({ kind: "unknown_token" });
      // 토큰은 256비트 무작위라 해시 조회의 시간 차이로 얻을 정보가 없다
      const record = byHash.get(hashToken(token));
      if (record === undefined) return err({ kind: "unknown_token" });
      const before = infoOf(record);
      if (before.expired) return err({ kind: "expired", device: before });
      const now = options.clock.now();
      const changedAddress = record.lastAddress !== address;
      record.lastSeenAt = now;
      record.lastAddress = address;
      if (changedAddress || now - flushedAt >= LAST_SEEN_FLUSH_MS) {
        const saved = persist();
        if (!saved.ok) options.onBackgroundError(saved.error);
      }
      return ok(infoOf(record));
    },

    list() {
      return [...byId.values()].map(infoOf);
    },

    revoke(id) {
      const record = byId.get(id);
      if (record === undefined) return ok(null);
      const info = infoOf(record);
      remove(record);
      const saved = persist();
      if (!saved.ok) {
        byId.set(record.id, record);
        byHash.set(record.tokenHash, record);
        return saved;
      }
      return ok(info);
    },

    revokeAll() {
      const all = [...byId.values()];
      const infos = all.map(infoOf);
      byId.clear();
      byHash.clear();
      const saved = persist();
      if (!saved.ok) {
        for (const record of all) {
          byId.set(record.id, record);
          byHash.set(record.tokenHash, record);
        }
        return saved;
      }
      return ok(infos);
    },
  });
}

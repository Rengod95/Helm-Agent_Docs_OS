// 웹 기기별 설정. `desktop_settings_read`, `desktop_settings_write`의 웹 판이다(L4.remote.spec §3.6, §6.1).
// 기기마다 JSON 객체 파일 하나다: `<stateDir>/remote/device-settings/<기기 id>.json`(폴더 0700, 파일 0600, 임시 파일에 쓰고 rename).
// 키 검사, 값 검사, 64 KiB 상한은 데스크톱 설정(`src/main/desktop-settings.ts`)과 같은 함수와 상수를 쓴다.
// 창 닫기와 엔진 값은 origin 데스크톱의 것이라 웹 기기에는 쓰지 않는다. 읽을 때도 뺀다.
import path from "node:path";
import { parseJson } from "@fresnel/contracts";
import { ShellError } from "../../main/commands.ts";
import {
  KEY_CLOSE_BEHAVIOR,
  KEY_RESTART_LIMIT,
  KEY_SHUTDOWN_GRACE_MS,
  MAX_SETTINGS_BYTES,
  validateEntry,
} from "../../main/desktop-settings.ts";
import { isRecord } from "../../main/lib/narrow.ts";
import { readTextFile, writeSecretFile } from "../auth/atomic-file.ts";

/** 기기 id의 모양. 경로 마디가 되므로 이 글자와 길이만 허용한다 */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
/** 웹 기기에 쓰지 않는 키. origin 데스크톱의 창과 엔진 설정이다 */
const ORIGIN_ONLY_KEYS: ReadonlySet<string> = new Set([
  KEY_CLOSE_BEHAVIOR,
  KEY_SHUTDOWN_GRACE_MS,
  KEY_RESTART_LIMIT,
]);

export interface DeviceSettingsOptions {
  /** 게이트웨이의 상태 폴더 */
  readonly stateDir: string;
  /** 기기 id(인증 기록의 `dev_…`). 글자 검사를 통과해야 파일 이름이 된다 */
  readonly deviceId: string;
}

export interface DeviceSettings {
  /** 이 기기의 설정(origin 전용 키는 뺀다). 파일이 없으면 빈 객체다 */
  read(): Readonly<Record<string, unknown>>;
  /** 키 하나를 쓴다. 다른 키는 그대로 둔다. 쓸 수 없는 키와 틀린 값은 `bad-request`다 */
  write(key: string, value: unknown): void;
}

/** 기기 하나의 설정 저장소. 기기 id가 글자 검사를 통과하지 못하면 읽기와 쓰기 모두 `bad-request`다 */
export function createDeviceSettings(options: DeviceSettingsOptions): DeviceSettings {
  return {
    read() {
      return withoutOriginOnlyKeys(readObject(fileOf(options)));
    },
    write(key, value) {
      if (ORIGIN_ONLY_KEYS.has(key)) throw new ShellError("bad-request");
      validateEntry(key, value);
      const file = fileOf(options);
      const text = JSON.stringify({ ...readObject(file), [key]: value });
      if (new TextEncoder().encode(text).byteLength > MAX_SETTINGS_BYTES) {
        throw new ShellError("too-large");
      }
      // 읽기에서 실패하면 위에서 던져 덮어쓰지 않는다(틀린 파일은 그대로 둔다)
      const written = writeSecretFile(file, text);
      if (!written.ok) throw new ShellError("storage-failed");
    },
  };
}

/** 기기 설정 파일의 경로. 기기 id가 글자 검사를 통과하지 못하면 `bad-request`다 */
function fileOf(options: DeviceSettingsOptions): string {
  if (!DEVICE_ID_PATTERN.test(options.deviceId)) throw new ShellError("bad-request");
  return path.join(options.stateDir, "remote", "device-settings", `${options.deviceId}.json`);
}

/** 설정 파일을 JSON 객체로 읽는다. 없으면 빈 객체다. 읽을 수 없거나, 상한을 넘거나, 객체가 아니면 `storage-failed`다 */
function readObject(file: string): Readonly<Record<string, unknown>> {
  const read = readTextFile(file);
  if (!read.ok) throw new ShellError("storage-failed");
  const text = read.value;
  if (text === null) return {};
  if (new TextEncoder().encode(text).byteLength > MAX_SETTINGS_BYTES) {
    throw new ShellError("storage-failed");
  }
  const parsed = parseJson(text);
  if (!parsed.ok || !isRecord(parsed.value)) throw new ShellError("storage-failed");
  return parsed.value;
}

/** 읽을 때 origin 전용 키를 뺀다. 파일을 손으로 고친 값이 있어도 웹 기기에는 보이지 않는다 */
function withoutOriginOnlyKeys(
  object: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !ORIGIN_ONLY_KEYS.has(key)));
}

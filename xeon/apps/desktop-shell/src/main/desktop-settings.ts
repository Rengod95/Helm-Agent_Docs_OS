// 데스크톱 설정 파일(desktop_settings.rs). Tauri 셸과 Electron 셸이 `<configDir>/desktop-settings.json`을 같이 읽고 쓴다.
// 시작할 때 한 번 읽는다. 값 하나가 틀리면 그 키만 기본값을 쓰고, 파일 전체가 틀리면 모두 기본값을 쓴다.
// 진단은 키 이름과 이유만 담는다(E11). 닫기 동작은 쓰기가 성공하면 바로 반영하고, 엔진 값은 다음 실행부터 반영한다.
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { assertNever, attempt, parseJson, rethrow } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { ShellContext, ShellModule } from "./context.ts";
import { appLogOf } from "./lib/applog.ts";
import { errnoCode, isInteger, isRecord, ownField } from "./lib/narrow.ts";

/** 설정 파일 이름. 두 셸이 같은 이름을 쓴다 */
export const SETTINGS_FILE_NAME = "desktop-settings.json";
/** 읽기와 쓰기 상한(바이트, 64 KiB). 넘는 파일은 통째로 기본값을 쓴다 */
export const MAX_SETTINGS_BYTES = 65_536;

export const KEY_CLOSE_BEHAVIOR = "l4.desktop.window.closeBehavior";
export const KEY_SHUTDOWN_GRACE_MS = "l4.desktop.engine.shutdownGraceMs";
export const KEY_RESTART_LIMIT = "l4.desktop.engine.restartLimit";

export interface IntRange {
  readonly min: number;
  readonly max: number;
}

/** `l4.desktop.engine.shutdownGraceMs`의 범위(spec §6) */
export const SHUTDOWN_GRACE_MS_RANGE: IntRange = { min: 1000, max: 180_000 };
/** `l4.desktop.engine.restartLimit`의 범위(spec §6) */
export const RESTART_LIMIT_RANGE: IntRange = { min: 0, max: 10 };

/** WebView가 UI 상태로 쓰는 키 앞부분. 값을 해석하지 않고 그대로 저장한다 */
const UI_KEY_PREFIXES: readonly string[] = [
  "l4.desktop.window.",
  "l4.desktop.appearance.",
  "l4.desktop.firstRun.",
  "l4.desktop.workbench.",
];

/** 창을 닫을 때의 동작. 기본값은 트레이 유지다 */
export type CloseBehavior = "quit" | "tray";

export interface DesktopSettings {
  readonly closeBehavior: CloseBehavior;
  /** 범위 안에서만 값이 있다. null이면 엔진 기본값을 쓴다 */
  readonly shutdownGraceMs: number | null;
  readonly restartLimit: number | null;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  closeBehavior: "tray",
  shutdownGraceMs: null,
  restartLimit: null,
};

export interface ParsedDesktopSettings {
  readonly settings: DesktopSettings;
  readonly diagnostics: readonly string[];
}

/** 파일을 읽을 때 나올 수 있는 상태. 오류 종류는 Rust의 `ErrorKind` 이름으로 적는다 */
type SettingsFileRead =
  | { readonly state: "missing" }
  | { readonly state: "open-failed"; readonly errorKind: string }
  | { readonly state: "read-failed"; readonly errorKind: string }
  | { readonly state: "too-large" }
  | { readonly state: "read"; readonly bytes: Uint8Array };

/** Node 오류 코드를 Rust `ErrorKind` 이름으로 옮긴다(진단 문장을 Rust와 같게 두려고). 모르는 코드는 `Other`다 */
const ERROR_KIND_NAMES: Readonly<Record<string, string>> = {
  ENOENT: "NotFound",
  EACCES: "PermissionDenied",
  EPERM: "PermissionDenied",
  EEXIST: "AlreadyExists",
  EISDIR: "IsADirectory",
  ENOTDIR: "NotADirectory",
  EROFS: "ReadOnlyFilesystem",
  EINVAL: "InvalidInput",
  ETIMEDOUT: "TimedOut",
  ENOSPC: "StorageFull",
  EFBIG: "FileTooLarge",
};

/** 설정 파일 본문을 해석한다. 진단 문장은 키 이름과 이유만 담는다 */
export function parseDesktopSettings(text: string): ParsedDesktopSettings {
  const parsed = parseJson(text);
  if (!parsed.ok) return defaultsWith("desktop settings: not valid JSON; using defaults");
  if (!isRecord(parsed.value)) {
    return defaultsWith("desktop settings: the top level is not a JSON object; using defaults");
  }
  const map = parsed.value;
  const diagnostics: string[] = [];
  const closeBehavior = readCloseBehavior(map, diagnostics);
  const shutdownGraceMs = integerInRange(
    map,
    KEY_SHUTDOWN_GRACE_MS,
    SHUTDOWN_GRACE_MS_RANGE,
    diagnostics,
  );
  const restartLimit = integerInRange(map, KEY_RESTART_LIMIT, RESTART_LIMIT_RANGE, diagnostics);
  return { settings: { closeBehavior, shutdownGraceMs, restartLimit }, diagnostics };
}

/** 파일을 읽어 해석한다. 파일이 없는 것은 오류가 아니라 기본값이다. 설정 디렉터리가 없으면 진단을 남긴다 */
export function loadDesktopSettings(dir: string | null): ParsedDesktopSettings {
  if (dir === null) {
    return defaultsWith("desktop settings: the config directory is unavailable; using defaults");
  }
  const read = readSettingsFile(dir);
  switch (read.state) {
    case "missing":
      return { settings: DEFAULT_DESKTOP_SETTINGS, diagnostics: [] };
    case "open-failed":
      return defaultsWith(
        `desktop settings: the file could not be opened (${read.errorKind}); using defaults`,
      );
    case "read-failed":
      return defaultsWith(
        `desktop settings: the file could not be read (${read.errorKind}); using defaults`,
      );
    case "too-large":
      return defaultsWith("desktop settings: the file is larger than 64 KiB; using defaults");
    case "read": {
      const text = decodeUtf8(read.bytes);
      if (text === null)
        return defaultsWith("desktop settings: the file is not UTF-8; using defaults");
      return parseDesktopSettings(text);
    }
    default:
      return assertNever(read, "loadDesktopSettings");
  }
}

/** 설정 파일을 JSON 객체로 읽는다. 파일이 없으면 빈 객체다. 크기, 인코딩, 형식이 틀리면 `storage-failed`로 거부한다 */
export function readSettingsObject(dir: string): Readonly<Record<string, unknown>> {
  const read = readSettingsFile(dir);
  if (read.state === "missing") return {};
  if (read.state !== "read") throw new ShellError("storage-failed");
  const text = decodeUtf8(read.bytes);
  if (text === null) throw new ShellError("storage-failed");
  const parsed = parseJson(text);
  if (!parsed.ok || !isRecord(parsed.value)) throw new ShellError("storage-failed");
  return parsed.value;
}

/**
 * 키 하나를 설정 파일에 쓴다. 다른 키는 그대로 둔다. 쓸 수 없는 키와 틀린 값은 `bad-request`,
 * 파일 전체가 상한을 넘으면 `too-large`, 읽기나 쓰기가 실패하면 `storage-failed`다.
 * 틀린 파일은 덮어쓰지 않는다(읽기에서 실패하면 쓰지 않는다).
 */
export function writeSettingsKey(dir: string, key: string, value: unknown): void {
  validateEntry(key, value);
  const current = readSettingsObject(dir);
  const merged: Record<string, unknown> = { ...current, [key]: value };
  const bytes = new TextEncoder().encode(JSON.stringify(sortedByKey(merged)));
  if (bytes.byteLength > MAX_SETTINGS_BYTES) throw new ShellError("too-large");
  // 동기 호출이라 읽기와 쓰기 사이에 다른 쓰기가 끼지 않는다(Rust의 WRITE_LOCK 역할)
  const written = attempt(() => {
    mkdirSync(dir, { recursive: true });
    writeAtomic(dir, bytes);
  });
  if (!written.ok) throw new ShellError("storage-failed");
}

/** 쓸 수 있는 키인지 보고, 알려진 키면 값이 `parseDesktopSettings`와 같은 범위인지 본다. 아니면 `bad-request`다 */
export function validateEntry(key: string, value: unknown): void {
  if (!isWritableEntry(key, value)) throw new ShellError("bad-request");
}

/** 쓴 키와 값이 닫기 동작을 바꾸면 그 새 동작을 돌려준다. 다른 키이거나 값이 맞지 않으면 null이다 */
export function closeBehaviorUpdate(key: string, value: unknown): CloseBehavior | null {
  return key === KEY_CLOSE_BEHAVIOR ? closeBehaviorOf(value) : null;
}

/** 설정된 닫기 동작을 실제 동작으로 바꾼다. 트레이 유지인데 트레이 아이콘이 없으면 창을 닫은 뒤 남을 곳이 없으니 끝낸다 */
export function effectiveCloseBehavior(
  configured: CloseBehavior,
  trayActive: boolean,
): CloseBehavior {
  return configured === "tray" && !trayActive ? "quit" : configured;
}

/**
 * 종료를 막을지 정한다. 막는 경우는 트레이 유지이고 창이 모두 닫혀 생긴 종료(`code`가 null)뿐이다.
 * 명시 종료와 종료 코드가 있는 종료는 막지 않는다(Electron의 `window-all-closed`에는 코드가 없다).
 */
export function shouldPreventExit(behavior: CloseBehavior, code: number | null): boolean {
  return behavior === "tray" && code === null;
}

/** 시작할 때 읽은 설정과, 쓰기가 성공할 때마다 갱신하는 닫기 동작을 가진다 */
export interface DesktopSettingsStore {
  /** 지금 셸이 쓰는 값. 닫기 동작은 쓰기가 성공하면 바뀌고, 엔진 값은 시작 때 값 그대로다 */
  current(): DesktopSettings;
  /** 시작할 때 읽으며 남은 진단 줄. 등록 때 앱 로그에 한 줄씩 남는다 */
  readonly diagnostics: readonly string[];
  /** 키 하나를 쓴다. 쓰기가 성공한 뒤에만 닫기 동작을 바꾼다 */
  write(key: string, value: unknown): void;
}

export function createDesktopSettingsStore(dir: string): DesktopSettingsStore {
  const loaded = loadDesktopSettings(dir);
  let live = loaded.settings;
  return {
    diagnostics: loaded.diagnostics,
    current: () => live,
    write(key, value) {
      const behavior = closeBehaviorUpdate(key, value);
      writeSettingsKey(dir, key, value);
      if (behavior !== null) live = { ...live, closeBehavior: behavior };
    },
  };
}

const stores = new WeakMap<ShellContext, DesktopSettingsStore>();

/** ctx마다 설정 저장소 하나. 다른 모듈이 같은 값을 읽는다 */
export function desktopSettingsStore(ctx: ShellContext): DesktopSettingsStore {
  const existing = stores.get(ctx);
  if (existing !== undefined) return existing;
  const created = createDesktopSettingsStore(ctx.paths.configDir);
  stores.set(ctx, created);
  return created;
}

export const desktopSettingsModule: ShellModule = {
  name: "desktop-settings",
  register(ctx) {
    const store = desktopSettingsStore(ctx);
    const log = appLogOf(ctx);
    for (const line of store.diagnostics) log.line(line);
    ctx.handle("desktop_settings_read", () => readSettingsObject(ctx.paths.configDir));
    ctx.handle("desktop_settings_write", (_caller, args) => {
      const key = ownField(args, "key");
      if (typeof key !== "string") throw new ShellError("bad-request");
      store.write(key, ownField(args, "value"));
      return null;
    });
  },
};

function defaultsWith(diagnostic: string): ParsedDesktopSettings {
  return { settings: DEFAULT_DESKTOP_SETTINGS, diagnostics: [diagnostic] };
}

function closeBehaviorOf(value: unknown): CloseBehavior | null {
  if (value === "quit") return "quit";
  if (value === "tray") return "tray";
  return null;
}

function readCloseBehavior(
  map: Readonly<Record<string, unknown>>,
  diagnostics: string[],
): CloseBehavior {
  if (!Object.hasOwn(map, KEY_CLOSE_BEHAVIOR)) return DEFAULT_DESKTOP_SETTINGS.closeBehavior;
  const behavior = closeBehaviorOf(map[KEY_CLOSE_BEHAVIOR]);
  if (behavior !== null) return behavior;
  diagnostics.push(skipped(KEY_CLOSE_BEHAVIOR, 'is not "quit" or "tray"'));
  return DEFAULT_DESKTOP_SETTINGS.closeBehavior;
}

function integerInRange(
  map: Readonly<Record<string, unknown>>,
  key: string,
  range: IntRange,
  diagnostics: string[],
): number | null {
  if (!Object.hasOwn(map, key)) return null;
  const value = map[key];
  if (!isInteger(value)) {
    diagnostics.push(skipped(key, "is not an integer"));
    return null;
  }
  if (!inRange(value, range)) {
    diagnostics.push(skipped(key, "is outside its range"));
    return null;
  }
  return value;
}

function inRange(value: number, range: IntRange): boolean {
  return value >= range.min && value <= range.max;
}

function isIntegerIn(value: unknown, range: IntRange): boolean {
  return isInteger(value) && inRange(value, range);
}

function isWritableEntry(key: string, value: unknown): boolean {
  if (key === KEY_CLOSE_BEHAVIOR) return closeBehaviorOf(value) !== null;
  if (key === KEY_SHUTDOWN_GRACE_MS) return isIntegerIn(value, SHUTDOWN_GRACE_MS_RANGE);
  if (key === KEY_RESTART_LIMIT) return isIntegerIn(value, RESTART_LIMIT_RANGE);
  // 알 수 없는 키는 UI 상태 키 앞부분이 맞을 때만 쓴다(값은 JSON이어야 한다)
  return UI_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) && isJsonValue(value);
}

/** JSON으로 옮길 수 있는 값인가. `undefined`, NaN, 무한대, 일반 객체가 아닌 값은 아니다 */
function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item: unknown) => isJsonValue(item));
  if (isRecord(value) && isPlainObject(value)) {
    return Object.values(value).every((item) => isJsonValue(item));
  }
  return false;
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function skipped(key: string, reason: string): string {
  return `desktop settings: ${key} ${reason}; using the default`;
}

/** 파일을 상한 + 1 바이트까지 읽어 넘었는지 본다. 읽기가 끝나면 항상 닫는다 */
function readSettingsFile(dir: string): SettingsFileRead {
  const file = path.join(dir, SETTINGS_FILE_NAME);
  const opened = attempt(() => openSync(file, "r"));
  if (!opened.ok) {
    if (errnoCode(opened.error.cause) === "ENOENT") return { state: "missing" };
    return { state: "open-failed", errorKind: errorKindOf(opened.error.cause) };
  }
  const bytes = attempt(() => readCapped(opened.value, MAX_SETTINGS_BYTES + 1));
  if (!bytes.ok) return { state: "read-failed", errorKind: errorKindOf(bytes.error.cause) };
  if (bytes.value.byteLength > MAX_SETTINGS_BYTES) return { state: "too-large" };
  return { state: "read", bytes: bytes.value };
}

function readCapped(fd: number, limit: number): Uint8Array {
  const buffer = new Uint8Array(limit);
  let total = 0;
  try {
    while (total < limit) {
      const got = readSync(fd, buffer, total, limit - total, null);
      if (got === 0) break;
      total += got;
    }
  } finally {
    closeSync(fd);
  }
  return buffer.subarray(0, total);
}

function errorKindOf(cause: unknown): string {
  const code = errnoCode(cause);
  const name = code === null ? undefined : ERROR_KIND_NAMES[code];
  return name ?? "Other";
}

/** 바이트를 UTF-8로 읽는다. BOM은 지우지 않는다(Rust `from_utf8`과 같다). 맞지 않으면 null이다 */
function decodeUtf8(bytes: Uint8Array): string | null {
  const decoded = attempt(() =>
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
  );
  return decoded.ok ? decoded.value : null;
}

/** 임시 파일에 쓰고 디스크까지 내린 뒤 이름을 바꾼다. 도중에 끊겨도 기존 파일은 온전하다 */
function writeAtomic(dir: string, bytes: Uint8Array): void {
  const temp = path.join(dir, `${SETTINGS_FILE_NAME}.tmp`);
  try {
    writeSynced(temp, bytes);
    renameSync(temp, path.join(dir, SETTINGS_FILE_NAME));
  } catch (cause) {
    rmSync(temp, { force: true });
    rethrow(cause);
  }
}

function writeSynced(file: string, bytes: Uint8Array): void {
  const fd = openSync(file, "w");
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** 키를 정렬한다. Rust 쪽 `serde_json`(기본 `Map`)이 키를 정렬해 쓰므로 두 셸의 파일 바이트가 같다 */
function sortedByKey(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(record)
      .toSorted()
      .map((key) => [key, record[key]]),
  );
}

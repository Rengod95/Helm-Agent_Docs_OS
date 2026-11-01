#!/usr/bin/env bun
// 개발 기기 일회성 이전 스크립트(rename-plan 커밋 0, §4.5). 제품 코드가 아니다: 어떤 패키지도 이 파일을 import하지 않는다.
// 제품 코드에는 옛 위치·옛 변수·옛 표식을 받는 코드가 없으므로, 개발 기기는 이 스크립트로 한 번 옮긴다.
//
//   bun scripts/migrate-dev-machine.ts              dry-run(기본): 옮길 경로, 파일 개수, 표식 값만 출력한다
//   bun scripts/migrate-dev-machine.ts --apply      실제로 옮긴다
//   bun scripts/migrate-dev-machine.ts --home <dir> [--platform linux|darwin] [--uid <n>]   다른 홈에서 시험할 때
//
// 하는 일:
//   1. 엔진·Background service·데스크톱 앱이 떠 있으면 아무것도 옮기지 않고 멈춘다(프로세스 목록, 서비스 소켓 연결).
//   2. 설정·데이터·상태·캐시 디렉터리를 `xeon` → `fresnel`로 옮긴다(시크릿 디렉터리는 설정 디렉터리 안이라 함께 간다).
//      같은 파일시스템이면 rename 한 번이고, 다르면 복사 → 개수·크기 검증 뒤에도 옛 위치는 지우지 않고 알린다.
//   3. DB 파일 `xeon.db` → `fresnel.db`(-wal, -shm, 스냅샷 `.pre-*` 포함)로 바꾸고, 표식이 옛 값(1480937294)이면 새 값(1179799116)으로 설정한다.
//      옛 값도 새 값도 아니면 건드리지 않고 알린다.
//   4. macOS이면 Tauri 앱 데이터 디렉터리 `dev.helm.xeon` → `dev.fresnel.desktop`을 옮긴다. WebView 저장소와 키체인 항목은 옮기지 않는다.
// 파일 내용과 시크릿 값은 출력하지 않는다. 종료코드: 0 통과, 1 옮기지 못한 항목 있음, 2 환경 문제(실행 중인 프로세스, 잘못된 인자).
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  closeSync,
  renameSync,
  statSync,
} from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const OLD_APPLICATION_ID = 1480937294;
export const NEW_APPLICATION_ID = 1179799116;
const OLD_NAME = "xeon";
const NEW_NAME = "fresnel";
const OLD_TAURI_ID = "dev.helm.xeon";
const NEW_TAURI_ID = "dev.fresnel.desktop";

export interface Env {
  readonly [name: string]: string | undefined;
}

export interface MigrateInput {
  readonly home: string;
  readonly platform: "linux" | "darwin";
  readonly uid: number;
  readonly env: Env;
  /** 떠 있는 옛 이름 프로세스(없으면 빈 목록). 시험에서 바꿔 끼운다 */
  readonly listProcesses: () => readonly string[];
  /** 서비스 소켓에 연결되는지. 시험에서 바꿔 끼운다 */
  readonly probeSocket: (path: string) => Promise<boolean>;
  readonly apply: boolean;
}

export interface DirMove {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

export interface DirReport {
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly status: "planned" | "moved" | "copied" | "missing" | "target_exists" | "failed";
  readonly files: number;
  readonly note?: string;
}

export interface DbReport {
  readonly path: string;
  readonly marker: number | "unreadable";
  readonly action: "rename_and_set" | "rename_only" | "unknown_marker" | "none";
  readonly done: boolean;
  readonly note?: string;
}

export interface MigrateReport {
  readonly blocked: readonly string[];
  readonly dirs: readonly DirReport[];
  readonly dbs: readonly DbReport[];
}

/** 옛 위치 목록. L0.os.spec §3.2의 플랫폼별 표와 같다(`XEON_HOME`이 있으면 그 아래 data/config/cache/state/run) */
export function planMoves(input: Pick<MigrateInput, "home" | "platform" | "env">): DirMove[] {
  const { home, platform, env } = input;
  const root = env["XEON_HOME"];
  if (root !== undefined && root !== "") {
    // 홈 지정은 디렉터리 이름이 제품 이름과 상관없다. 옮길 것이 없다
    return [];
  }
  if (platform === "darwin") {
    const support = join(home, "Library", "Application Support");
    return [
      { label: "app support", from: join(support, OLD_NAME), to: join(support, NEW_NAME) },
      {
        label: "cache",
        from: join(home, "Library", "Caches", OLD_NAME),
        to: join(home, "Library", "Caches", NEW_NAME),
      },
      {
        label: "tauri app data",
        from: join(support, OLD_TAURI_ID),
        to: join(support, NEW_TAURI_ID),
      },
    ];
  }
  const xdg = (name: string, fallback: readonly string[]): string => {
    const value = env[name];
    return value !== undefined && value.startsWith("/") ? value : join(home, ...fallback);
  };
  const config = xdg("XDG_CONFIG_HOME", [".config"]);
  const data = xdg("XDG_DATA_HOME", [".local", "share"]);
  const state = xdg("XDG_STATE_HOME", [".local", "state"]);
  const cache = xdg("XDG_CACHE_HOME", [".cache"]);
  return [
    {
      label: "config (secrets included)",
      from: join(config, OLD_NAME),
      to: join(config, NEW_NAME),
    },
    { label: "data", from: join(data, OLD_NAME), to: join(data, NEW_NAME) },
    { label: "state", from: join(state, OLD_NAME), to: join(state, NEW_NAME) },
    { label: "cache", from: join(cache, OLD_NAME), to: join(cache, NEW_NAME) },
  ];
}

/** 서비스 소켓 후보 경로(Linux $XDG_RUNTIME_DIR/xeon, macOS $TMPDIR/xeon, 폴백 /tmp/xeon-<uid>) */
export function socketCandidates(input: Pick<MigrateInput, "platform" | "env" | "uid">): string[] {
  const runtime = input.env["XDG_RUNTIME_DIR"];
  const tmpdir = input.env["TMPDIR"];
  const dirs: string[] = [];
  if (input.platform === "linux" && runtime !== undefined && runtime.startsWith("/"))
    dirs.push(join(runtime, OLD_NAME));
  if (input.platform === "darwin" && tmpdir !== undefined && tmpdir.startsWith("/"))
    dirs.push(join(tmpdir, OLD_NAME));
  dirs.push(join("/tmp", `${OLD_NAME}-${String(input.uid)}`));
  return dirs.map((dir) => join(dir, `${OLD_NAME}.sock`));
}

export function countFiles(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? countFiles(path) : 1;
  }
  return total;
}

function totalBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? totalBytes(path) : statSync(path).size;
  }
  return total;
}

function hasErrnoCode(value: unknown, code: string): boolean {
  return typeof value === "object" && value !== null && "code" in value && value.code === code;
}

function moveDir(move: DirMove, apply: boolean): DirReport {
  const base = { label: move.label, from: move.from, to: move.to };
  if (!existsSync(move.from)) return { ...base, status: "missing", files: 0 };
  const files = countFiles(move.from);
  if (existsSync(move.to)) {
    return {
      ...base,
      status: "target_exists",
      files,
      note: "target exists: nothing moved, merge by hand",
    };
  }
  if (!apply) return { ...base, status: "planned", files };
  mkdirSync(dirname(move.to), { recursive: true });
  try {
    renameSync(move.from, move.to);
    return { ...base, status: "moved", files };
  } catch (caught) {
    if (!hasErrnoCode(caught, "EXDEV")) {
      return {
        ...base,
        status: "failed",
        files,
        note: caught instanceof Error ? caught.message : "rename failed",
      };
    }
  }
  // 다른 파일시스템: 복사하고 개수·크기를 확인한다. 옛 위치는 지우지 않는다
  cpSync(move.from, move.to, { recursive: true, errorOnExist: true, preserveTimestamps: true });
  const same = countFiles(move.to) === files && totalBytes(move.to) === totalBytes(move.from);
  return same
    ? {
        ...base,
        status: "copied",
        files,
        note: "copied across file systems; the old directory is kept, delete it by hand",
      }
    : {
        ...base,
        status: "failed",
        files,
        note: "copy verification failed; the old directory is untouched",
      };
}

/** SQLite 헤더 68바이트(application_id)를 읽는다. 열지 않으므로 WAL에 쓰지 않는다 */
export function readMarker(path: string): number | "unreadable" {
  if (!existsSync(path)) return "unreadable";
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(100);
    const read = readSync(fd, header, 0, 100, 0);
    if (read < 100 || header.subarray(0, 15).toString("latin1") !== "SQLite format 3")
      return "unreadable";
    return header.readUInt32BE(68);
  } finally {
    closeSync(fd);
  }
}

function dbFamily(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(
    (name) =>
      name === `${OLD_NAME}.db` ||
      name.startsWith(`${OLD_NAME}.db-`) ||
      name.startsWith(`${OLD_NAME}.db.pre-`),
  );
}

/**
 * 저장된 settings.changed의 범위 이름 session을 launch로 옮긴다. 앱은 옛 이름을 읽지 않으므로, 옮기지 않으면
 * 대화별 설정(권한 모드 등)이 조용히 무시된다. events는 불변 트리거가 지키므로 한 트랜잭션 안에서 잠깐 내린다.
 */
function rewriteSettingScope(db: Database): void {
  const trigger = db
    .query<{ sql: string }, []>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'events_no_update'",
    )
    .get();
  if (trigger === null) return;
  db.transaction(() => {
    db.run("DROP TRIGGER events_no_update");
    db.run(
      "UPDATE events SET envelope = json_set(envelope, '$.payload.scope', 'launch') WHERE kind = 'settings.changed' AND json_extract(envelope, '$.payload.scope') = 'session'",
    );
    db.run(trigger.sql);
  })();
}

function migrateDb(dataDir: string, apply: boolean): DbReport[] {
  const names = dbFamily(dataDir);
  if (!names.includes(`${OLD_NAME}.db`)) return [];
  const oldPath = join(dataDir, `${OLD_NAME}.db`);
  const newPath = join(dataDir, `${NEW_NAME}.db`);
  const marker = readMarker(oldPath);
  if (existsSync(newPath)) {
    return [
      {
        path: oldPath,
        marker,
        action: "none",
        done: false,
        note: `${NEW_NAME}.db exists: nothing changed`,
      },
    ];
  }
  if (marker !== OLD_APPLICATION_ID && marker !== NEW_APPLICATION_ID && marker !== 0) {
    return [
      {
        path: oldPath,
        marker,
        action: "unknown_marker",
        done: false,
        note: "marker is neither old nor new: not touched",
      },
    ];
  }
  const action = marker === OLD_APPLICATION_ID ? "rename_and_set" : "rename_only";
  if (!apply) return [{ path: oldPath, marker, action, done: false }];
  for (const name of names) {
    renameSync(
      join(dataDir, name),
      join(dataDir, name.replace(`${OLD_NAME}.db`, `${NEW_NAME}.db`)),
    );
  }
  const db = new Database(newPath);
  try {
    if (action === "rename_and_set") {
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      db.run(`PRAGMA application_id = ${String(NEW_APPLICATION_ID)}`);
    }
    rewriteSettingScope(db);
  } finally {
    db.close();
  }
  if (action === "rename_and_set") {
    const after = readMarker(newPath);
    if (after !== NEW_APPLICATION_ID) {
      return [
        { path: newPath, marker: after, action, done: false, note: "marker was not written" },
      ];
    }
  }
  return [{ path: newPath, marker, action, done: true }];
}

export async function migrate(input: MigrateInput): Promise<MigrateReport> {
  const blocked: string[] = [];
  for (const line of input.listProcesses()) blocked.push(`process: ${line}`);
  const sockets = socketCandidates(input).filter((socket) => existsSync(socket));
  const answers = await Promise.all(sockets.map((socket) => input.probeSocket(socket)));
  sockets.forEach((socket, index) => {
    if (answers[index] === true) blocked.push(`service socket answers: ${socket}`);
  });
  const moves = planMoves(input);
  if (blocked.length > 0) {
    return {
      blocked,
      dirs: moves.map((move) => ({
        ...move,
        status: "planned",
        files: existsSync(move.from) ? countFiles(move.from) : 0,
      })),
      dbs: [],
    };
  }
  const dirs = moves.map((move) => moveDir(move, input.apply));
  // DB는 data 디렉터리(Linux) 또는 app support(macOS)에 있다. 이미 옮긴 뒤의 새 위치를 본다. dry-run이면 옛 위치를 본다
  const dataMove = moves.find((move) => move.label === "data" || move.label === "app support");
  const dbs: DbReport[] = [];
  if (dataMove !== undefined) {
    const moved = dirs.find((dir) => dir.label === dataMove.label);
    const where =
      input.apply && (moved?.status === "moved" || moved?.status === "copied")
        ? dataMove.to
        : dataMove.from;
    dbs.push(...migrateDb(where, input.apply));
  }
  return { blocked, dirs, dbs };
}

/** 옛 이름 프로세스 목록. `xeon`, `xeon-engine`, `Xeon` 실행 파일 이름만 본다(이 스크립트 자신은 제외) */
export function listOldProcesses(): string[] {
  const result = spawnSync("ps", ["-eo", "pid=,comm="], { encoding: "utf8" });
  if (result.status !== 0) return [];
  const names = new Set([OLD_NAME, `${OLD_NAME}-engine`, "Xeon"]);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .filter((line) => {
      const [pid, ...rest] = line.split(/\s+/);
      return pid !== String(process.pid) && names.has(basename(rest.join(" ")));
    });
}

export function probeUnixSocket(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const done = (alive: boolean): void => {
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(1000, () => {
      done(false);
    });
    socket.once("connect", () => {
      done(true);
    });
    socket.once("error", () => {
      done(false);
    });
  });
}

export function formatReport(report: MigrateReport, apply: boolean): string[] {
  const lines: string[] = [];
  lines.push(apply ? "mode: apply" : "mode: dry-run (use --apply to move)");
  for (const reason of report.blocked) lines.push(`BLOCKED ${reason}`);
  for (const dir of report.dirs) {
    lines.push(
      `${dir.status.padEnd(13)} ${dir.label}: ${dir.from} -> ${dir.to} (${String(dir.files)} files)${dir.note === undefined ? "" : ` [${dir.note}]`}`,
    );
  }
  for (const db of report.dbs) {
    lines.push(
      `db ${db.action.padEnd(14)} ${db.path} marker=${String(db.marker)} -> ${db.action === "rename_and_set" ? String(NEW_APPLICATION_ID) : String(db.marker)}${db.done ? " (done)" : ""}${db.note === undefined ? "" : ` [${db.note}]`}`,
    );
  }
  return lines;
}

function parseArgs(
  argv: readonly string[],
): { apply: boolean; home: string; platform: "linux" | "darwin"; uid: number } | string {
  let apply = false;
  let home = homedir();
  let platform: "linux" | "darwin" = process.platform === "darwin" ? "darwin" : "linux";
  let uid = process.getuid?.() ?? 0;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--home" && next !== undefined) {
      home = next;
      i += 1;
    } else if (arg === "--platform" && (next === "linux" || next === "darwin")) {
      platform = next;
      i += 1;
    } else if (arg === "--uid" && next !== undefined && Number.isInteger(Number(next))) {
      uid = Number(next);
      i += 1;
    } else return `unknown argument ${String(arg)}`;
  }
  return { apply, home, platform, uid };
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === "string") {
    console.error(args);
    return 2;
  }
  const report = await migrate({
    ...args,
    env: process.env,
    listProcesses: listOldProcesses,
    probeSocket: probeUnixSocket,
  });
  for (const line of formatReport(report, args.apply)) console.log(line);
  if (report.blocked.length > 0) {
    console.error(
      "stop: close the app, the engine and the background service first; nothing was moved",
    );
    return 2;
  }
  const failed =
    report.dirs.some((dir) => dir.status === "failed" || dir.status === "target_exists") ||
    report.dbs.some((db) => db.action === "unknown_marker" || (db.note !== undefined && !db.done));
  return failed ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));

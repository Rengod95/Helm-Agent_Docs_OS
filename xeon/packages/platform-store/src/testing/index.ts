import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bug, type Clock, type Scheduler } from "@xeon/contracts";
import type { IdFactory } from "@xeon/contracts/conversation";
import type { FaultInjector, StoreDb, StoreService } from "@xeon/contracts/records";
import { sha256Hex } from "../hash.ts";
import { openStore } from "../open.ts";
import { toStorePlatform } from "../select.ts";
import { DEFAULT_STORE_SETTINGS } from "../settings.ts";
import type { SqliteProbe } from "../sqlite-env.ts";
import type { OpenedStore, StoreEnvironment, StoreSettings } from "../types.ts";
import type { StoreFaultInjector } from "../fault-points.ts";

export {
  faultAt,
  storeFaultAt,
  STORE_FAULT_POINTS,
  NO_STORE_FAULTS,
  type ArmedFault,
  type StoreFaultInjector,
  type StoreFaultPoint,
} from "./fault.ts";

export interface TestStoreOptions {
  /** 생략하면 임시 디렉터리 안 파일이다(WAL, 읽기 연결, 잠금, 블롭이 모두 파일을 쓰므로 :memory:를 쓰지 않는다) */
  readonly path?: string;
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** core-persistence 쓰기 경로에 넘길 F 장애 주입기 */
  readonly faults?: FaultInjector;
  /** 이 패키지 안(블롭, 임대, 마이그레이션)의 장애 주입기 */
  readonly storeFaults?: StoreFaultInjector;
  /** 생략하면 아무 것도 하지 않는 타이머다. keepAlive를 시험하려면 manualClock을 넘긴다 */
  readonly scheduler?: Scheduler;
  readonly settings?: Partial<StoreSettings>;
  readonly env?: Partial<StoreEnvironment>;
  readonly strictPrefix?: boolean;
  readonly probe?: () => SqliteProbe;
  readonly engineVersion?: string;
}

/** 실제 저장소 핸들 + 시험용 조회(eng.testing.guide TS-07) */
export interface TestStore extends AsyncDisposable {
  readonly path: string;
  readonly opened: OpenedStore;
  readonly service: StoreService;
  readonly root: StoreDb;
  readonly faults: FaultInjector;
  /** 테이블마다 행 수. sqlite_ 내부 테이블은 뺀다 */
  rowCounts(): Promise<Readonly<Record<string, number>>>;
  /** 테이블마다 행 내용의 해시(행 순서와 무관). 장애 주입 전후 비교에 쓴다 */
  rowDigests(): Promise<Readonly<Record<string, string>>>;
}

const INERT_SCHEDULER: Scheduler = {
  setTimeout: (): number => 0,
  clearTimeout: (): void => {},
};

function testEnvironment(override: Partial<StoreEnvironment> | undefined): StoreEnvironment {
  const platform = toStorePlatform(process.platform);
  if (platform === undefined) throw new Bug("store.testing: unsupported platform");
  return {
    platform,
    wsl: false,
    dbDirFsKind: "local",
    bundledSqlitePath: null,
    machineId: "test-machine",
    processStartedAt: (): number | null => null,
    ...override,
  };
}

function cellText(value: unknown): string {
  if (value instanceof Uint8Array) return `x'${Buffer.from(value).toString("hex")}'`;
  if (typeof value === "bigint") return `${value}n`;
  return JSON.stringify(value);
}

/** 실제 bun:sqlite 파일로 저장소를 연다. 닫을 때 직접 만든 임시 디렉터리를 지운다 */
export async function openTestStore(options: TestStoreOptions): Promise<TestStore> {
  const ownedDir = options.path === undefined ? mkdtempSync(join(tmpdir(), "xeon-store-")) : null;
  const path = options.path ?? join(ownedDir ?? "", "xeon.db");
  const opened = await openStore({
    dbPath: path,
    env: testEnvironment(options.env),
    clock: options.clock,
    scheduler: options.scheduler ?? INERT_SCHEDULER,
    ids: options.ids,
    settings: { ...DEFAULT_STORE_SETTINGS, ...options.settings },
    engineVersion: options.engineVersion ?? "0.0.0-test",
    ...(options.faults === undefined ? {} : { faults: options.faults }),
    ...(options.storeFaults === undefined ? {} : { storeFaults: options.storeFaults }),
    ...(options.strictPrefix === undefined ? {} : { strictPrefix: options.strictPrefix }),
    ...(options.probe === undefined ? {} : { probe: options.probe }),
  });
  if (!opened.ok) {
    if (ownedDir !== null) rmSync(ownedDir, { recursive: true, force: true });
    throw new Bug(`store.testing: openStore failed with ${opened.error.kind}`, {
      cause: opened.error,
    });
  }
  const store = opened.value;

  const tableNames = (): readonly string[] => {
    const rows = store.root.read((tx) =>
      tx.all(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      ),
    );
    if (!rows.ok) throw new Bug("store.testing: cannot list tables", { cause: rows.error });
    return rows.value.map((row) => String(row["name"]));
  };

  return {
    path,
    opened: store,
    service: store.service,
    root: store.root,
    faults: store.faults,
    rowCounts(): Promise<Readonly<Record<string, number>>> {
      const counts: Record<string, number> = {};
      for (const name of tableNames()) {
        const result = store.root.read((tx) => tx.get(`SELECT count(*) AS n FROM "${name}"`));
        if (!result.ok) throw new Bug("store.testing: count failed", { cause: result.error });
        counts[name] = Number(result.value?.["n"] ?? 0);
      }
      return Promise.resolve(counts);
    },
    rowDigests(): Promise<Readonly<Record<string, string>>> {
      const digests: Record<string, string> = {};
      for (const name of tableNames()) {
        const result = store.root.read((tx) => tx.all(`SELECT * FROM "${name}"`));
        if (!result.ok) throw new Bug("store.testing: digest failed", { cause: result.error });
        const lines = result.value
          .map((row) =>
            Object.entries(row)
              .map(([key, value]) => `${key}=${cellText(value)}`)
              .join("|"),
          )
          .toSorted();
        digests[name] = sha256Hex(lines.join("\n"));
      }
      return Promise.resolve(digests);
    },
    async [Symbol.asyncDispose](): Promise<void> {
      await store.close();
      if (ownedDir !== null) rmSync(ownedDir, { recursive: true, force: true });
    },
  };
}

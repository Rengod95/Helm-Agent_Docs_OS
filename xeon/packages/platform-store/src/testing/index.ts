import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bug, type Clock, type Scheduler } from "@xeon/contracts";
import type { IdFactory } from "@xeon/contracts/conversation";
import type {
  FaultInjector,
  LeaseHolder,
  LeaseResource,
  LeaseService,
  LeaseToken,
  StoreDb,
  StoreService,
} from "@xeon/contracts/records";
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

/** 다른 엔진 인스턴스를 흉내 내는 임대 보유자 둘. core-persistence 등 소비자 시험이 쓴다 */
export const TEST_HOLDER_A: LeaseHolder = {
  holderId: "holder-a",
  kind: "cli",
  pid: 1001,
  startedAt: 1_767_571_200_000,
  host: "test-host",
};

export const TEST_HOLDER_B: LeaseHolder = {
  holderId: "holder-b",
  kind: "cli",
  pid: 1002,
  startedAt: 1_767_571_200_000,
  host: "test-host",
};

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
  /**
   * `service.leases`와 같은 동작이되 `keepAlive`의 `onLost`를 붙잡는다. `loseLease`가 부르려면 소비자가 이 핸들로 `keepAlive`를 건다.
   * 나머지 메서드는 실제 구현 그대로다.
   */
  readonly leases: LeaseService;
  /**
   * 다른 엔진 인스턴스가 임대를 인수한 상황(epoch + 1)을 만든다. OS 잠금은 건드리지 않는다.
   * 이전 토큰으로 하는 커밋은 ownership_lost여야 한다.
   */
  takeover(resource: LeaseResource, holder: LeaseHolder): LeaseToken;
  /** `leases.keepAlive`로 건 `onLost`를 한 번 부른다. 하트비트가 임대를 잃었다고 알리는 상황 */
  loseLease(resource: LeaseResource): void;
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

  // keepAlive의 onLost를 시험이 직접 부를 수 있게 붙잡는다. 나머지 임대 동작은 실제 구현 그대로다
  const lostCallbacks = new Map<LeaseResource, () => void>();
  const leases: LeaseService = {
    ...store.service.leases,
    keepAlive(token, onLost): Disposable {
      lostCallbacks.set(token.resource, () => {
        onLost(token.resource);
      });
      const inner = store.service.leases.keepAlive(token, onLost);
      return {
        [Symbol.dispose]: () => {
          lostCallbacks.delete(token.resource);
          inner[Symbol.dispose]();
        },
      };
    },
  };

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
    leases,
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
    takeover(resource, holder): LeaseToken {
      const written = store.root.write((tx): number => {
        const row = tx.get("SELECT epoch FROM sys_leases WHERE resource = ?", [resource]);
        const epoch = row === undefined ? 1 : Number(row["epoch"]) + 1;
        const now = options.clock.now();
        const params = [
          holder.holderId,
          epoch,
          holder.kind,
          holder.pid,
          holder.startedAt,
          holder.host,
          now,
          now + 30_000,
        ];
        if (row === undefined) {
          tx.run(
            `INSERT INTO sys_leases (resource, holder_id, epoch, kind, pid, started_at, host, heartbeat_at, expires_at, released_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [resource, ...params],
          );
        } else {
          tx.run(
            `UPDATE sys_leases SET holder_id = ?, epoch = ?, kind = ?, pid = ?, started_at = ?, host = ?,
               heartbeat_at = ?, expires_at = ?, released_at = NULL WHERE resource = ?`,
            [...params, resource],
          );
        }
        return epoch;
      });
      if (!written.ok) throw new Bug("store.testing: takeover failed", { cause: written.error });
      return { resource, holderId: holder.holderId, epoch: written.value };
    },
    loseLease(resource): void {
      lostCallbacks.get(resource)?.();
    },
    async [Symbol.asyncDispose](): Promise<void> {
      await store.close();
      if (ownedDir !== null) rmSync(ownedDir, { recursive: true, force: true });
    },
  };
}

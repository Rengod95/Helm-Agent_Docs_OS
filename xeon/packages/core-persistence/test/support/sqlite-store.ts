// 시험용 L0 저장소. platform-store의 실제 저장소(`@xeon/platform-store/testing`)를 열고, 이 패키지 시험이 쓰는 모양
// (raw 검사 연결, 동기 rowCounts·tableHashes, takeover·loseLease가 붙은 leases)으로 감싼다(open-issues M-04).
import { Database } from "bun:sqlite";
import { Bug, canonicalJson } from "@xeon/contracts";
import type {
  LeaseHolder,
  LeaseResource,
  LeaseService,
  LeaseToken,
  MigrationRunner,
  StoreDb,
  StoreService,
} from "@xeon/contracts/records";
import {
  openTestStore as openPlatformStore,
  TEST_HOLDER_A,
  TEST_HOLDER_B,
  type TestStore as PlatformTestStore,
} from "@xeon/platform-store/testing";
import { sha256Hex } from "../../src/hash.ts";
import { fixedIdFactory, type ManualClock } from "./clock.ts";

export { TEST_HOLDER_A, TEST_HOLDER_B };

interface TestLeases extends LeaseService {
  /** 다른 홀더가 임대를 인수한 상황(epoch + 1). 이전 토큰으로 하는 커밋은 ownership_lost여야 한다 */
  takeover(resource: LeaseResource, holder: LeaseHolder): LeaseToken;
  /** keepAlive가 임대를 잃었다고 알리는 상황 */
  loseLease(resource: LeaseResource): void;
}

export interface TestStore {
  /** 검사용 두 번째 연결. 저장소 핸들(db)과 같은 파일을 본다. 시험이 SQL을 직접 읽고 쓸 때 쓴다 */
  readonly raw: Database;
  readonly db: StoreDb;
  readonly leases: TestLeases;
  readonly migrations: MigrationRunner;
  /** 실제 저장소 서비스(blob, 확장 테이블 포함) */
  readonly service: StoreService;
  /** 사용자 테이블(sqlite_ 제외)의 행 수 */
  rowCounts(): Readonly<Record<string, number>>;
  /** 사용자 테이블마다 기본 키 정렬 행 해시(행 수와 내용이 같음을 대조한다) */
  tableHashes(): Readonly<Record<string, string>>;
  close(): Promise<void>;
}

export interface TestStoreOptions {
  /** 생략하면 임시 디렉터리 안 파일 */
  readonly path?: string;
  readonly clock: ManualClock;
}

const opened = new Set<TestStore>();

/** 이 시험 파일에서 연 저장소를 모두 닫는다. harness가 afterEach에 건다 */
export async function closeOpenedStores(): Promise<void> {
  const all = [...opened];
  opened.clear();
  await Promise.all(all.map((store) => store.close()));
}

export async function openTestStore(options: TestStoreOptions): Promise<TestStore> {
  const inner: PlatformTestStore = await openPlatformStore({
    clock: options.clock,
    scheduler: options.clock,
    // 저장소 id가 시험의 id 열과 섞이지 않게 다른 seed를 쓴다
    ids: fixedIdFactory(9_000_000),
    ...(options.path === undefined ? {} : { path: options.path }),
  });
  const raw = new Database(inner.path);
  raw.run("PRAGMA busy_timeout = 5000");
  const leases: TestLeases = {
    ...inner.leases,
    takeover: (resource, holder) => inner.takeover(resource, holder),
    loseLease: (resource) => {
      inner.loseLease(resource);
    },
  };

  const userTables = (): readonly string[] => {
    const rows = inner.root.read((tx) =>
      tx.all(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      ),
    );
    if (!rows.ok) throw new Bug("test store: cannot list tables", { cause: rows.error });
    return rows.value.map((row) => String(row["name"]));
  };

  const store: TestStore = {
    raw,
    db: inner.root,
    leases,
    migrations: inner.service.migrations,
    service: inner.service,
    rowCounts() {
      const counts: Record<string, number> = {};
      for (const table of userTables()) {
        const read = inner.root.read((tx) => tx.get(`SELECT COUNT(*) AS n FROM "${table}"`));
        if (!read.ok) throw new Bug("test store: count failed", { cause: read.error });
        counts[table] = Number(read.value?.["n"] ?? 0);
      }
      return counts;
    },
    tableHashes() {
      const hashes: Record<string, string> = {};
      for (const table of userTables()) {
        const read = inner.root.read((tx) => {
          const columns = tx
            .all(`SELECT name FROM pragma_table_info('${table}')`)
            .map((row) => `"${String(row["name"])}"`)
            .join(", ");
          return tx.all(`SELECT * FROM "${table}" ORDER BY ${columns}`);
        });
        if (!read.ok) throw new Bug("test store: digest failed", { cause: read.error });
        hashes[table] = sha256Hex(canonicalJson(read.value));
      }
      return hashes;
    },
    async close(): Promise<void> {
      opened.delete(store);
      raw.close();
      await inner[Symbol.asyncDispose]();
    },
  };
  opened.add(store);
  return store;
}

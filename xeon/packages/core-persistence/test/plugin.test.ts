import { expect, test } from "bun:test";
import { err } from "@xeon/contracts";
import { ProjectorRegistryPortKey, RecordCommitPortKey } from "@xeon/contracts/extensions";
import {
  SessionServiceName,
  StoreServiceName,
  type MigrationRunner,
  type SessionService,
  type StoreService,
} from "@xeon/contracts/records";
import { createTestHost } from "@xeon/ext-host/testing";
import { sessionPlugin } from "../src/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { openTestStore, TEST_HOLDER_A, type TestStore } from "./support/sqlite-store.ts";

function storeService(
  store: TestStore,
  migrations: MigrationRunner = store.migrations,
): StoreService {
  return {
    storeId: "sto_00000000000000000000000001",
    capabilities: {
      fts5: false,
      sqliteVersion: "test",
      customSqlitePath: null,
      lockProvider: "none",
    },
    scoped: () => store.db,
    migrations,
    extensions: {
      register: () => err({ kind: "busy" }),
      drop: () => err({ kind: "busy" }),
    },
    leases: store.leases,
    putBlob: () => err({ kind: "disk_full" }),
    readBlob: () => err({ kind: "disk_full" }),
    pinBlob: () => err({ kind: "disk_full" }),
    unpinBlob: () => err({ kind: "disk_full" }),
  };
}

async function installed(migrations?: (store: TestStore) => MigrationRunner) {
  const clock = manualClock();
  const store = await openTestStore({ clock });
  // 테스트 호스트의 기본 기록 포트(메모리)는 끈다: xeon.session의 ext 속성이 그 자리를 채운다
  const host = await createTestHost({ without: ["records"] });
  const service = storeService(store, migrations?.(store));
  await host.host.registerPlatform({
    name: "test-store",
    setup(ctx) {
      ctx.providePort({ name: StoreServiceName }, service);
    },
  });
  const result = await host.host.install(
    sessionPlugin({ db: store.db, clock, ids: fixedIdFactory(), holder: TEST_HOLDER_A }),
  );
  return { host, store, result };
}

test("the plugin provides xeon.session, whose ext and projectors members are the X ports", async () => {
  const { host, result } = await installed();
  expect(result.setups.map((setup) => setup.status)).toEqual(["applied"]);
  const session = host.host.ports.get<SessionService>({ name: SessionServiceName });
  expect(session).toBeDefined();
  expect(host.host.ports.get(RecordCommitPortKey)).toBe(session?.ext);
  expect(host.host.ports.get(ProjectorRegistryPortKey)).toBe(session?.projectors);
  const threadId = host.newThread();
  expect(session?.threads.create({ threadId }).ok).toBe(true);
});

test("a failing migration fails the setup instead of leaving a half-started service", async () => {
  const { host, result } = await installed(() => ({
    apply: () => err({ kind: "busy" }),
    runChunked: () => Promise.reject(new Error("unused")),
  }));
  expect(result.setups.map((setup) => setup.status)).toEqual(["failed"]);
  expect(host.host.ports.get<SessionService>({ name: SessionServiceName })).toBeUndefined();
});

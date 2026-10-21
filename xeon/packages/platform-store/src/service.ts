import { Bug, type Result } from "@xeon/contracts";
import { ScopedStorePortKey } from "@xeon/contracts/extensions";
import type {
  BlobError,
  BlobRef,
  ExtensionTables,
  LeaseService,
  MigrationRunner,
  StoreCapabilities,
  StoreDb,
  StoreService,
} from "@xeon/contracts/records";
import type { PlatformContext, PlatformModule } from "@xeon/ext-host";
import type { BlobStore } from "./blob.ts";
import { createStoreDb, type StoreConnections } from "./db.ts";
import { readOwnerSpec } from "./owner-table.ts";
import { createStatementGuard, isRootOnlyOwner } from "./prefix.ts";
import type { OpenedStore } from "./types.ts";

/** scoped(owner) 구현. sys와 core.persistence는 루트 핸들만 쓴다. 등록되지 않은 소유자는 Bug다 */
export function createScopedFactory(
  conn: StoreConnections,
  strict: boolean,
): (owner: string) => StoreDb {
  return (owner: string): StoreDb => {
    if (conn.state.phase !== "open") throw new Bug("store.closed: the store is closed");
    if (isRootOnlyOwner(owner)) {
      throw new Bug(`store.prefix_not_owned: ${owner} has no scoped handle (root handle only)`);
    }
    const spec = readOwnerSpec(conn.write, owner);
    if (spec === undefined) {
      throw new Bug(`store.prefix_not_owned: ${owner} is not registered in sys_prefixes`);
    }
    return createStoreDb(conn, { guard: createStatementGuard({ spec, strict, allowDdl: false }) });
  };
}

export interface StoreServiceParts {
  readonly storeId: string;
  readonly capabilities: StoreCapabilities;
  readonly scoped: (owner: string) => StoreDb;
  readonly migrations: MigrationRunner;
  readonly extensions: ExtensionTables;
  readonly leases: LeaseService;
  readonly blobs: BlobStore;
}

/** F StoreService 구현(L0.store.spec §3.1). X 포트 ScopedStorePort(Pick<StoreService, "scoped">)를 그대로 만족한다 */
export function assembleStoreService(parts: StoreServiceParts): StoreService {
  return {
    storeId: parts.storeId,
    capabilities: parts.capabilities,
    scoped: parts.scoped,
    migrations: parts.migrations,
    extensions: parts.extensions,
    leases: parts.leases,
    putBlob(bytes: Uint8Array, mediaType: string | null): Result<BlobRef, BlobError> {
      return parts.blobs.putBlob(bytes, mediaType);
    },
    readBlob(ref: BlobRef): Result<Uint8Array, BlobError> {
      return parts.blobs.readBlob(ref);
    },
  };
}

/**
 * Cordis 서비스 xeon.store 등록 단위. 조립 루트가 ExtHost.registerPlatform으로 등록한다.
 * 서비스 이름 하나에 인터페이스는 StoreService 하나이고 X 포트 ScopedStorePort는 그 부분형이다(X.primitives.spec §3.6).
 * 호스트가 내려가면 close()로 임대를 반납하고 연결을 닫는다.
 */
export function storePlugin(opened: OpenedStore): PlatformModule {
  return {
    name: "platform-store",
    setup(ctx: PlatformContext): void {
      ctx.providePort(ScopedStorePortKey, opened.service);
      ctx.onDispose(() => opened.close());
    },
  };
}

// 서비스 xeon.session의 등록 단위(L1.persistence.plan PS-16). ext-host의 내장 확장으로 올리고, 이 패키지는 Cordis를
// import하지 않는다(DR-11). 서비스 등록은 hostOf(g).providePort로 한다.
import { err, ok, type Clock, type Logger } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import {
  defineManifest,
  type ExtensionEntry,
  type ExtensionManifest,
} from "@xeon/contracts/extensions";
import type {
  EventKindRegistry,
  FaultInjector,
  LeaseHolder,
  StoreDb,
} from "@xeon/contracts/records";
import { SessionPortKey, StoreServicePortKey } from "@xeon/contracts/services";
import { hostOf, type ExtensionUnit } from "@xeon/ext-host";
import type { PersistenceSettings } from "./deps.ts";
import { createSessionService } from "./service.ts";

export const SESSION_EXTENSION_NAME = "core-persistence";

export interface SessionPluginOptions {
  /**
   * 세션 테이블에 쓸 수 있는 루트 StoreDb. 조립 루트(L4 host)가 platform-store에서 얻어 이 패키지에만 넘긴다
   * (eng.transactions.design §4.2). xeon.store 서비스는 임대·마이그레이션·blob 읽기를 준다
   */
  readonly db: StoreDb;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger?: Logger;
  readonly faults?: FaultInjector;
  readonly eventKinds?: EventKindRegistry;
  readonly settings?: () => PersistenceSettings;
  /** 이 엔진 인스턴스의 임대 홀더. 자식 thread 생성(`inheritOwnerFrom`)에 필요하다 */
  readonly holder?: LeaseHolder;
  readonly onLeaseLost?: (threadId: ThreadId) => void;
  readonly loadIndex?: number;
}

export function sessionManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 1,
    name: SESSION_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Session persistence",
    description: "Event log, projections, step checkpoints and recovery for threads (L1).",
    defaultEnabled: true,
    layer: "L1",
    kind: "plugin",
    entry: "./src/index.ts",
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}

/**
 * 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다. xeon.store 포트를 먼저 등록해 두어야 한다.
 * setup이 실패하면(마이그레이션 오류 등) err(SetupRefusal)을 돌려준다: 시작 실패는 install 결과의 setups[].failure로 나온다(X.primitives.spec §3.2)
 */
export function sessionPlugin(options: SessionPluginOptions): ExtensionUnit {
  const manifest = sessionManifest();
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const store = host.port(StoreServicePortKey);
      const created = createSessionService({
        db: options.db,
        leases: store.leases,
        migrations: store.migrations,
        readBlob: (ref) => store.readBlob(ref),
        putBlob: (bytes, mediaType) => store.putBlob(bytes, mediaType),
        clock: options.clock,
        ids: options.ids,
        ...(options.logger === undefined ? {} : { logger: options.logger }),
        ...(options.faults === undefined ? {} : { faults: options.faults }),
        ...(options.eventKinds === undefined ? {} : { eventKinds: options.eventKinds }),
        ...(options.settings === undefined ? {} : { settings: options.settings }),
        ...(options.holder === undefined ? {} : { holder: options.holder }),
        ...(options.onLeaseLost === undefined ? {} : { onLeaseLost: options.onLeaseLost }),
      });
      if (!created.ok) return err({ reason: created.error.kind, cause: created.error });
      host.providePort(SessionPortKey, created.value);
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}

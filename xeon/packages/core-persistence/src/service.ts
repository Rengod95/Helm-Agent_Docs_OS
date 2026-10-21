// Cordis 서비스 xeon.session(SessionService)의 조립(L1.persistence.spec §3.3). 조립 루트가 deps를 넘긴다.
import { Bug, err, ok, type Result } from "@xeon/contracts";
import type {
  ExtCommitResult,
  ExtThreadSnapshot,
  MigrationError,
  ProducerHandle,
  ProducerId,
  Projector,
  ProjectorFailure,
  ProjectorRegistry,
  SessionService,
  SessionSettingsLayer,
  SessionSettingsStore,
  StoreError,
  Unsubscribe,
} from "@xeon/contracts/records";
import {
  DEFAULT_PERSISTENCE_SETTINGS,
  type PersistenceSettings,
  type SessionDeps,
} from "./deps.ts";
import { createLifecycle } from "./lifecycle.ts";
import { createGuardState, createOpenSessions } from "./ownership.ts";
import { createProducerRegistry } from "./producers.ts";
import { createCoreProjector } from "./projector/core.ts";
import { ensureProjectors } from "./projector/rebuild.ts";
import { createProjectionQuery } from "./query.ts";
import { createReader } from "./read.ts";
import { createResumer } from "./resume.ts";
import { SESSION_MIGRATION_SET } from "./schema/migrations.ts";
import { createFeed } from "./subscribe.ts";
import { createKindCatalog } from "./upcast.ts";
import { createSessionWriter } from "./writer.ts";

/** 시작 실패: 비투영 테이블 마이그레이션 오류, 또는 투영 재생성 중 저장소 오류 */
export type SessionStartError =
  | { readonly kind: "migration"; readonly error: MigrationError }
  | { readonly kind: "store"; readonly error: StoreError };

function notYet(member: string, plan: string): never {
  throw new Bug(`session.not_implemented: ${member} arrives with ${plan}`);
}

/** 확장 투영기 등록(PS-4)은 M2다. list는 코어 투영기만 보여 준다 */
function createProjectorRegistry(core: Projector): ProjectorRegistry {
  return {
    register: () => notYet("projectors.register", "M2 (PS-4)"),
    list: () => [{ name: core.name, version: core.version, tables: core.tables }],
    onFailure: (_listener: (failure: ProjectorFailure) => void): Unsubscribe =>
      notYet("projectors.onFailure", "M2 (PS-4)"),
  };
}

/**
 * session 범위 설정 값 기록(PS-14의 session-settings)은 M2다. 값을 쓰는 길(set, reset)이 없으므로 M1의 session 층은 늘 비어 있다.
 * layer가 던지면 설정을 읽는 모든 소비자(core-tools 등)가 도구 호출마다 실패하므로 빈 층을 돌려준다
 */
const EMPTY_SESSION_LAYER: SessionSettingsLayer = { scope: "session", values: new Map() };
const SESSION_SETTINGS_M2: SessionSettingsStore = {
  layer: (): SessionSettingsLayer => EMPTY_SESSION_LAYER,
  set: () => notYet("sessionSettings.set", "M2 (PS-14)"),
  reset: () => notYet("sessionSettings.reset", "M2 (PS-14)"),
};

/** X 기록 포트(ext)는 M2다(PS-16 ext-port.ts) */
const EXT_PORT_M2: SessionService["ext"] = {
  commit: (): Promise<ExtCommitResult> =>
    Promise.reject(new Bug("session.not_implemented: ext.commit arrives with M2 (PS-16)")),
  // 확장 상태를 기록하는 길(commit)이 M2까지 없으므로 활성 가지 위의 확장 상태는 늘 비어 있다. 던지면 ExtHost.openThread가
  // thread를 열지 못해 모든 경계 처리가 thread_not_open으로 실패한다
  loadThread: (): Promise<ExtThreadSnapshot> =>
    Promise.resolve({ enabled: [], states: [], openLease: null, leaseEpochs: {} }),
  queryRecords: () =>
    Promise.reject(new Bug("session.not_implemented: ext.queryRecords arrives with M2 (PS-16)")),
};

/**
 * SessionService를 만든다. 시작할 때 비투영 테이블 마이그레이션을 적용하고, 코어 투영기가 없거나 버전이 다르면 다시 만든다.
 * 쓰기 열기에서 아무것도 실행하지 않는다는 규칙은 열기·복구 쪽에서 지킨다(resume.ts)
 */
export function createSessionService(deps: SessionDeps): Result<SessionService, SessionStartError> {
  const applied = deps.migrations.apply(SESSION_MIGRATION_SET);
  if (!applied.ok) return err({ kind: "migration", error: applied.error });

  const guard = createGuardState();
  const sessions = createOpenSessions();
  const catalog = createKindCatalog(deps.eventKinds);
  const producers = createProducerRegistry(catalog);
  const core = createCoreProjector();
  const projectors = (): readonly Projector[] => [core];

  const ensured = ensureProjectors(deps.db, projectors(), catalog);
  if (!ensured.ok) return err({ kind: "store", error: ensured.error });

  let startupRebuilt: readonly string[] = ensured.value;
  const takeStartupRebuilt = (): readonly string[] => {
    const names = startupRebuilt;
    startupRebuilt = [];
    return names;
  };

  const feedController = createFeed({ db: deps.db, catalog, guard, logger: deps.logger });
  const settings = (): PersistenceSettings => deps.settings?.() ?? DEFAULT_PERSISTENCE_SETTINGS;
  const writer = createSessionWriter({
    db: deps.db,
    leases: deps.leases,
    clock: deps.clock,
    ids: deps.ids,
    faults: deps.faults ?? { hit: (): void => {} },
    catalog,
    producers,
    sessions,
    guard,
    projectors,
    ...(deps.putBlob === undefined ? {} : { putBlob: deps.putBlob }),
    publish: (batch) => {
      feedController.publish(batch);
    },
  });
  const reader = createReader({
    db: deps.db,
    catalog,
    readBlob: deps.readBlob,
    logger: deps.logger,
  });
  const resumer = createResumer({
    db: deps.db,
    leases: deps.leases,
    catalog,
    producers,
    sessions,
    writer,
    clock: deps.clock,
    ids: deps.ids,
    settings,
    projectors,
    takeStartupRebuilt,
    logger: deps.logger,
  });
  const threads = createLifecycle({
    db: deps.db,
    leases: deps.leases,
    writer,
    producers,
    sessions,
    ids: deps.ids,
    holder: deps.holder,
    onLeaseLost: deps.onLeaseLost,
  });

  return ok({
    commit: (request) => writer.commit(request),
    producer: (id: ProducerId): ProducerHandle => producers.claim(id),
    projectors: createProjectorRegistry(core),
    query: createProjectionQuery(deps.db),
    readFrom: (afterSeq, options) => reader.readFrom(afterSeq, options),
    readBranch: (threadId, leaf) => reader.readBranch(threadId, leaf),
    loadCheckpoint: (threadId) => reader.loadCheckpoint(threadId),
    subscribe: (afterSeq, listener, filter) => feedController.subscribe(afterSeq, listener, filter),
    feed: feedController.feed,
    hydrate: (event) => reader.hydrate(event),
    emitVolatile: (event) => {
      feedController.emitVolatile(event);
    },
    openForWrite: (threadId, token) => resumer.openForWrite(threadId, token),
    openForRead: (threadId) => resumer.openForRead(threadId),
    recover: (threadId, recoverDeps) => resumer.recover(threadId, recoverDeps),
    beginResume: (threadId, mode) => resumer.beginResume(threadId, mode),
    release: (threadId, reason) => resumer.release(threadId, reason),
    threads,
    sessionSettings: SESSION_SETTINGS_M2,
    ext: EXT_PORT_M2,
  });
}

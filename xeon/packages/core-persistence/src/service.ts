// Cordis 서비스 xeon.session(SessionService)의 조립(L1.persistence.spec §3.3). 조립 루트가 deps를 넘긴다.
import { err, ok, type Result } from "@xeon/contracts";
import type {
  MigrationError,
  ProducerHandle,
  ProducerId,
  SessionService,
  StoreError,
} from "@xeon/contracts/records";
import {
  DEFAULT_PERSISTENCE_SETTINGS,
  type PersistenceSettings,
  type SessionDeps,
} from "./deps.ts";
import { createExtPort } from "./ext-port.ts";
import { createItemPages, registerItemPages } from "./item-pages.ts";
import { createLifecycle } from "./lifecycle.ts";
import { createGuardState, createOpenSessions } from "./ownership.ts";
import { NO_SESSION_POINTS } from "./points.ts";
import { createRetention } from "./retention.ts";
import { createProducerRegistry } from "./producers.ts";
import { createCoreProjector } from "./projector/core.ts";
import { ensureProjectors } from "./projector/rebuild.ts";
import { createProjectorController } from "./projector/registry.ts";
import { createProjectionQuery } from "./query.ts";
import { createReader } from "./read.ts";
import { createResumer } from "./resume.ts";
import { createSessionSettings } from "./session-settings.ts";
import { SESSION_MIGRATION_SET } from "./schema/migrations.ts";
import { createFeed } from "./subscribe.ts";
import { createKindCatalog } from "./upcast.ts";
import { createSessionWriter } from "./writer.ts";

/** 시작 실패: 비투영 테이블 마이그레이션 오류, 또는 투영 재생성 중 저장소 오류 */
export type SessionStartError =
  | { readonly kind: "migration"; readonly error: MigrationError }
  | { readonly kind: "store"; readonly error: StoreError };

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
  const controller = createProjectorController({
    db: deps.db,
    catalog,
    core,
    logger: deps.logger,
  });

  const projectorTables = (): readonly string[] =>
    controller.all().flatMap((projector) => projector.tables);

  const ensured = ensureProjectors(deps.db, [core], catalog);
  if (!ensured.ok) return err({ kind: "store", error: ensured.error });

  let startupRebuilt: readonly string[] = ensured.value;
  const takeStartupRebuilt = (): readonly string[] => {
    const names = startupRebuilt;
    startupRebuilt = [];
    return names;
  };

  const points = deps.points ?? NO_SESSION_POINTS;
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
    projectors: () => controller.active(),
    ...(deps.guardProjectors === undefined ? {} : { guardProjectors: deps.guardProjectors }),
    onProjectorFailure: (failure) => {
      controller.notifyFailure(failure);
    },
    ...(deps.putBlob === undefined ? {} : { putBlob: deps.putBlob }),
    publish: (batch) => {
      feedController.publish(batch);
    },
  });
  const sessionSettings = createSessionSettings({
    db: deps.db,
    writer,
    producers,
    ids: deps.ids,
    logger: deps.logger,
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
    ensureProjectors: () => controller.ensure(),
    takeStartupRebuilt,
    logger: deps.logger,
    points,
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
    guard,
    points,
    logger: deps.logger,
    projectorTables,
    onRemoved: (threadId) => {
      sessionSettings.forget(threadId);
    },
  });

  const retention = createRetention({
    db: deps.db,
    leases: deps.leases,
    sessions,
    guard,
    clock: deps.clock,
    settings,
    projectorTables,
    onRemoved: (threadId) => {
      sessionSettings.forget(threadId);
    },
    logger: deps.logger,
  });

  const service: SessionService = {
    retention,
    commit: (request) => writer.commit(request),
    producer: (id: ProducerId): ProducerHandle => producers.claim(id),
    projectors: controller.registry,
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
    sessionSettings,
    ext: createExtPort({
      db: deps.db,
      writer,
      producers,
      catalog,
      canDetach: deps.putBlob !== undefined,
    }),
  };
  registerItemPages(service, createItemPages({ db: deps.db, catalog, reader }));
  return ok(service);
}

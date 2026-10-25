import type { Logger } from "@xeon/contracts";
import type { SessionService, StoreDb, StoreCapabilities } from "@xeon/contracts/records";
import { probeFts } from "./probe.ts";
import { createKnowledgeProjector } from "./projector.ts";
import type { SearchAvailability } from "./service.ts";

// L2.knowledge.spec §4.8.5. 능력을 판정하고 투영기 `cap.knowledge`를 등록한 뒤, 표를 실제로 읽을 수 있는지 확인해 검색 기능의
// 가용성을 정한다. 쓸 수 없으면 시작을 막지 않고 그 기능만 끈다(세션 검색은 `unavailable`, 스킬·메모리 검색은 LIKE 경로).

export interface SearchSetup {
  readonly availability: SearchAvailability;
  /** 투영기 등록을 해제한다(표는 남는다) */
  dispose(): void;
}

const NONE: SearchAvailability = { sessions: false, docs: false, list: false, reason: undefined };

function ready(db: StoreDb, table: string): boolean {
  return db.read((tx) => tx.get(`SELECT 1 AS present FROM ${table} LIMIT 1`)).ok;
}

export function setupSearch(input: {
  readonly capabilities: Pick<StoreCapabilities, "fts5" | "sqliteVersion">;
  readonly session: SessionService | undefined;
  readonly db: StoreDb;
  readonly logger: Logger;
}): SearchSetup {
  const { session, db, logger } = input;
  if (session === undefined) {
    logger.warn("knowledge.search_unavailable", { reason: "no session service" });
    return { availability: { ...NONE, reason: "no session service" }, dispose() {} };
  }
  const probe = input.capabilities;
  const fts = probeFts(probe);
  const registered = session.projectors.register(createKnowledgeProjector({ fts: fts.available }));
  if (!registered.ok) {
    logger.error("knowledge.projector_register_failed", { kind: registered.error.kind });
    return {
      availability: { ...NONE, reason: `projector registration failed: ${registered.error.kind}` },
      dispose() {},
    };
  }
  const listReady = ready(db, "cap_knowledge_sessions");
  let reason: string | undefined = fts.available ? undefined : fts.reason;
  let indexReady = false;
  if (fts.available) {
    indexReady =
      listReady &&
      ready(db, "cap_knowledge_sessionfts") &&
      ready(db, "cap_knowledge_sessiondocs") &&
      ready(db, "cap_knowledge_docsfts") &&
      ready(db, "cap_knowledge_sessioncursor");
    if (!indexReady) reason = "the search tables could not be created (FTS5 trigram)";
  }
  if (reason !== undefined) logger.warn("knowledge.search_unavailable", { reason });
  return {
    availability: { sessions: indexReady, docs: indexReady, list: listReady, reason },
    dispose: () => {
      registered.value.dispose();
    },
  };
}

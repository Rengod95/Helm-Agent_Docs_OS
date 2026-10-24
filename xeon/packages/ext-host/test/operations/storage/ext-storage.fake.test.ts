import { createFakeSession, envelope } from "../support/fake-session.ts";
import { runExtStorageContract } from "./ext-storage.contract.ts";

// 계약 시나리오를 X 자체 저장 대역으로 실행한다. bun:sqlite 실행은 L0.store.plan ST-23이 한다
runExtStorageContract("fake session", () => {
  const session = createFakeSession();
  return {
    registry: session.registry,
    store: session.store,
    commit: (events, options) => session.commit(events, options),
    hashOf: (table) => session.hashOf(table),
    event: envelope,
  };
});

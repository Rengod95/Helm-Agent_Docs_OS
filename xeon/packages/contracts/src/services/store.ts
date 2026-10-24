import type { PortKey } from "../extensions/index.ts";
import type { StoreService } from "../records/index.ts";

// F.capabilities.spec §3.12 규칙 9. StoreService와 StoreServiceName은 records/store-db.ts에 있고, records는 PortKey를
// import할 수 없어 전체 모양의 키만 services가 둔다. 이름은 StoreServiceName("xeon.store")과 같아야 한다(names.test.ts).
// 확장이 쓰는 부분형 키는 extensions의 `ScopedStorePortKey`(같은 이름)다.

/** `xeon.store` 전체 모양(StoreService)의 포트 키. 제공 platform-store, 소비 core-persistence·core-tools */
export const StoreServicePortKey: PortKey<StoreService> = { name: "xeon.store" };

import type { WireHandlers } from "@xeon/contracts/wire";
import type { Engine } from "../types.ts";

// F wire-settings `web.providers`(M3-REQ-96). 읽기 전용이라 쓰기 소유를 얻지 않는다. 값은 엔진의 웹 포트가 채운다(assembly/web-providers.ts).

export function createWebHandlers(engine: Engine): Pick<WireHandlers, "web.providers"> {
  const { web } = engine.ports;
  return {
    "web.providers": (_params, context) => web.providers(context.signal),
  };
}

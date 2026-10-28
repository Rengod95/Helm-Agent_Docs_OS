import {
  CapabilityError,
  WebBrowse,
  WebResearch,
  type CapabilityApi,
  type CapabilityId,
  type WebService,
} from "@xeon/contracts/capabilities";
import type { WebDeps } from "./deps.ts";
import { createFetchApi } from "./fetch/pipeline.ts";
import { createSearchApi } from "./search/search-api.ts";

// 능력별 API 객체를 조립한다. 묶음(WebService)은 Cordis에 등록하지 않는다. 등록은 능력마다 한다(L2.readme §5.6).
// browse는 B10(M3), research는 2차다. 그 메서드는 `unsupported`로 거부한다.

function unsupported(capability: CapabilityId, method: string): Promise<never> {
  return Promise.reject(
    new CapabilityError({
      capability,
      method,
      code: "unsupported",
      message: `${capability} is not available in this build.`,
      retryable: false,
    }),
  );
}

function unsupportedBrowse(): CapabilityApi<typeof WebBrowse> {
  return {
    open: () => unsupported(WebBrowse.id, "open"),
    act: () => unsupported(WebBrowse.id, "act"),
    read: () => unsupported(WebBrowse.id, "read"),
    close: () => unsupported(WebBrowse.id, "close"),
  };
}

function unsupportedResearch(): CapabilityApi<typeof WebResearch> {
  return {
    start: () => unsupported(WebResearch.id, "start"),
    get: () => unsupported(WebResearch.id, "get"),
    cancel: () => unsupported(WebResearch.id, "cancel"),
    run: () => unsupported(WebResearch.id, "run"),
  };
}

export function createWebService(deps: WebDeps): WebService {
  return {
    search: createSearchApi(deps),
    fetch: createFetchApi(deps),
    browse: unsupportedBrowse(),
    research: unsupportedResearch(),
  };
}

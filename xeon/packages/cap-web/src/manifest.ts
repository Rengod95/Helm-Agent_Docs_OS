import { WebFetch, WebSearch } from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@xeon/contracts/extensions";

export const WEB_EXTENSION_NAME = "cap-web";

/**
 * 내장 L2 플러그인 매니페스트(L2.web.plan §2 manifest.ts). M2가 제공하는 능력은 `web.search`와 `web.fetch`다.
 * `web.browse`는 B10(M3)에서, `web.research`는 2차에서 `provides`에 더한다. 확장 지점 구독(`input`, `session_shutdown`,
 * `turn_start`)은 확장 엔트리를 만드는 WEB.6에서 `points`에 더한다.
 */
export function webManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 1,
    name: WEB_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Web tools",
    description: "Web search and page fetch with policy, caching and cost accounting (L2).",
    defaultEnabled: true,
    layer: "L2",
    kind: "plugin",
    entry: "./src/index.ts",
    provides: [
      { id: WebSearch.id, version: WebSearch.version },
      { id: WebFetch.id, version: WebFetch.version },
    ],
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}

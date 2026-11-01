import { WebBrowse, WebFetch, WebSearch } from "@fresnel/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@fresnel/contracts/extensions";

export const WEB_EXTENSION_NAME = "cap-web";

/**
 * 내장 L2 플러그인 매니페스트(L2.web.plan §2 manifest.ts). 제공하는 기능은 `web.search`, `web.fetch`, `web.browse`다.
 * `web.research`는 2차에서 `provides`에 더한다. 훅 구독(`input.user.before`, `thread.shutdown`,
 * `boundary.step.before`)은 확장 엔트리를 만드는 WEB.6에서 `hooks`에 더한다.
 */
export function webManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 2,
    name: WEB_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Web tools",
    description: "Web search and page fetch with policy, caching and cost accounting (L2).",
    defaultEnabled: true,
    entry: "./src/index.ts",
    plugins: [
      {
        layer: "L2",
        hooks: [],
        provides: [
          { id: WebSearch.id, version: WebSearch.version },
          { id: WebFetch.id, version: WebFetch.version },
          { id: WebBrowse.id, version: WebBrowse.version },
        ],
      },
    ],
    trust: { level: "builtin" },
  });
}

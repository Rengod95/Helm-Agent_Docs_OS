import { definePlugin, type PluginModule } from "@fresnel/orchestration-sdk";
import { suggestManifest } from "./manifest.ts";
import { registerSuggestMethods } from "./methods.ts";

// 제안 플러그인(번들 기본 플러그인, D-M3-01 c와 같은 길). 보통 플러그인이고 읽기 메서드 list와 count만 있다.
// 대기열의 결정은 여기 없다. 호스트 wire `proposal.decide`가 사용자 문맥에서 한다.

const plugin: PluginModule = definePlugin({
  manifest: suggestManifest,
  setup(g) {
    registerSuggestMethods(g);
  },
});

/** 외부 로더가 부르는 엔트리(X.loading-trust.spec §4.4.2: named `extension`) */
export const extension: PluginModule["entry"] = plugin.entry;

export { suggestManifest } from "./manifest.ts";
export {
  SuggestCountResultSchema,
  SuggestListParamsSchema,
  suggestMethodDecls,
} from "./methods.ts";
export {
  countPending,
  listSuggestions,
  LEDGER_MAX,
  type LedgerReader,
  type PendingCount,
  type SuggestListParams,
} from "./queue.ts";

import type { PolicyRule, RuleRegistration, TieredRule } from "@xeon/contracts/services";
import { loadableRules, validateRules } from "./rules.ts";
import { tag } from "./tiers.ts";

// L1.tools.spec §4.5 "코어 규칙 등록". L1 패키지가 `registerRules("core:<도메인>", rules)`로 넣는 default 티어 규칙의 저장소.
// 같은 source로 다시 부르면 그 source의 규칙을 통째로 바꾸고, 문제가 있는 규칙은 적재하지 않고 issues로 돌려준다.

export interface CoreRules {
  register(source: `core:${string}`, rules: readonly PolicyRule[]): RuleRegistration;
  /** 지금 적재된 코어 규칙. source별 등록 순서를 지킨다 */
  all(): readonly TieredRule[];
}

export function createCoreRules(): CoreRules {
  /** source → 그 source의 현재 규칙. 등록 토큰으로 오래된 dispose가 새 등록을 지우지 않게 한다 */
  const bySource = new Map<
    string,
    { readonly token: symbol; readonly rules: readonly TieredRule[] }
  >();
  return {
    register(source, rules) {
      const issues = validateRules(rules);
      const loaded = tag(loadableRules(rules, issues), "default", source);
      const token = Symbol(source);
      bySource.set(source, { token, rules: loaded });
      return {
        issues,
        dispose() {
          if (bySource.get(source)?.token === token) bySource.delete(source);
        },
      };
    },
    all() {
      return [...bySource.values()].flatMap((entry) => entry.rules);
    },
  };
}

import { err, ok, type Result } from "@fresnel/contracts";
import type { SettingKey } from "@fresnel/contracts/settings";
import type { Verdict } from "../shared/verdict-table.tsx";
import { checkDomain, type DomainIssue } from "./settings-sandbox-model.ts";

// 웹 접근 판정 표(DP-109)의 순수 모델. 값은 세 목록 `l2.web.policy.allow`·`ask`·`deny`이고, 화면은 이것을 "도메인 하나 = 판정 하나"
// 표 한 벌로 보인다. 판정을 바꾸면 그 도메인을 세 목록 사이에서 옮긴다. 같은 도메인이 여러 목록에 있으면(파일로 고친 값)
// 엔진 판정 순서(막기 > 물어보기 > 허용)대로 가장 센 판정 한 줄로 보이고, 판정을 바꾸면 모든 목록에서 빼고 한 곳에 넣는다.

export const WEB_POLICY_KEYS: Readonly<Record<Verdict, SettingKey>> = {
  allow: "l2.web.policy.allow",
  ask: "l2.web.policy.ask",
  deny: "l2.web.policy.deny",
};

export type DomainLists = Readonly<Record<Verdict, readonly string[]>>;

export interface DomainRow {
  readonly domain: string;
  readonly verdict: Verdict;
}

const STRENGTH: readonly Verdict[] = ["deny", "ask", "allow"];

/** 세 목록을 표 줄로. 줄 순서는 허용 → 물어보기 → 막기, 목록 안에서는 저장된 순서다 */
export function domainRowsOf(lists: DomainLists): readonly DomainRow[] {
  const verdictOf = new Map<string, Verdict>();
  for (const verdict of STRENGTH) {
    for (const domain of lists[verdict]) {
      if (!verdictOf.has(domain)) verdictOf.set(domain, verdict);
    }
  }
  const rows: DomainRow[] = [];
  const seen = new Set<string>();
  for (const verdict of ["allow", "ask", "deny"] as const) {
    for (const domain of lists[verdict]) {
      if (seen.has(domain)) continue;
      seen.add(domain);
      rows.push({ domain, verdict: verdictOf.get(domain) ?? verdict });
    }
  }
  return rows;
}

/** 도메인 하나를 모든 목록에서 빼고 `verdict` 목록 끝에 넣는다. `null`이면 빼기만 한다 */
export function withDomainVerdict(
  lists: DomainLists,
  domain: string,
  verdict: Verdict | null,
): DomainLists {
  const without = (list: readonly string[]): readonly string[] =>
    list.filter((item) => item !== domain);
  const next: Record<Verdict, readonly string[]> = {
    allow: without(lists.allow),
    ask: without(lists.ask),
    deny: without(lists.deny),
  };
  if (verdict !== null) next[verdict] = [...next[verdict], domain];
  return next;
}

/** 바뀐 목록의 판정들. 쓰기는 바뀐 키만 한다 */
export function changedVerdictsOf(before: DomainLists, after: DomainLists): readonly Verdict[] {
  return (["allow", "ask", "deny"] as const).filter(
    (verdict) => before[verdict].join("\n") !== after[verdict].join("\n"),
  );
}

export type DomainAddIssue = DomainIssue | "duplicate";

/** 추가 줄의 도메인을 검사한다. 이미 표에 있으면 실패다(판정은 줄에서 바꾼다) */
export function checkNewDomain(lists: DomainLists, text: string): Result<string, DomainAddIssue> {
  const checked = checkDomain(text);
  if (!checked.ok) return err(checked.error);
  const all = [...lists.allow, ...lists.ask, ...lists.deny];
  return all.includes(checked.value) ? err("duplicate") : ok(checked.value);
}

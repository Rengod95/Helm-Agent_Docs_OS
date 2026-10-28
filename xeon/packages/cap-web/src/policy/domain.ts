import { attempt } from "@xeon/contracts";
import type { ScopeStack } from "@xeon/contracts/settings";
import { DOMAIN_PATTERN_SOURCE, readWebSettings } from "../settings.ts";

// L2.web.spec §4.5. 도메인 규칙 문법, 매칭, 평가 순서(deny > ask > allow, 기본 ask).

const DOMAIN_PATTERN = new RegExp(DOMAIN_PATTERN_SOURCE);

/** `example.com`, `*.example.com`, `*`만 맞다. 끝이 `*`인 패턴(`example.*`)과 포트·경로는 거부한다 */
export function isDomainPattern(text: string): boolean {
  return DOMAIN_PATTERN.test(text);
}

/** 비교용 호스트: 소문자, punycode, 대괄호와 끝 점 제거. IDN 패턴도 같은 함수를 지난다 */
export function normalizeHost(host: string): string {
  const lower = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const parsed = attempt(() => new URL(`http://${lower}`).hostname);
  const ascii = parsed.ok ? parsed.value : lower;
  return ascii.replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

/** `*.`은 점 경계에서만 맞는다. `*.example.com`은 `example.com`, `badexample.com`에 맞지 않는다 */
export function matchDomain(pattern: string, host: string): boolean {
  if (!isDomainPattern(pattern)) return false;
  const subject = normalizeHost(host);
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const base = normalizeHost(pattern.slice(2));
    return subject.length > base.length + 1 && subject.endsWith(`.${base}`);
  }
  return subject === normalizeHost(pattern);
}

export interface DomainRules {
  readonly allow: readonly string[];
  readonly ask: readonly string[];
  readonly deny: readonly string[];
}

export type DomainVerdict = "deny" | "ask" | "allow";

function union(a: readonly string[], b: readonly string[]): readonly string[] {
  return [...new Set([...a, ...b])];
}

/**
 * 모든 범위의 목록과 에이전트(서브에이전트) 규칙을 합친다. 우선순위로 하나를 고르지 않으므로 어느 계층의 deny도
 * 다른 계층의 allow로 풀리지 않는다(§4.5.2).
 */
export function resolveDomainPolicy(stack: ScopeStack, agentRules?: DomainRules): DomainRules {
  const base = readWebSettings(stack).policy;
  return mergeDomainRules({ allow: base.allow, ask: base.ask, deny: base.deny }, agentRules);
}

/** 두 규칙 집합의 합집합. 에이전트 규칙은 부모 규칙을 좁힐 수만 있다 */
export function mergeDomainRules(base: DomainRules, extra: DomainRules | undefined): DomainRules {
  if (extra === undefined) return base;
  return {
    allow: union(base.allow, extra.allow),
    ask: union(base.ask, extra.ask),
    deny: union(base.deny, extra.deny),
  };
}

/** deny > ask > allow. 어느 규칙에도 맞지 않으면 ask */
export function decideDomain(rules: DomainRules, host: string): DomainVerdict {
  if (rules.deny.some((pattern) => matchDomain(pattern, host))) return "deny";
  if (rules.ask.some((pattern) => matchDomain(pattern, host))) return "ask";
  if (rules.allow.some((pattern) => matchDomain(pattern, host))) return "allow";
  return "ask";
}

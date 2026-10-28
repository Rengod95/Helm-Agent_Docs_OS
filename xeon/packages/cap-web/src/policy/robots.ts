import type { Clock } from "@xeon/contracts";

// L2.web.spec §4.7. robots.txt(RFC 9309) 파서와 호스트별 24시간 메모리 캐시.
// 4xx는 전부 허용, 5xx·연결 실패는 전부 금지로 본다(§2.3.1) [제안]. 사용자 에이전트 토큰은 `Xeon`이다.

export const ROBOTS_USER_AGENT_TOKEN: string = "Xeon";
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

interface RobotsRule {
  readonly allow: boolean;
  readonly path: string;
}

export interface RobotsRules {
  readonly rules: readonly RobotsRule[];
}

const ALLOW_ALL: RobotsRules = { rules: [] };
const DISALLOW_ALL: RobotsRules = { rules: [{ allow: false, path: "/" }] };

interface Group {
  readonly agents: string[];
  readonly rules: RobotsRule[];
}

/** 줄 단위 파서. 알 수 없는 지시어와 주석은 건너뛴다 */
export function parseRobots(
  text: string,
  agentToken: string = ROBOTS_USER_AGENT_TOKEN,
): RobotsRules {
  const groups: Group[] = [];
  let current: Group | undefined;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (current === undefined || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current === undefined) continue;
    if (field === "allow" || field === "disallow") {
      // 빈 Disallow는 "전부 허용"이라 규칙을 더하지 않는다
      if (value !== "") current.rules.push({ allow: field === "allow", path: value });
    }
  }
  const token = agentToken.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((agent) => agent === token));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  return { rules: chosen.flatMap((group) => group.rules) };
}

function patternToRegExp(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = anchored ? path.slice(0, -1) : path;
  const escaped = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

/** 가장 긴 규칙이 이긴다. 길이가 같으면 Allow가 이긴다(RFC 9309 §2.2.2) */
export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: RobotsRule | undefined;
  for (const rule of rules.rules) {
    if (!patternToRegExp(rule.path).test(pathAndQuery)) continue;
    if (
      best === undefined ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best?.allow ?? true;
}

/** 상태 코드로 규칙을 고른다. 2xx는 본문을 파싱하고, 4xx는 전부 허용, 그 밖(5xx 등)은 전부 금지 */
export function rulesFromResponse(status: number, body: string): RobotsRules {
  if (status >= 200 && status < 300) return parseRobots(body);
  if (status >= 400 && status < 500) return ALLOW_ALL;
  return DISALLOW_ALL;
}

/** robots.txt 한 건을 가져온다. 구현은 정책 검사를 거친 전송을 쓴다. 연결 실패는 failed다 */
export type RobotsFetcher = (
  origin: string,
  signal: AbortSignal,
) => Promise<
  | { readonly kind: "response"; readonly status: number; readonly body: string }
  | { readonly kind: "failed" }
>;

export interface RobotsChecker {
  /** robots.txt가 이 URL의 수집을 허용하는가 */
  allows(url: URL, signal: AbortSignal): Promise<boolean>;
}

export function createRobotsChecker(fetcher: RobotsFetcher, clock: Clock): RobotsChecker {
  const cache = new Map<string, { readonly rules: RobotsRules; readonly expiresAt: number }>();
  const inflight = new Map<string, Promise<RobotsRules>>();

  async function load(origin: string, signal: AbortSignal): Promise<RobotsRules> {
    const outcome = await fetcher(origin, signal);
    const rules =
      outcome.kind === "failed" ? DISALLOW_ALL : rulesFromResponse(outcome.status, outcome.body);
    // 취소로 끊긴 가져오기는 저장하지 않는다(취소가 "전부 금지"로 굳지 않게)
    if (!signal.aborted) cache.set(origin, { rules, expiresAt: clock.now() + ROBOTS_TTL_MS });
    return rules;
  }

  return {
    async allows(url, signal) {
      const origin = url.origin;
      const hit = cache.get(origin);
      let rules = hit !== undefined && hit.expiresAt > clock.now() ? hit.rules : undefined;
      if (rules === undefined) {
        const pending = inflight.get(origin) ?? load(origin, signal);
        inflight.set(origin, pending);
        try {
          rules = await pending;
        } finally {
          inflight.delete(origin);
        }
      }
      return robotsAllows(rules, `${url.pathname}${url.search}`);
    },
  };
}

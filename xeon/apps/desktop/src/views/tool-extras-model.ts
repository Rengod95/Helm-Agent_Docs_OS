import type { JsonValue } from "@fresnel/contracts/conversation";

// `agent`와 웹 도구 행의 화면 값(S5, S6, 화면 없이 시험). 하위 에이전트 행은 정의 이름과 할 일 한 줄이 머리이고,
// 결과 글은 자식의 보고다. 웹 결과 행은 출처(도메인·제목) 칩을 낸다. 출처는 결과 글의 `[s1] 제목 (날짜) 주소` 줄에서 읽는다.

type Obj = { readonly [key: string]: JsonValue };

function isObj(value: JsonValue | undefined): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strOf(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export const AGENT_TOOL = "agent";
export const WEB_TOOLS: readonly string[] = ["web_search", "web_fetch"];

const TASK_HEAD_CHARS = 80;

/** 머리 한 줄: `<정의 이름> · <할 일 첫 줄>`. 인자가 모자라면 있는 것만 */
export function agentHeadOf(args: JsonValue): string {
  if (!isObj(args)) return "";
  const agent = strOf(args["agent"]);
  const task = strOf(args["task"]);
  const firstLine = task === null ? null : (task.split("\n")[0] ?? "").trim();
  const clipped =
    firstLine === null
      ? null
      : firstLine.length > TASK_HEAD_CHARS
        ? `${firstLine.slice(0, TASK_HEAD_CHARS)}…`
        : firstLine;
  return [agent, clipped === "" ? null : clipped].filter((p) => p !== null).join(" · ");
}

type AgentOutcome = "completed" | "aborted" | "error";

export interface AgentResult {
  readonly childThreadId: string | null;
  readonly outcome: AgentOutcome;
  /** 자식의 보고 글(성공) 또는 실패 이유(오류 코드 꼬리표는 뗐다) */
  readonly body: string;
}

const CODE_PREFIX = /^\[([^\]]+)\]\s*/;

const REPORT_OPEN = /^<subagent_report[^>]*>\n?/;
const REPORT_CLOSE = /\n?<\/subagent_report>\s*$/;

/** 엔진이 자식 보고를 감싼 `<subagent_report …>` 표지를 뗀다. 화면에는 보고 글만 보인다 */
function unwrapReport(text: string): string {
  return text.replace(REPORT_OPEN, "").replace(REPORT_CLOSE, "");
}

/** 결과의 `details.status`(엔진: completed·aborted·error)와 글머리 꼬리표로 결과를 읽는다 */
export function agentResultOf(
  text: string,
  details: JsonValue | undefined,
  isError: boolean,
): AgentResult {
  const d = isObj(details) ? details : {};
  const status = d["status"];
  const childThreadId = strOf(d["childThreadId"]);
  const found = CODE_PREFIX.exec(text);
  const body = unwrapReport(found === null ? text : text.slice(found[0].length));
  const code = found?.[1] ?? null;
  if (status === "aborted" || code === "fresnel:aborted" || code === "aborted") {
    return { childThreadId, outcome: "aborted", body };
  }
  if (isError || status === "error") return { childThreadId, outcome: "error", body };
  return { childThreadId, outcome: "completed", body };
}

/** 보고가 이 줄 수를 넘으면 접는다 */
export const REPORT_FOLD_LINES = 12;

export function reportFoldOf(body: string): {
  readonly head: string;
  readonly rest: string | null;
} {
  const lines = body.split("\n");
  if (lines.length <= REPORT_FOLD_LINES) return { head: body, rest: null };
  return {
    head: lines.slice(0, REPORT_FOLD_LINES).join("\n"),
    rest: lines.slice(REPORT_FOLD_LINES).join("\n"),
  };
}

export interface WebSource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /** `www.`를 뗀 호스트 */
  readonly domain: string;
}

const SOURCE_LINE = /^\[(s\d+)\]\s*(.*?)\s*(?:\(\d{4}-\d{2}-\d{2}\)\s*)?(https?:\/\/\S+)\s*$/;

/** http(s) 주소만 받는다. 그 밖의 값은 null */
function webDomainOf(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return parsed.hostname.replace(/^www\./, "");
}

/** 웹 도구 결과 글에서 출처 줄을 모은다. 같은 주소는 한 번만 */
export function webSourcesOf(text: string): readonly WebSource[] {
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const line of text.split("\n")) {
    const m = SOURCE_LINE.exec(line.trim());
    if (m === null) continue;
    const id = m[1] ?? "";
    const url = m[3] ?? "";
    const domain = webDomainOf(url);
    if (domain === null || seen.has(url)) continue;
    seen.add(url);
    out.push({ id, title: (m[2] ?? "").trim() || domain, url, domain });
  }
  return out;
}

const BARE_URL = /https?:\/\/[^\s<>()[\]\x22\x27]+/g;

/** 답 본문에 든 링크(마크다운 링크와 맨 주소). 끝의 문장부호는 뗀다. 최대 `limit`개 */
export function citedLinksOf(text: string, limit: number): readonly WebSource[] {
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const raw of text.match(BARE_URL) ?? []) {
    const url = raw.replace(/[.,;:!?*_]+$/, "");
    const domain = webDomainOf(url);
    if (domain === null || seen.has(url)) continue;
    seen.add(url);
    out.push({ id: `c${out.length + 1}`, title: domain, url, domain });
    if (out.length >= limit) break;
  }
  return out;
}

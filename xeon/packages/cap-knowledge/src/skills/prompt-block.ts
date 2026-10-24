import type { SkillIndexEntry } from "@xeon/contracts/capabilities";

// L2.knowledge.spec §4.2.5 첫 turn 인덱스 블록. 순수 함수다. 같은 스킬 집합과 같은 설정은 같은 바이트의 블록을 만든다
// (프롬프트 캐시). 블록을 어디에 넣는지는 L1.context가 정한다.

const HEADER =
  "아래 스킬은 특정 작업의 절차를 담고 있다. 작업이 설명과 맞으면 skill_view로 본문을 읽는다.";

/** pi `escapeXml` */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 줄바꿈을 공백 하나로 줄이고, 코드 포인트 `max`개를 넘으면 `max - 1`개 뒤에 `…`을 붙인다 */
export function truncateDescription(description: string, max: number): string {
  const flat = description.replace(/\s+/g, " ").trim();
  const points = Array.from(flat);
  if (points.length <= max) return flat;
  return `${points.slice(0, Math.max(0, max - 1)).join("")}…`;
}

function entryLine(entry: SkillIndexEntry): string {
  return `  <skill><name>${escapeXml(entry.name)}</name><description>${escapeXml(entry.description)}</description></skill>`;
}

export interface SkillIndexOptions {
  /** `knowledge_search`가 이 세션에 광고되는가. 광고되지 않는 도구를 안내하면 모델이 없는 도구를 부른다 */
  readonly searchTool: boolean;
}

function footer(omitted: number, options: SkillIndexOptions): string {
  if (omitted === 0) return "";
  return options.searchTool
    ? `\n외 ${omitted}개 스킬은 knowledge_search(kinds: ["skill"])로 찾는다.`
    : `\n외 ${omitted}개 스킬은 예산 때문에 이 목록에 싣지 못했다.`;
}

export interface SkillIndexBlock {
  /** 블록 전체. 싣을 스킬이 없으면 빈 문자열 */
  readonly text: string;
  readonly usedChars: number;
  /** 예산 때문에 싣지 못한 스킬 수 */
  readonly omitted: number;
  /** 싣은 스킬 이름(입력 순서) */
  readonly included: readonly string[];
}

/**
 * `entries`는 이미 모델 호출 가능한 스킬만, 싣는 순서(범위 순, 같은 범위 안에서는 이름 바이트 순)로 정렬되어 있다.
 * 앞에서부터 예산 안에 드는 만큼만 싣고 첫 번째로 안 드는 항목에서 멈춘다. 설명은 호출자가 이미 잘랐다.
 */
export function buildSkillIndexBlock(
  entries: readonly SkillIndexEntry[],
  limitChars: number,
  options: SkillIndexOptions = { searchTool: false },
): SkillIndexBlock {
  if (entries.length === 0) return { text: "", usedChars: 0, omitted: 0, included: [] };
  const open = `${HEADER}\n<available_skills>`;
  const close = "\n</available_skills>";
  let body = "";
  const included: string[] = [];
  for (const entry of entries) {
    const next = `${body}\n${entryLine(entry)}`;
    const remaining = entries.length - (included.length + 1);
    if (open.length + next.length + close.length + footer(remaining, options).length > limitChars)
      break;
    body = next;
    included.push(entry.name);
  }
  const omitted = entries.length - included.length;
  const text = `${open}${body}${close}${footer(omitted, options)}`;
  return { text, usedChars: text.length, omitted, included };
}

import { failure, type KnowledgeFailure } from "../errors.ts";
import { sha256Hex, utf8DecodeStrict } from "../hash.ts";

// L2.knowledge.spec §4.3.1~§4.3.2 메모리 파일 형식. 순수 함수다.
// 항목 사이는 `§` 한 글자만 있는 줄로 나눈다: `항목1\n§\n항목2\n`. 항목 텍스트는 앞뒤 공백을 지우고 NFC로 바꾼다.
// 항목 ID는 그 텍스트 sha256의 앞 12자다.

const DELIMITER = "§";
const PREVIEW_CHARS = 80;
const MAX_ENTRY_CHARS = 20_000;

interface MemoryEntryRecord {
  readonly id: string;
  readonly text: string;
  /** 코드 포인트 수 */
  readonly chars: number;
}

export function codePoints(text: string): number {
  let count = 0;
  for (const point of text) count += point.length > 0 ? 1 : 0;
  return count;
}

/** 줄바꿈을 LF로, 앞뒤 공백을 지우고 NFC로 바꾼다 */
function normalizeEntry(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim().normalize("NFC");
}

export function entryIdOf(normalized: string): string {
  return sha256Hex(normalized).slice(0, 12);
}

function entryOf(normalized: string): MemoryEntryRecord {
  return { id: entryIdOf(normalized), text: normalized, chars: codePoints(normalized) };
}

/** 항목 앞 80자(코드 포인트). 공백 연속은 하나로 줄인다 */
export function previewOf(text: string): string {
  return Array.from(text.replace(/\s+/g, " ")).slice(0, PREVIEW_CHARS).join("");
}

/** 쓰기 입력으로 들어온 항목 텍스트를 검사한다. 통과하면 정규화한 텍스트 */
export function checkEntryText(raw: string): { text: string } | { failure: KnowledgeFailure } {
  const text = normalizeEntry(raw);
  if (text === "") return { failure: failure("invalid_input", "a memory entry cannot be empty") };
  if (codePoints(text) > MAX_ENTRY_CHARS) {
    return { failure: failure("limit_exceeded", "a memory entry is at most 20,000 characters") };
  }
  if (text.includes("\0")) {
    return { failure: failure("invalid_input", "a memory entry cannot contain NUL") };
  }
  // 구분 줄과 헷갈리는 줄은 파일을 깨뜨린다: `§` 한 글자 줄과 `§`로 시작하는 줄
  if (text.split("\n").some((line) => line.trim().startsWith(DELIMITER))) {
    return {
      failure: failure(
        "invalid_input",
        `a memory entry cannot have a line that starts with ${DELIMITER}`,
      ),
    };
  }
  return { text };
}

export function serializeEntries(texts: readonly string[]): string {
  return texts.length === 0 ? "" : `${texts.join(`\n${DELIMITER}\n`)}\n`;
}

export type StructureIssue = "not_utf8" | "nul" | "broken_delimiter" | "too_large";

export interface ParsedMemory {
  readonly entries: readonly MemoryEntryRecord[];
  /** 구조가 깨졌으면 이유. 정상이면 undefined */
  readonly issue: StructureIssue | undefined;
  /** 파일 텍스트의 코드 포인트 수. UTF-8이 아니면 0 */
  readonly usedChars: number;
}

/**
 * 파일 내용을 항목으로 읽는다. 파일이 없으면 빈 목록이다. 구조가 깨진 이유(UTF-8 아님, NUL, 구분 줄에 다른 글자가 붙은 줄,
 * 한도의 2배 초과)가 있어도 읽을 수 있는 만큼 항목을 돌려준다(읽기는 가능, 쓰기는 거부).
 */
export function parseMemoryFile(bytes: Uint8Array | null, limitChars: number): ParsedMemory {
  if (bytes === null) return { entries: [], issue: undefined, usedChars: 0 };
  const decoded = utf8DecodeStrict(bytes);
  if (decoded === undefined) return { entries: [], issue: "not_utf8", usedChars: 0 };
  const text = decoded.replace(/\r\n?/g, "\n");
  const usedChars = codePoints(text);
  let issue: StructureIssue | undefined;
  if (text.includes("\0")) issue = "nul";
  else if (usedChars > limitChars * 2) issue = "too_large";
  const groups: string[][] = [[]];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === DELIMITER) {
      groups.push([]);
      continue;
    }
    // 구분 줄 뒤에 다른 글자가 붙은 줄(`§text`, `§§`)은 사람이 구분 줄을 잘못 쓴 흔적이다
    if (trimmed.startsWith(DELIMITER) && issue === undefined) issue = "broken_delimiter";
    groups[groups.length - 1]?.push(line);
  }
  const entries = groups
    .map((lines) => normalizeEntry(lines.join("\n")))
    .filter((entry) => entry !== "")
    .map(entryOf);
  return { entries, issue, usedChars };
}

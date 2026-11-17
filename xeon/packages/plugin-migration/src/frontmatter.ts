// YAML 머리말의 작은 부분집합 읽기. 스킬, 명령, 서브에이전트 머리말에 쓰이는 모양만 다룬다:
// `키: 값`(따옴표 문자열, 불리언, 숫자, 인라인 목록 `[a, b]`), 블록 목록(`- x`), 블록 문자열(`|`, `>`), 한 단계 중첩 맵.
// 읽지 못하는 모양은 오류로 돌려준다. 실행하지 않고 텍스트로만 다룬다.
import { err, ok, type Result } from "@fresnel/contracts";

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | readonly FrontmatterValue[]
  | { readonly [key: string]: FrontmatterValue };

export interface ParsedDocument {
  /** 머리말 키 순서를 보존한다 */
  readonly frontmatter: ReadonlyMap<string, FrontmatterValue>;
  /** 머리말 뒤의 본문. 머리말이 없으면 원문 전체 */
  readonly body: string;
  readonly hasFrontmatter: boolean;
}

export interface FrontmatterError {
  readonly kind: "invalid_frontmatter";
  readonly message: string;
}

function stripBom(text: string): string {
  return text.startsWith("﻿") ? text.slice(1) : text;
}

function unquote(raw: string): string {
  const text = raw.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

function scalar(raw: string): FrontmatterValue {
  const text = raw.trim();
  if (text === "" || text === "~" || text === "null") return text === "" ? "" : null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (inner === "") return [];
    return splitInline(inner).map((part) => scalar(part));
  }
  return unquote(text);
}

function splitInline(inner: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of inner) {
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function readBlock(
  lines: readonly string[],
  start: number,
  parentIndent: number,
): { readonly lines: readonly string[]; readonly next: number } {
  const block: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() !== "" && indentOf(line) <= parentIndent) break;
    block.push(line);
    index += 1;
  }
  return { lines: block, next: index };
}

function foldBlock(style: string, block: readonly string[]): string {
  const nonEmpty = block.filter((line) => line.trim() !== "");
  const base = nonEmpty.length === 0 ? 0 : Math.min(...nonEmpty.map(indentOf));
  const body = block.map((line) => (line.trim() === "" ? "" : line.slice(base)));
  while (body.length > 0 && body[body.length - 1] === "") body.pop();
  const folded = style.startsWith(">")
    ? body.reduce(
        (acc, line) =>
          acc === ""
            ? line
            : line === ""
              ? `${acc}\n`
              : acc.endsWith("\n")
                ? `${acc}${line}`
                : `${acc} ${line}`,
        "",
      )
    : body.join("\n");
  return style.endsWith("-") ? folded : `${folded}\n`;
}

function parseMapLines(
  lines: readonly string[],
  baseIndent: number,
): Result<Map<string, FrontmatterValue>, FrontmatterError> {
  const map = new Map<string, FrontmatterValue>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    index += 1;
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (indentOf(line) !== baseIndent) {
      return err({
        kind: "invalid_frontmatter",
        message: `unexpected indentation: ${line.trim()}`,
      });
    }
    const match = /^([^:\s][^:]*?)\s*:(?:\s+(.*)|\s*)$/.exec(line.trim());
    if (match === null) {
      return err({ kind: "invalid_frontmatter", message: `cannot read line: ${line.trim()}` });
    }
    const key = unquote(match[1] ?? "");
    const rest = (match[2] ?? "").trim();
    if (
      rest === "|" ||
      rest === ">" ||
      rest === "|-" ||
      rest === ">-" ||
      rest === "|+" ||
      rest === ">+"
    ) {
      const block = readBlock(lines, index, baseIndent);
      index = block.next;
      map.set(key, foldBlock(rest, block.lines));
    } else if (rest === "") {
      const block = readBlock(lines, index, baseIndent);
      index = block.next;
      const nonEmpty = block.lines.filter(
        (entry) => entry.trim() !== "" && !entry.trim().startsWith("#"),
      );
      if (nonEmpty.length === 0) {
        map.set(key, null);
      } else if (nonEmpty.every((entry) => entry.trim().startsWith("- ") || entry.trim() === "-")) {
        map.set(
          key,
          nonEmpty.map((entry) => scalar(entry.trim().slice(1))),
        );
      } else {
        const inner = parseMapLines(block.lines, Math.min(...nonEmpty.map(indentOf)));
        if (!inner.ok) return inner;
        map.set(key, Object.fromEntries(inner.value));
      }
    } else {
      map.set(key, scalar(rest));
    }
  }
  return ok(map);
}

/** 머리말이 있으면 읽고, 없으면 `hasFrontmatter: false`와 원문 전체를 본문으로 돌려준다 */
export function parseDocument(source: string): Result<ParsedDocument, FrontmatterError> {
  const text = stripBom(source);
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n") && normalized !== "---") {
    return ok({ frontmatter: new Map(), body: text, hasFrontmatter: false });
  }
  const lines = normalized.split("\n");
  let close = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trimEnd() === "---") {
      close = index;
      break;
    }
  }
  if (close === -1) {
    return err({ kind: "invalid_frontmatter", message: "frontmatter is not closed" });
  }
  const parsed = parseMapLines(lines.slice(1, close), 0);
  if (!parsed.ok) return parsed;
  const body = lines.slice(close + 1).join("\n");
  return ok({ frontmatter: parsed.value, body, hasFrontmatter: true });
}

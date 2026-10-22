import { parse } from "yaml";
import { err, ok, type Result } from "@xeon/contracts";

// pi `coding-agent/src/utils/frontmatter.ts`(커밋 cdaf6c2) 포크(L1.agents.plan §4, AG-9).
// 바꾼 점: stripBom을 파일 안 한 줄로 옮겼고, yaml 예외를 Result로 돌려주며, frontmatter는 unknown으로 둔다
// (검증은 AgentDefinitionSchema의 몫). stripFrontmatter는 쓰지 않아 지웠다.

export interface ParsedFrontmatter {
  /** YAML 문서를 파싱한 값. 프런트매터가 없거나 비어 있으면 `{}` */
  readonly frontmatter: unknown;
  readonly body: string;
}

export interface FrontmatterError {
  readonly kind: "yaml_invalid";
  readonly message: string;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function extractFrontmatter(content: string): { yamlString: string | null; body: string } {
  const normalized = normalizeNewlines(content.startsWith("﻿") ? content.slice(1) : content);
  if (!normalized.startsWith("---")) return { yamlString: null, body: normalized };
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return { yamlString: null, body: normalized };
  return { yamlString: normalized.slice(4, endIndex), body: normalized.slice(endIndex + 4).trim() };
}

/** 문서 맨 앞 `---` 블록을 YAML로 읽는다. YAML 오류는 `yaml_invalid`로 돌려준다 */
export function parseFrontmatter(content: string): Result<ParsedFrontmatter, FrontmatterError> {
  const { yamlString, body } = extractFrontmatter(content);
  if (yamlString === null || yamlString === "") return ok({ frontmatter: {}, body });
  try {
    const parsed: unknown = parse(yamlString);
    return ok({ frontmatter: parsed ?? {}, body });
  } catch (error) {
    // yaml 라이브러리는 문법 오류를 던진다. 정의 파일 하나의 오류는 예상 가능한 실패라 Result로 바꾼다(TY-11).
    return err({
      kind: "yaml_invalid",
      message: error instanceof Error ? error.message : "invalid YAML front matter",
    });
  }
}

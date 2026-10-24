import type { CancelScope, FileError } from "@xeon/contracts/services";
import type { CommandFiles } from "../../ports/command-files.ts";

// XEON-PATCH: P1
/** 파일 하나를 읽거나 해석하지 못했다는 경고. pi의 `ResourceDiagnostic`에 해당한다 */
export interface CommandDiagnostic {
  readonly type: "warning";
  readonly message: string;
  readonly path: string;
}

// XEON-PATCH: P2
/** 명령 파일 하나. pi의 `PromptTemplate`에서 출처 정보를 빼고 앞머리 `args`의 원본을 더했다 */
export interface PromptTemplate {
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly content: string;
  /** 앞머리 `args` 필드의 해석 전 값. 검사는 `commands/loader.ts`가 한다 */
  readonly rawArgs: unknown;
  /** 템플릿 파일의 경로 */
  readonly filePath: string;
}

/**
 * Parse command arguments respecting quoted strings (bash-style)
 * Returns array of arguments
 */
export function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  // XEON-PATCH: P3
  for (const char of argsString) {
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}

/**
 * Substitute argument placeholders in template content
 * Supports:
 * - $1, $2, ... for positional args
 * - $@ and $ARGUMENTS for all args
 * - ${N:-default} for positional arg N with default when missing/empty
 * - ${@:-default} and ${ARGUMENTS:-default} for all args with a default when empty
 * - ${@:N} for args from Nth onwards (bash-style slicing)
 * - ${@:N:L} for L args starting from Nth
 *
 * Note: Replacement happens on the template string only. Argument and default values
 * containing patterns like $1, $@, or $ARGUMENTS are NOT recursively substituted.
 */
export function substituteArgs(content: string, args: string[]): string {
  const allArgs = args.join(" ");

  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    // XEON-PATCH: P3
    (
      _match: string,
      defaultTarget: string | undefined,
      defaultValue: string | undefined,
      sliceStart: string | undefined,
      sliceLength: string | undefined,
      simple: string | undefined,
    ) => {
      if (defaultTarget) {
        const value =
          defaultTarget === "@" || defaultTarget === "ARGUMENTS"
            ? allArgs
            : args[parseInt(defaultTarget, 10) - 1];
        return value ? value : (defaultValue ?? "");
      }

      if (sliceStart) {
        let start = parseInt(sliceStart, 10) - 1; // Convert to 0-indexed (user provides 1-indexed)
        // Treat 0 as 1 (bash convention: args start at 1)
        if (start < 0) start = 0;

        if (sliceLength) {
          const length = parseInt(sliceLength, 10);
          return args.slice(start, start + length).join(" ");
        }
        return args.slice(start).join(" ");
      }

      if (simple === "ARGUMENTS" || simple === "@") {
        return allArgs;
      }

      const index = parseInt(simple ?? "", 10) - 1;
      return args[index] ?? "";
    },
  );
}

// XEON-PATCH: P4
const stripBom = (value: string): string => (value.startsWith("﻿") ? value.slice(1) : value);

const normalizeNewlines = (value: string): string =>
  value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const extractFrontmatter = (content: string): { yamlString: string | null; body: string } => {
  const normalized = normalizeNewlines(stripBom(content));

  if (!normalized.startsWith("---")) {
    return { yamlString: null, body: normalized };
  }

  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { yamlString: null, body: normalized };
  }

  return {
    yamlString: normalized.slice(4, endIndex),
    body: normalized.slice(endIndex + 4).trim(),
  };
};

// XEON-PATCH: P4
/** 앞머리(YAML)와 본문을 나눈다. YAML이 매핑이 아니거나 해석되지 않으면 던진다 */
function parseFrontmatter(content: string): {
  frontmatter: Readonly<Record<string, unknown>>;
  body: string;
} {
  const { yamlString, body } = extractFrontmatter(content);
  if (!yamlString) {
    return { frontmatter: {}, body };
  }
  const parsed: unknown = Bun.YAML.parse(yamlString);
  if (parsed === null || parsed === undefined) return { frontmatter: {}, body };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("the frontmatter is not a mapping");
  }
  return { frontmatter: Object.fromEntries(Object.entries(parsed)), body };
}

// XEON-PATCH: P1
function loadTemplateFromContent(
  filePath: string,
  rawContent: string,
): { template: PromptTemplate | null; diagnostics: CommandDiagnostic[] } {
  const diagnostics: CommandDiagnostic[] = [];
  let frontmatter: Readonly<Record<string, unknown>>;
  let body: string;
  try {
    ({ frontmatter, body } = parseFrontmatter(rawContent));
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to parse prompt template file";
    diagnostics.push({ type: "warning", message, path: filePath });
    return { template: null, diagnostics };
  }

  const name = (filePath.split(/[\\/]/).at(-1) ?? "").replace(/\.md$/, "");

  // Get description from frontmatter or first non-empty line
  let description =
    typeof frontmatter["description"] === "string" ? frontmatter["description"] : "";
  if (!description) {
    const firstLine = body.split("\n").find((line) => line.trim());
    if (firstLine) {
      // Truncate if too long
      description = firstLine.slice(0, 60);
      if (firstLine.length > 60) description += "...";
    }
  }

  const hint = frontmatter["argument-hint"];
  const argumentHint = typeof hint === "string" ? hint : undefined;
  return {
    template: {
      name,
      description,
      ...(argumentHint && { argumentHint }),
      content: body,
      // XEON-PATCH: P5
      rawArgs: frontmatter["args"],
      filePath,
    },
    diagnostics,
  };
}

export interface LoadedTemplates {
  readonly templates: PromptTemplate[];
  readonly diagnostics: CommandDiagnostic[];
}

function warning(path: string, error: FileError): CommandDiagnostic {
  return { type: "warning", message: error.message, path };
}

// XEON-PATCH: P1
/**
 * Scan a directory for .md files (non-recursive) and load them as prompt templates.
 * 디렉터리가 없으면 빈 결과다. 파일 하나가 읽히지 않거나 해석되지 않으면 그 파일만 건너뛰고 진단을 남긴다.
 */
export async function loadTemplatesFromDir(
  files: CommandFiles,
  dir: string,
  context: CancelScope,
): Promise<LoadedTemplates> {
  const templates: PromptTemplate[] = [];
  const diagnostics: CommandDiagnostic[] = [];

  const entries = await files.listDir(dir, context);
  if (!entries.ok) {
    if (entries.error.code !== "not_found" && entries.error.code !== "not_directory") {
      diagnostics.push(warning(dir, entries.error));
    }
    return { templates, diagnostics };
  }

  const candidates = entries.value
    .filter((entry) => entry.kind !== "directory" && entry.name.endsWith(".md"))
    .toSorted((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const read = await Promise.all(
    candidates.map(async (entry) => ({
      entry,
      content: await files.readTextFile(entry.path, context),
    })),
  );
  for (const { entry, content } of read) {
    if (!content.ok) {
      // 끊어진 심볼릭 링크나 디렉터리를 가리키는 링크는 pi처럼 조용히 건너뛴다
      if (entry.kind === "symlink") continue;
      diagnostics.push(warning(entry.path, content.error));
      continue;
    }
    const result = loadTemplateFromContent(entry.path, content.value);
    if (result.template) templates.push(result.template);
    diagnostics.push(...result.diagnostics);
  }

  return { templates, diagnostics };
}

// XEON-PATCH: P6
/**
 * 입력이 `/이름 인자` 모양이면 이름과 인자 문자열을 돌려준다. pi의 `expandPromptTemplate`가 쓰던 구문 분해만 남겼다.
 * 템플릿 고르기(출처 우선순위)와 치환은 호출자가 한다.
 */
export function parseCommandLine(text: string): { name: string; argsString: string } | undefined {
  if (!text.startsWith("/")) return undefined;

  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return undefined;

  return { name: match[1] ?? "", argsString: match[2] ?? "" };
}

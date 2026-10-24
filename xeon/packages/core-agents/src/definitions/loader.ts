// 정의 파일 로더(L1.agents.spec §4.9, AG-9). M2는 확장 매니페스트 `components.agents`의 파일을 읽는다.
// 프로젝트·사용자 디렉터리 탐색과 우선순위 덮어쓰기는 2차다. 잘못된 파일은 그 정의만 빼고 진단으로 남긴다.
import { parse } from "@xeon/contracts";
import {
  AgentDefinitionSchema,
  type AgentDefinition,
  type AgentDefinitionSource,
} from "@xeon/contracts/services";
import { parseFrontmatter } from "./frontmatter.ts";

export interface DefinitionDiagnostic {
  readonly code: "agents.definition_invalid";
  readonly path: string;
  readonly message: string;
}

export interface LoadedDefinitions {
  readonly definitions: readonly AgentDefinition[];
  readonly diagnostics: readonly DefinitionDiagnostic[];
}

export interface LoadDefinitionsInput {
  readonly paths: readonly string[];
  /** 경로의 파일 내용. 없으면 null */
  readonly readText: (path: string) => Promise<string | null>;
  /** 정의 출처를 경로로 만든다 */
  readonly sourceOf: (path: string) => AgentDefinitionSource;
}

/** 파일 하나를 정의로 읽는다. 프런트매터는 name·description·tools·model·permissions, 본문이 prompt다 */
export function parseDefinitionFile(
  path: string,
  content: string,
  source: AgentDefinitionSource,
): { readonly definition: AgentDefinition } | { readonly diagnostic: DefinitionDiagnostic } {
  const parsed = parseFrontmatter(content);
  if (!parsed.ok) {
    return {
      diagnostic: { code: "agents.definition_invalid", path, message: parsed.error.message },
    };
  }
  const { frontmatter, body } = parsed.value;
  const record: Readonly<Record<string, unknown>> =
    typeof frontmatter === "object" && frontmatter !== null && !Array.isArray(frontmatter)
      ? Object.fromEntries(Object.entries(frontmatter))
      : {};
  const checked = parse(AgentDefinitionSchema, { ...record, prompt: body });
  if (!checked.ok) {
    const first = checked.error.issues[0];
    return {
      diagnostic: {
        code: "agents.definition_invalid",
        path,
        message:
          first === undefined
            ? "invalid definition"
            : `${first.path === "" ? "/" : first.path} ${first.message}`,
      },
    };
  }
  return { definition: { ...checked.value, source } };
}

/** 경로들을 순서대로 읽는다. 읽을 수 없거나 잘못된 파일은 진단이 되고 나머지는 계속 읽는다 */
export async function loadDefinitionFiles(input: LoadDefinitionsInput): Promise<LoadedDefinitions> {
  const contents = await Promise.all(
    input.paths.map(async (path) => ({ path, text: await input.readText(path) })),
  );
  const definitions: AgentDefinition[] = [];
  const diagnostics: DefinitionDiagnostic[] = [];
  for (const { path, text } of contents) {
    if (text === null) {
      diagnostics.push({
        code: "agents.definition_invalid",
        path,
        message: "file not found or unreadable",
      });
      continue;
    }
    const outcome = parseDefinitionFile(path, text, input.sourceOf(path));
    if ("definition" in outcome) definitions.push(outcome.definition);
    else diagnostics.push(outcome.diagnostic);
  }
  return { definitions, diagnostics };
}

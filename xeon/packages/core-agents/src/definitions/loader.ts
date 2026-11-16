// 정의 파일 로더(L1.agents.spec §4.9, AG-9). M2는 확장 매니페스트 `components.agents`의 파일을 읽는다.
// 프로젝트·사용자 디렉터리 탐색과 우선순위 덮어쓰기는 2차다. 잘못된 파일은 그 정의만 빼고 진단으로 남긴다.
// 은퇴한 권한 모드 `plan`은 값만 무시한다: 정의는 싣고 모드는 지정 없음으로 두고 경고를 남긴다 [결정: 2026-11-15 사용자].
import { parse } from "@fresnel/contracts";
import {
  AgentDefinitionSchema,
  type AgentDefinition,
  type AgentDefinitionSource,
} from "@fresnel/contracts/services";
import { parseFrontmatter } from "./frontmatter.ts";

export interface DefinitionDiagnostic {
  readonly code: "agents.definition_invalid";
  /** `error`는 정의를 뺀 진단이다. `warning`은 정의는 싣고 그 값만 무시했다는 알림이다 */
  readonly severity: "error" | "warning";
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

/**
 * 프런트매터의 `permissions.mode`가 은퇴한 `plan`이면 그 칸만 뺀 기록을 돌려준다. 스키마가 `plan`을 받지 않으므로 검증 전에 뺀다.
 * 다른 값과 모드가 없는 기록은 그대로다.
 */
function withoutRetiredPlanMode(record: Readonly<Record<string, unknown>>): {
  readonly record: Readonly<Record<string, unknown>>;
  readonly dropped: boolean;
} {
  const permissions = record["permissions"];
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return { record, dropped: false };
  }
  if (!("mode" in permissions) || permissions.mode !== "plan") {
    return { record, dropped: false };
  }
  const rest: Record<string, unknown> = Object.fromEntries(
    Object.entries(permissions).filter(([key]) => key !== "mode"),
  );
  return { record: { ...record, permissions: rest }, dropped: true };
}

/**
 * 파일 하나를 정의로 읽는다. 프런트매터는 name·description·tools·model·permissions, 본문이 prompt다.
 * 정의가 나오면 경고(무시한 값)가 `diagnostics`에 함께 온다. 정의를 빼는 문제는 `diagnostic` 하나다.
 */
export function parseDefinitionFile(
  path: string,
  content: string,
  source: AgentDefinitionSource,
):
  | {
      readonly definition: AgentDefinition;
      readonly diagnostics: readonly DefinitionDiagnostic[];
    }
  | { readonly diagnostic: DefinitionDiagnostic } {
  const parsed = parseFrontmatter(content);
  if (!parsed.ok) {
    return {
      diagnostic: {
        code: "agents.definition_invalid",
        severity: "error",
        path,
        message: parsed.error.message,
      },
    };
  }
  const { frontmatter, body } = parsed.value;
  const record: Readonly<Record<string, unknown>> =
    typeof frontmatter === "object" && frontmatter !== null && !Array.isArray(frontmatter)
      ? Object.fromEntries(Object.entries(frontmatter))
      : {};
  const retired = withoutRetiredPlanMode(record);
  const checked = parse(AgentDefinitionSchema, { ...retired.record, prompt: body });
  if (!checked.ok) {
    const first = checked.error.issues[0];
    return {
      diagnostic: {
        code: "agents.definition_invalid",
        severity: "error",
        path,
        message:
          first === undefined
            ? "invalid definition"
            : `${first.path === "" ? "/" : first.path} ${first.message}`,
      },
    };
  }
  const diagnostics: DefinitionDiagnostic[] = retired.dropped
    ? [
        {
          code: "agents.definition_invalid",
          severity: "warning",
          path,
          message:
            'permissions.mode "plan" is retired and ignored; the definition loads without a mode',
        },
      ]
    : [];
  return { definition: { ...checked.value, source }, diagnostics };
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
        severity: "error",
        path,
        message: "file not found or unreadable",
      });
      continue;
    }
    const outcome = parseDefinitionFile(path, text, input.sourceOf(path));
    if ("definition" in outcome) {
      definitions.push(outcome.definition);
      diagnostics.push(...outcome.diagnostics);
    } else {
      diagnostics.push(outcome.diagnostic);
    }
  }
  return { definitions, diagnostics };
}

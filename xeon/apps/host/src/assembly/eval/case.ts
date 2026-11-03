import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { Type, type TUnsafe } from "typebox";
import {
  attempt,
  err,
  ok,
  parse,
  type ParseError,
  type Result,
  type SchemaProof,
} from "@fresnel/contracts";

// T-TEST-CASE. 케이스 형식과 규칙 채점(기획서 §6). 케이스는 플러그인 패키지의 `evals/`나 사용자 저장소의 파일이고, 읽는 쪽이 JSON 값으로 풀어 `parseCase`에 넘긴다.
// 채점은 최종 상태(파일, 명령 종료 코드, 정규식), 경로(도구 사용), 상한(비용)이다. 사람 채점과 AI 채점은 하지 않는다.
// 이 모듈은 모델을 부르지 않는다. 실행 결과(`Evidence`)를 받아 판정만 한다.

/** 케이스 유형. `quiet`은 발동하면 안 되는 케이스다(예: 도구 사용 `max: 0`) */
type CaseType = "capability" | "regression" | "quiet";

type Check =
  | { readonly file_exists: string }
  | { readonly file_matches: { readonly path: string; readonly pattern: string } }
  | { readonly command: string; readonly exit?: number }
  | {
      readonly tool_used: { readonly name: string; readonly min?: number; readonly max?: number };
    }
  | { readonly max_cost_usd: number };

export interface EvalCase {
  readonly id: string;
  readonly type: CaseType;
  readonly start?: { readonly workspace?: string };
  readonly prompt: string;
  readonly checks: readonly Check[];
}

const RelativePath = Type.String({ minLength: 1, maxLength: 512 });
const CheckShape = Type.Union([
  Type.Object({ file_exists: RelativePath }, { additionalProperties: false }),
  Type.Object(
    {
      file_matches: Type.Object(
        { path: RelativePath, pattern: Type.String({ minLength: 1, maxLength: 200 }) },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      command: Type.String({ minLength: 1, maxLength: 512 }),
      exit: Type.Optional(Type.Integer({ minimum: 0, maximum: 255 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      tool_used: Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 128 }),
          min: Type.Optional(Type.Integer({ minimum: 0 })),
          max: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object({ max_cost_usd: Type.Number({ minimum: 0 }) }, { additionalProperties: false }),
]);
const CaseShape = Type.Object(
  {
    id: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,95}$" }),
    type: Type.Union([
      Type.Literal("capability"),
      Type.Literal("regression"),
      Type.Literal("quiet"),
    ]),
    start: Type.Optional(
      Type.Object({ workspace: Type.Optional(RelativePath) }, { additionalProperties: false }),
    ),
    prompt: Type.String({ minLength: 1, maxLength: 20_000 }),
    checks: Type.Array(CheckShape, { minItems: 1, maxItems: 64 }),
  },
  { additionalProperties: false },
);
const CaseSchema: TUnsafe<EvalCase> = Type.Unsafe<EvalCase>(
  CaseShape satisfies SchemaProof<EvalCase, typeof CaseShape>,
);

export function parseCase(input: unknown): Result<EvalCase, ParseError> {
  return parse(CaseSchema, input);
}

/** 실행이 남긴 증거. 도구 호출 이름과 비용은 측정 저장소(`call`, Turn 기록)에서, 폴더는 격리된 복사본이다 */
export interface Evidence {
  readonly workspace: string;
  readonly toolCalls: readonly string[];
  readonly costUsd: number;
}

/** 폴더 안에서 명령을 돌려 종료 코드를 돌려준다. 실행 쪽이 격리와 시간 제한을 정해 넘긴다 */
export type CommandRunner = (command: string, cwd: string) => Promise<number>;

interface CheckResult {
  readonly index: number;
  readonly check: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface Grade {
  readonly passed: boolean;
  readonly results: readonly CheckResult[];
}

/** 읽을 수 있는 파일 크기 상한 */
const MAX_FILE_BYTES = 1024 * 1024;

/** 작업 폴더 밖으로 나가는 경로(`..`, 절대 경로)는 undefined */
function insideWorkspace(workspace: string, relativePath: string): string | undefined {
  const root = resolve(workspace);
  const full = resolve(root, relativePath);
  return full === root || full.startsWith(root + sep) ? full : undefined;
}

function readCapped(path: string): Result<string, { readonly kind: "missing" | "too_large" }> {
  const stat = attempt(() => statSync(path));
  if (!stat.ok || !stat.value.isFile()) return err({ kind: "missing" });
  if (stat.value.size > MAX_FILE_BYTES) return err({ kind: "too_large" });
  const text = attempt(() => readFileSync(path, "utf8"));
  return text.ok ? ok(text.value) : err({ kind: "missing" });
}

async function gradeCheck(
  check: Check,
  evidence: Evidence,
  run: CommandRunner,
): Promise<{ readonly name: string; readonly passed: boolean; readonly detail: string }> {
  if ("file_exists" in check) {
    const path = insideWorkspace(evidence.workspace, check.file_exists);
    if (path === undefined)
      return { name: "file_exists", passed: false, detail: "path_outside_workspace" };
    const stat = attempt(() => statSync(path));
    const passed = stat.ok && stat.value.isFile();
    return { name: "file_exists", passed, detail: passed ? "found" : "missing" };
  }
  if ("file_matches" in check) {
    const path = insideWorkspace(evidence.workspace, check.file_matches.path);
    if (path === undefined)
      return { name: "file_matches", passed: false, detail: "path_outside_workspace" };
    const pattern = attempt(() => new RegExp(check.file_matches.pattern));
    if (!pattern.ok) return { name: "file_matches", passed: false, detail: "invalid_pattern" };
    const text = readCapped(path);
    if (!text.ok) return { name: "file_matches", passed: false, detail: text.error.kind };
    const passed = pattern.value.test(text.value);
    return { name: "file_matches", passed, detail: passed ? "matched" : "no_match" };
  }
  if ("command" in check) {
    const expected = check.exit ?? 0;
    const code = await run(check.command, evidence.workspace);
    return {
      name: "command",
      passed: code === expected,
      detail: `exit ${String(code)}, expected ${String(expected)}`,
    };
  }
  if ("tool_used" in check) {
    const { name, min, max } = check.tool_used;
    const count = evidence.toolCalls.filter((called) => called === name).length;
    const passed = count >= (min ?? 0) && (max === undefined || count <= max);
    return { name: "tool_used", passed, detail: `${name} called ${String(count)} times` };
  }
  const passed = evidence.costUsd <= check.max_cost_usd;
  return {
    name: "max_cost_usd",
    passed,
    detail: `cost ${String(evidence.costUsd)} limit ${String(check.max_cost_usd)}`,
  };
}

/** 모든 검사가 통과해야 통과다. 앞 검사가 실패해도 나머지를 돌려 어디가 틀렸는지 다 보인다 */
export async function gradeCase(
  evalCase: EvalCase,
  evidence: Evidence,
  run: CommandRunner,
): Promise<Grade> {
  const results: CheckResult[] = [];
  for (const [index, check] of evalCase.checks.entries()) {
    // eslint-disable-next-line no-await-in-loop -- 명령 검사는 순서대로 돈다
    const graded = await gradeCheck(check, evidence, run);
    results.push({ index, check: graded.name, passed: graded.passed, detail: graded.detail });
  }
  return { passed: results.every((result) => result.passed), results };
}

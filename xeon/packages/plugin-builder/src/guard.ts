import { isAbsolute, relative, resolve } from "node:path";
import type { ToolCallDecision, ToolCallPayload } from "@fresnel/contracts/extensions";

// L3.authoring.spec §4.2 쓰기 범위 가드. 제작 대화가 열려 있는 동안 `tool.call.before`(first)가 쓰는 판정이다.
// `write` 위험 등급 도구는 입력의 경로가 대상 폴더 안이어야 하고, `exec`(셸)는 작업 폴더가 대상 폴더 안이어야 한다.
// 경로를 읽을 수 없는 `write` 호출과 작업 폴더가 없는 `exec` 호출은 막는다(안쪽인지 알 수 없다).
// 한계 [미결]: 셸 명령 문자열 속 절대 경로는 보지 않는다. 작업 폴더가 안쪽이어도 명령이 밖을 쓸 수 있다.

const PATH_KEYS: readonly string[] = ["path", "file_path", "filePath"];
const CWD_KEYS: readonly string[] = ["cwd", "workdir", "workDir"];

function pathsOf(input: Record<string, unknown>, keys: readonly string[]): readonly string[] {
  const found: string[] = [];
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string") found.push(value);
  }
  return found;
}

function isInside(dir: string, target: string): boolean {
  const from = relative(dir, resolve(dir, target));
  return from === "" || (!from.startsWith("..") && !isAbsolute(from));
}

/** 대상 폴더 밖을 쓰는 호출이면 막는 결정, 아니면 undefined. `dir`은 절대 경로다 */
export function authoringWriteGuard(
  dir: string,
  payload: Pick<ToolCallPayload, "toolName" | "input" | "risk">,
): ToolCallDecision | undefined {
  if (payload.risk !== "write" && payload.risk !== "exec") return undefined;
  const input: Record<string, unknown> = { ...payload.input };
  const where = payload.risk === "write" ? pathsOf(input, PATH_KEYS) : pathsOf(input, CWD_KEYS);
  const label = payload.risk === "write" ? "write target" : "working folder";
  if (where.length === 0)
    return { block: true, reason: `authoring: cannot tell the ${label} of ${payload.toolName}` };
  const outside = where.find((path) => !isInside(dir, path));
  if (outside !== undefined)
    return {
      block: true,
      reason: `authoring: ${payload.toolName} would write outside the target folder (${outside})`,
    };
  return undefined;
}

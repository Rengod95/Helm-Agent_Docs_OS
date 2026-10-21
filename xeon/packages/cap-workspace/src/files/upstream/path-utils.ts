// XEON-PATCH: P1
import type { CancelScope as Context, ExecutionEnv } from "@xeon/contracts/services";
// XEON-PATCH: P2
import { getOrThrow } from "../../upstream/get-or-throw.ts";

const UNICODE_SPACES = /[  -   　]/g;
const NARROW_NO_BREAK_SPACE = " ";

// XEON-PATCH: P8
export function normalizeToolPath(path: string): string {
  const normalized = path.replace(UNICODE_SPACES, " ");
  return normalized.startsWith("@") ? normalized.slice(1) : normalized;
}

// XEON-PATCH: P8
type PathEnv = Pick<ExecutionEnv, "absolutePath" | "exists">;

export async function resolveToolPath(
  env: Pick<PathEnv, "absolutePath">,
  path: string,
  context: Context,
): Promise<string> {
  return getOrThrow(await env.absolutePath(normalizeToolPath(path), context));
}

export async function resolveReadToolPath(
  env: PathEnv,
  path: string,
  context: Context,
): Promise<string> {
  const resolved = await resolveToolPath(env, path, context);
  const variants = [
    resolved,
    resolved.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`),
    resolved.normalize("NFD"),
    resolved.replace(/'/g, "’"),
    resolved.normalize("NFD").replace(/'/g, "’"),
  ];

  for (const variant of new Set(variants)) {
    // oxlint-disable-next-line no-await-in-loop -- 원본 포크 코드의 모양을 유지한다 (eng.typescript.guide §1 포크 코드)
    if (getOrThrow(await env.exists(variant, context))) return variant;
  }
  return resolved;
}

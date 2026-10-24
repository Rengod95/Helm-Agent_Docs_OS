// XEON-PATCH: P10
import { eachAsync } from "@xeon/contracts";
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

  // XEON-PATCH: P10
  const found = await eachAsync(new Set(variants), async (variant) =>
    getOrThrow(await env.exists(variant, context)) ? { value: variant } : undefined,
  );
  return found?.value ?? resolved;
}

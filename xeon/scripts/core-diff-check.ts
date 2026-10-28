#!/usr/bin/env bun
// S1 diff check (product.vision.spec S1, product.scope.spec 4.4 M3a). Adding the learning group must change zero lines in
// contracts, ext-host, platform-* and core-*. Given a base commit, this fails when the change set base..<head> touches one
// of those paths.
//   core-diff-check <base> [--head <ref>]
// Exit codes: 0 no protected path changed, 1 at least one protected path changed (listed on stdout),
// 2 environment (git missing, not a repository, base or head cannot be resolved).
import { parseArgs } from "node:util";

/** Protected path patterns, relative to the repository root. `*` matches within one path segment. */
export const PROTECTED_PATHS: readonly string[] = [
  "xeon/packages/contracts/",
  "xeon/packages/ext-host/",
  "xeon/packages/platform-*/",
  "xeon/packages/core-*/",
];

function segmentMatches(pattern: string, segment: string): boolean {
  if (!pattern.includes("*")) return pattern === segment;
  const star = pattern.indexOf("*");
  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  return (
    segment.length >= head.length + tail.length &&
    segment.startsWith(head) &&
    segment.endsWith(tail)
  );
}

/** True when `path` lies under the directory pattern (every pattern segment matches the path's leading segments). */
export function isProtected(path: string, pattern: string): boolean {
  const patternSegments = pattern.split("/").filter((segment) => segment !== "");
  const pathSegments = path.split("/");
  if (pathSegments.length <= patternSegments.length) return false;
  return patternSegments.every((segment, index) => {
    const actual = pathSegments[index];
    return actual !== undefined && segmentMatches(segment, actual);
  });
}

/** The changed paths that fall under a protected directory, in the given order. */
export function violations(
  changed: readonly string[],
  patterns: readonly string[] = PROTECTED_PATHS,
): readonly string[] {
  return changed.filter((path) => patterns.some((pattern) => isProtected(path, pattern)));
}

/** Splits `git diff --name-only` output into paths. */
export function parseNameList(output: string): readonly string[] {
  return output.split("\n").filter((line) => line.trim() !== "");
}

interface GitRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function git(cwd: string, args: readonly string[]): Promise<GitRun | Error> {
  try {
    const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { code, out, err };
  } catch (cause) {
    return cause instanceof Error ? cause : new Error(String(cause));
  }
}

export type CheckOutcome =
  | { readonly kind: "clean"; readonly changed: number }
  | { readonly kind: "violated"; readonly paths: readonly string[]; readonly changed: number }
  | { readonly kind: "environment"; readonly message: string };

/** Runs the check in the repository that contains `cwd`. */
export async function checkCoreDiff(
  cwd: string,
  base: string,
  head: string,
): Promise<CheckOutcome> {
  const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top instanceof Error)
    return { kind: "environment", message: `git cannot run: ${top.message}` };
  if (top.code !== 0) return { kind: "environment", message: "not inside a git repository" };
  const root = top.out.trim();
  const resolved = await Promise.all(
    [base, head].map(async (ref) => ({
      ref,
      found: await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]),
    })),
  );
  const unresolved = resolved.find(({ found }) => found instanceof Error || found.code !== 0);
  if (unresolved !== undefined) {
    return { kind: "environment", message: `cannot resolve ${unresolved.ref} to a commit` };
  }
  // Three dots: the change set of `head` since it left `base`, so later changes on `base` do not count.
  const diff = await git(root, ["diff", "--name-only", "--no-renames", `${base}...${head}`]);
  if (diff instanceof Error)
    return { kind: "environment", message: `git cannot run: ${diff.message}` };
  if (diff.code !== 0) {
    return { kind: "environment", message: `git diff failed: ${diff.err.trim()}` };
  }
  const changed = parseNameList(diff.out);
  const paths = violations(changed);
  return paths.length === 0
    ? { kind: "clean", changed: changed.length }
    : { kind: "violated", paths, changed: changed.length };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: { head: { type: "string" } },
    allowPositionals: true,
  });
  const [base] = positionals;
  if (base === undefined || positionals.length > 1) {
    process.stderr.write("usage: core-diff-check <base> [--head <ref>]\n");
    process.exit(2);
  }
  const outcome = await checkCoreDiff(process.cwd(), base, values.head ?? "HEAD");
  if (outcome.kind === "clean") {
    process.stdout.write(
      `core-diff-check: ok, ${String(outcome.changed)} changed paths, none under contracts, ext-host, platform-*, core-*\n`,
    );
    process.exit(0);
  }
  if (outcome.kind === "violated") {
    process.stdout.write(
      `core-diff-check: ${String(outcome.paths.length)} protected paths changed (S1 needs zero):\n${outcome.paths.map((path) => `  ${path}`).join("\n")}\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`core-diff-check: ${outcome.message}\n`);
  process.exit(2);
}

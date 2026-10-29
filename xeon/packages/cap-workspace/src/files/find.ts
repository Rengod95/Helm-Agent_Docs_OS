import type { CancelScope } from "@xeon/contracts/services";
import type { WorkspaceDeps } from "../deps.ts";
import { WorkspaceFailure } from "../errors.ts";
import { resolveWorkspacePath } from "../roots.ts";
import { capEntries, pageEntries } from "../truncate/paging.ts";
import type { FilesApi } from "./api.ts";
import { pathsOf, rgBinary, rgFailure, runRg, visibleFiles } from "./rg.ts";

// L2.workspace.spec §3.2 find, §4.3, §4.5, §10 미결 6. 엔진은 rg --files --glob이다(fd를 내려받지 않는다).
// 실행: rg --files --no-config --no-require-git --sort path --glob <패턴> --no-messages -- .
// 그 결과를 글로브 없는 같은 목록(visibleFiles)과 교차한다. rg는 --glob으로 고른 파일을 .gitignore와 숨김 규칙보다 먼저 포함한다.
// glob 의미는 rg의 --glob이다(gitignore 식). 슬래시가 없는 패턴은 어느 깊이의 같은 이름과도 맞고(`*.ts`),
// 슬래시가 있으면 기준 디렉터리에 상대적이다(`src/*.ts`). `**`는 여러 디렉터리를 가로지른다(`**/*.spec.ts`).
// 시험 test/find.test.ts와 test/rg.int.test.ts가 이 의미를 고정한다.

type FindMethod = FilesApi["find"];

const encoder = new TextEncoder();

export function createFind(deps: WorkspaceDeps): FindMethod {
  return async (input, options) => {
    const context: CancelScope = { abortSignal: options?.signal };
    const settings = deps.settings(options?.context?.threadId);
    const requested = input.path ?? ".";
    const resolved = await resolveWorkspacePath(deps.roots, requested, "read", context);
    if (!resolved.exists) {
      throw new WorkspaceFailure("not_found", `Path not found: ${requested}`);
    }
    const info = await deps.env.fileInfo(resolved.canonical, context);
    if (!info.ok) throw info.error;
    if (info.value.kind !== "directory") {
      throw new WorkspaceFailure("invalid_input", `Not a directory: ${requested}`);
    }
    const binary = await rgBinary(deps, settings.grep.rgPath, context);
    const run = await runRg(
      deps.env,
      binary,
      [
        "--files",
        "--no-config",
        "--no-require-git",
        "--sort",
        "path",
        "--glob",
        input.pattern,
        "--no-messages",
        "--",
        ".",
      ],
      resolved.canonical,
      context,
    );
    if (run.exitCode !== 0 && run.exitCode !== 1) {
      throw rgFailure(run, { pattern: input.pattern });
    }
    // 글로브 결과는 .gitignore와 숨김 규칙을 통과한 파일로 좁힌다(rg --glob은 그 규칙보다 우선한다, rg.ts visibleFiles)
    const candidates = pathsOf(run.stdout);
    const visible =
      candidates.length === 0
        ? new Set<string>()
        : await visibleFiles(deps.env, binary, resolved.canonical, context);
    const paths = candidates.filter((path) => visible.has(path));
    const capped = capEntries(paths, {
      limit: input.limit ?? settings.find.maxResults,
      maxBytes: settings.read.maxBytes,
      counts: () => true,
      bytesOf: (path) => encoder.encode(path).length + 1,
    });
    return {
      root: resolved.canonical,
      paths: [...capped.kept],
      ...(capped.cutBy === undefined
        ? {}
        : { truncated: pageEntries(capped.cutBy, capped.shown, capped.total) }),
    };
  };
}

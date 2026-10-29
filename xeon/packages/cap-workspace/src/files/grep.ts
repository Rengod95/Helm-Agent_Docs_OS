import type { CancelScope } from "@xeon/contracts/services";
import type { WorkspaceDeps } from "../deps.ts";
import { WorkspaceFailure } from "../errors.ts";
import { resolveWorkspacePath } from "../roots.ts";
import { capEntries, pageEntries } from "../truncate/paging.ts";
import type { FilesApi } from "./api.ts";
import {
  cutLine,
  parseRgJson,
  rgBinary,
  rgFailure,
  runRg,
  unprotected,
  visibleFiles,
  type RgLine,
} from "./rg.ts";

// L2.workspace.spec §3.2 grep, §4.3 검색 기준 디렉터리 검사, §4.5 항목·바이트 절단과 긴 줄 자르기.
// 실행: rg --json --no-config --no-require-git --sort path -e <패턴> [-i] [-F] [-C n] [--glob <glob>] --no-messages -- .
// --glob이 있으면 결과를 .gitignore와 숨김 규칙을 통과한 파일로 좁힌다(visibleFiles).
// cwd는 검색 기준 디렉터리의 정규 경로다. 그래서 출력 경로는 기준 상대 경로가 된다.
// --no-require-git: rg는 git 저장소 밖에서 .gitignore를 읽지 않는다. spec §3.2 ".gitignore를 따른다"를 어디서나 지키려고 켠다.
// 심볼릭 링크는 따라가지 않는다(--follow 없음). 숨김 파일은 rg 기본대로 건너뛴다. 정렬은 경로의 바이트 순이다.

type GrepMethod = FilesApi["grep"];
type GrepInput = Parameters<GrepMethod>[0];

const encoder = new TextEncoder();

function grepArgs(input: GrepInput, contextLines: number): string[] {
  return [
    "--json",
    "--no-config",
    "--no-require-git",
    "--sort",
    "path",
    "-e",
    input.pattern,
    ...(input.ignoreCase === true ? ["-i"] : []),
    ...(input.literal === true ? ["-F"] : []),
    ...(contextLines > 0 ? ["-C", String(contextLines)] : []),
    ...(input.glob === undefined ? [] : ["--glob", input.glob]),
    "--no-messages",
    "--",
    ".",
  ];
}

/** 남긴 일치 뒤의 문맥 줄 가운데 짝 없는 것을 뗀다. 잘린 일치의 앞 문맥 줄이 맨 뒤에 남을 수 있다 */
function trimTrailingContext(lines: readonly RgLine[], contextLines: number): RgLine[] {
  const lastMatch = lines.findLast((line) => line.kind === "match");
  let end = lines.length;
  while (end > 0) {
    const tail = lines[end - 1];
    if (tail === undefined || tail.kind === "match") break;
    // 마지막 남긴 일치에서 contextLines 줄 안의 문맥만 그 일치의 뒤 문맥이다
    if (lastMatch !== undefined && tail.line <= lastMatch.line + contextLines) break;
    end--;
  }
  return lines.slice(0, end);
}

export function createGrep(deps: WorkspaceDeps): GrepMethod {
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
    const contextLines = input.context ?? 0;
    const binary = await rgBinary(deps, settings.grep.rgPath, context);
    const run = await runRg(
      deps.env,
      binary,
      grepArgs(input, contextLines),
      resolved.canonical,
      context,
    );
    // 종료 코드 1은 일치 없음이라 정상 결과다
    if (run.exitCode !== 0 && run.exitCode !== 1) {
      throw rgFailure(run, {
        pattern: input.pattern,
        ...(input.glob === undefined ? {} : { glob: input.glob }),
      });
    }
    // 글로브가 있으면 .gitignore와 숨김 규칙을 통과한 파일의 줄만 남긴다(rg --glob은 그 규칙보다 우선한다, rg.ts visibleFiles)
    const visible =
      input.glob === undefined
        ? undefined
        : await visibleFiles(deps.env, binary, resolved.canonical, context);
    const allowed = unprotected(deps, resolved.canonical);
    const lines = parseRgJson(run.stdout)
      .filter((line) => visible === undefined || visible.has(line.path))
      .filter((line) => allowed(line.path))
      .map((line): RgLine => ({
        kind: line.kind,
        path: line.path,
        line: line.line,
        text: cutLine(line.text, settings.grep.maxLineLength),
      }));
    // 설정은 기본값이다. 호출자가 `limit`을 주면 그 값이 앞선다(spec §4.5)
    const capped = capEntries(lines, {
      limit: input.limit ?? settings.grep.maxMatches,
      maxBytes: settings.read.maxBytes,
      counts: (line) => line.kind === "match",
      bytesOf: (line) => encoder.encode(`${line.path}:${line.line}: ${line.text}`).length + 1,
    });
    const matches = trimTrailingContext(capped.kept, contextLines);
    return {
      root: resolved.canonical,
      matches,
      ...(capped.cutBy === undefined
        ? {}
        : { truncated: pageEntries(capped.cutBy, capped.shown, capped.total) }),
    };
  };
}

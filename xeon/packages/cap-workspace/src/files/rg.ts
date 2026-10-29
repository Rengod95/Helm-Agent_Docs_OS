import { parse, parseJson } from "@xeon/contracts";
import type { CancelScope } from "@xeon/contracts/services";
import { Type, type Static } from "typebox";
import type { WorkspaceDeps } from "../deps.ts";
import type { WorkspaceEnv } from "../env.ts";
import { WorkspaceFailure } from "../errors.ts";

// L2.workspace.spec §3.2 grep·find, §4.2(샌드박스 밖), §5 10번. ripgrep은 `xeon.exec`에 argv 배열로 넘긴다(셸 문자열을 만들지 않는다).
// 샌드박스(xeon.sandbox)는 거치지 않는다. 이 패키지가 고른 인자로만 실행하고, 검색 경로는 `resolveWorkspacePath`가 검사한다.

/** `rg`의 실행 결과. 출력은 전부 모은다. 한도는 호출자가 건다 */
export interface RgRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** `rg --json`의 일치 또는 문맥 줄 하나. `grep`의 `matches` 항목과 같은 모양이다 */
export interface RgLine {
  readonly kind: "match" | "context";
  /** 검색 기준 디렉터리 상대 경로 */
  readonly path: string;
  readonly line: number;
  /** 줄 끝 개행을 뗀 본문 */
  readonly text: string;
}

function rgMissing(message: string): WorkspaceFailure {
  return new WorkspaceFailure("unavailable", `ripgrep(rg) is not available: ${message}`, {
    detail: { reason: "rg_missing" },
  });
}

/** `rg`의 실행 파일 경로. 찾지 못하면 unavailable(detail.reason: "rg_missing")이다(spec §5 10번) */
export async function rgBinary(
  deps: WorkspaceDeps,
  rgPath: string,
  context: CancelScope,
): Promise<string> {
  if (deps.rg === undefined) throw rgMissing("no ripgrep resolver is configured");
  const resolved = await deps.rg(rgPath, context.abortSignal);
  if (resolved.ok) return resolved.value;
  if (resolved.error.kind === "cancelled") {
    throw new WorkspaceFailure("aborted", resolved.error.message);
  }
  throw rgMissing(resolved.error.message);
}

/** `rg`를 argv 배열로 실행하고 stdout과 stderr를 모은다. 띄우지 못하면 rg_missing이다 */
export async function runRg(
  env: WorkspaceEnv,
  binary: string,
  args: readonly string[],
  cwd: string,
  context: CancelScope,
): Promise<RgRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const result = await env.exec(
    [binary, ...args],
    {
      cwd,
      onOutput: (text, _context, info) => {
        if (info.stream === "stderr") stderr.push(text);
        else stdout.push(text);
      },
    },
    context,
  );
  if (!result.ok) {
    if (result.error.code === "spawn_error") throw rgMissing(result.error.message);
    throw result.error;
  }
  return {
    exitCode: result.value.exitCode,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

/**
 * 종료 코드 0(일치)과 1(일치 없음)이 아닌 실행을 실패로 바꾼다. 패턴 문법 오류는 `pattern_invalid`,
 * 그 밖의 오류는 `internal`이다. rg는 정규식 오류를 `regex parse error`, glob 오류를 `error parsing glob`으로 보고한다.
 */
export function rgFailure(
  run: RgRun,
  given: { readonly pattern: string; readonly glob?: string },
): WorkspaceFailure {
  const message = run.stderr.trim();
  if (message.includes("regex parse error")) {
    return new WorkspaceFailure("pattern_invalid", message, {
      detail: { syntax: "regex", pattern: given.pattern },
    });
  }
  if (message.includes("error parsing glob")) {
    return new WorkspaceFailure("pattern_invalid", message, {
      detail: { syntax: "glob", pattern: given.glob ?? given.pattern },
    });
  }
  return new WorkspaceFailure("internal", `ripgrep exited with ${run.exitCode}: ${message}`);
}

/** rg가 검색 경로 `.` 아래를 `./`로 시작해 보여 준다. 기준 디렉터리 상대 경로로 바꾼다 */
function relativeRgPath(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path;
}

/** `rg --files`처럼 한 줄에 경로 하나를 내는 출력을 기준 디렉터리 상대 경로 목록으로 바꾼다 */
export function pathsOf(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map(relativeRgPath);
}

/**
 * `.gitignore`와 숨김 규칙을 통과한 파일의 집합(기준 디렉터리 상대 경로). 글로브 없이 한 번 더 걸어 얻는다.
 * rg는 `--glob`으로 고른 파일을 이 규칙보다 먼저 포함한다(글로브가 예외 규칙이다). 그래서 글로브 결과는 이 집합과
 * 교차해야 `.gitignore`와 숨김 규칙이 지켜진다. 시험: test/rg.int.test.ts "a glob does not bring back ignored or hidden files".
 */
export async function visibleFiles(
  env: WorkspaceEnv,
  binary: string,
  cwd: string,
  context: CancelScope,
): Promise<ReadonlySet<string>> {
  const run = await runRg(
    env,
    binary,
    ["--files", "--no-config", "--no-require-git", "--sort", "path", "--no-messages", "--", "."],
    cwd,
    context,
  );
  if (run.exitCode !== 0 && run.exitCode !== 1) throw rgFailure(run, { pattern: "" });
  return new Set(pathsOf(run.stdout));
}

/** 글자(코드 포인트) 수로 자른다. 줄 끝 표시는 덧붙이지 않는다(spec §4.5) */
export function cutLine(text: string, maxChars: number): string {
  const chars = Array.from(text);
  return chars.length > maxChars ? chars.slice(0, maxChars).join("") : text;
}

const RgText = Type.Union([
  Type.Object({ text: Type.String() }),
  Type.Object({ bytes: Type.String() }),
]);
const RgEvent = Type.Object({ type: Type.String(), data: Type.Unknown() });
const RgLineData = Type.Object({
  path: RgText,
  lines: RgText,
  line_number: Type.Integer({ minimum: 1 }),
});

/** rg는 UTF-8이 아닌 값을 `{ bytes: base64 }`로 준다. 그 밖은 `{ text }`다 */
function textOf(value: Static<typeof RgText>): string {
  if ("text" in value) return value.text;
  return new TextDecoder().decode(Uint8Array.from(atob(value.bytes), (char) => char.charCodeAt(0)));
}

function malformed(): WorkspaceFailure {
  return new WorkspaceFailure("internal", "ripgrep printed a JSON line that is not a known event");
}

/** `rg --json` 출력에서 일치와 문맥 줄만 순서대로 뽑는다. begin, end, summary 같은 다른 이벤트는 버린다 */
export function parseRgJson(stdout: string): readonly RgLine[] {
  const lines: RgLine[] = [];
  for (const raw of stdout.split("\n")) {
    if (raw === "") continue;
    const json = parseJson(raw);
    if (!json.ok) throw malformed();
    const event = parse(RgEvent, json.value);
    if (!event.ok) throw malformed();
    const kind =
      event.value.type === "match"
        ? "match"
        : event.value.type === "context"
          ? "context"
          : undefined;
    if (kind === undefined) continue;
    const data = parse(RgLineData, event.value.data);
    if (!data.ok) throw malformed();
    lines.push({
      kind,
      path: relativeRgPath(textOf(data.value.path)),
      line: data.value.line_number,
      text: textOf(data.value.lines).replace(/\r?\n$/, ""),
    });
  }
  return lines;
}

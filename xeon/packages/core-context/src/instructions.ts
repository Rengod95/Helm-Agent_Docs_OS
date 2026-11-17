import * as nodeFs from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { attempt, attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";

// L1.context §4.2 절의 원천(M5c §4.4.7). 프로젝트 루트 R에서 대화 폴더 F까지 각 폴더의 `AGENTS.md`를 R이 먼저 오게 모아 `sections`로 준다.
// `AGENTS.md`만 읽는다. `CLAUDE.md`와 다른 이름은 읽지 않는다(사용자 결정 2026-11-18). 건너뛴 파일과 읽기 실패는 진단 값으로 돌려주고,
// 기록은 호출자(core-loop)가 한다.

/** 지침 파일 이름. 이 이름만 읽는다 */
const INSTRUCTION_FILE_NAME = "AGENTS.md";

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** 입출력 실패. 파일이나 폴더가 없는 것은 실패가 아니다(`ok(null)`) */
interface InstructionIoError {
  readonly kind: "io_failed";
  readonly detail: string;
}

interface InstructionFileInfo {
  readonly size: number;
  readonly mtimeMs: number;
}

/** 파일 시스템 포트. 운영은 `nodeInstructionFs`다. 없는 경로는 `ok(null)`이고 나머지 실패는 `err`다 */
export interface InstructionFs {
  /** 심볼릭 링크를 푼 정규 경로 */
  realpath(path: string): Promise<Result<string | null, InstructionIoError>>;
  /** 정규 경로의 크기와 수정 시각 */
  stat(realPath: string): Promise<Result<InstructionFileInfo | null, InstructionIoError>>;
  /** 정규 경로의 내용 바이트 */
  readBytes(realPath: string): Promise<Result<Uint8Array, InstructionIoError>>;
}

/** 건너뛴 파일과 읽기 실패. `path`는 그 폴더의 `AGENTS.md` 경로다 */
export type InstructionDiagnostic =
  | {
      readonly code: "instruction_too_large";
      readonly path: string;
      readonly bytes: number;
      readonly maxBytes: number;
    }
  | { readonly code: "instruction_outside_root"; readonly path: string }
  | { readonly code: "instruction_read_failed"; readonly path: string; readonly detail: string }
  | { readonly code: "instruction_root_mismatch"; readonly path: string };

export interface InstructionSections {
  /** 키는 `project:<R 기준 상대 경로>`이고 R 자신은 `project:.`다. 값은 파일 내용 그대로다. R에서 F 순서로 든다 */
  readonly sections: Readonly<Record<string, string>>;
  readonly diagnostics: readonly InstructionDiagnostic[];
}

export interface InstructionSource {
  /** 대화의 작업 폴더 F. 없으면(작업 폴더가 없는 대화) 지침을 읽지 않는다 */
  readonly workspaceOf: (threadId: ThreadId) => string | undefined;
  /** 대화의 프로젝트 루트 R. 없으면 F가 루트다(F의 `AGENTS.md`만 읽는다) */
  readonly projectRootOf?: (threadId: ThreadId) => string | undefined;
  /** `l1.context.instructionFiles.maxBytes`의 유효 값 */
  readonly maxBytes: (threadId: ThreadId) => number;
  readonly fs: InstructionFs;
}

interface CachedText {
  readonly mtimeMs: number;
  readonly size: number;
  readonly text: string;
}

/**
 * 턴 시작마다 부르는 지침 절 읽기. 같은 정규 경로의 파일은 수정 시각과 크기가 같으면 다시 읽지 않는다.
 * 반환값에 진단이 있으면 호출자가 경고로 남긴다. 예상 가능한 입출력 실패는 값으로 돌려준다.
 */
export function createInstructionSections(
  source: InstructionSource,
): (threadId: ThreadId) => Promise<InstructionSections> {
  const cache = new Map<string, CachedText>();

  return async (threadId) => {
    const diagnostics: InstructionDiagnostic[] = [];
    const workspaceRaw = source.workspaceOf(threadId);
    if (workspaceRaw === undefined) return { sections: {}, diagnostics };
    const workspace = await realOf(source, workspaceRaw, diagnostics);
    if (workspace === null) return { sections: {}, diagnostics };

    let root = workspace;
    const rootRaw = source.projectRootOf?.(threadId);
    if (rootRaw !== undefined) {
      const realRoot = await realOf(source, rootRaw, diagnostics);
      if (realRoot === null) return { sections: {}, diagnostics };
      if (isInside(realRoot, workspace)) root = realRoot;
      else diagnostics.push({ code: "instruction_root_mismatch", path: rootRaw });
    }

    const maxBytes = source.maxBytes(threadId);
    const sections: Record<string, string> = {};
    for (const folder of folderChain(root, workspace)) {
      // oxlint-disable-next-line no-await-in-loop -- 진단의 순서가 폴더 순서와 같아야 하므로 차례로 읽는다 (M5c §4.4.7)
      const text = await readInstructionFile(source, cache, root, folder, maxBytes, diagnostics);
      if (text !== null) sections[sectionKeyOf(root, folder)] = text;
    }
    return { sections, diagnostics };
  };
}

/** 경로의 정규 경로. 없으면 null(진단 없음), 입출력 실패면 진단을 남기고 null */
async function realOf(
  source: InstructionSource,
  path: string,
  diagnostics: InstructionDiagnostic[],
): Promise<string | null> {
  const real = await source.fs.realpath(path);
  if (real.ok) return real.value;
  diagnostics.push({ code: "instruction_read_failed", path, detail: real.error.detail });
  return null;
}

/** 한 폴더의 `AGENTS.md` 내용. 없으면 null이고 진단을 남기지 않는다. 건너뛰면 진단과 함께 null이다 */
async function readInstructionFile(
  source: InstructionSource,
  cache: Map<string, CachedText>,
  root: string,
  folder: string,
  maxBytes: number,
  diagnostics: InstructionDiagnostic[],
): Promise<string | null> {
  const logical = join(folder, INSTRUCTION_FILE_NAME);
  const located = await source.fs.realpath(logical);
  if (!located.ok) {
    diagnostics.push({
      code: "instruction_read_failed",
      path: logical,
      detail: located.error.detail,
    });
    return null;
  }
  const real = located.value;
  if (real === null) return null;
  // 심볼릭 링크가 루트 밖을 가리키면 읽지 않는다
  if (!isInside(root, real)) {
    diagnostics.push({ code: "instruction_outside_root", path: logical });
    return null;
  }

  const info = await source.fs.stat(real);
  if (!info.ok) {
    diagnostics.push({ code: "instruction_read_failed", path: logical, detail: info.error.detail });
    return null;
  }
  if (info.value === null) return null;
  if (info.value.size > maxBytes) {
    diagnostics.push({
      code: "instruction_too_large",
      path: logical,
      bytes: info.value.size,
      maxBytes,
    });
    return null;
  }

  const cached = cache.get(real);
  if (
    cached !== undefined &&
    cached.mtimeMs === info.value.mtimeMs &&
    cached.size === info.value.size
  ) {
    return cached.text;
  }
  const bytes = await source.fs.readBytes(real);
  if (!bytes.ok) {
    diagnostics.push({
      code: "instruction_read_failed",
      path: logical,
      detail: bytes.error.detail,
    });
    return null;
  }
  // 상한은 읽은 뒤에도 본다(stat과 읽기 사이에 커질 수 있다)
  if (bytes.value.byteLength > maxBytes) {
    diagnostics.push({
      code: "instruction_too_large",
      path: logical,
      bytes: bytes.value.byteLength,
      maxBytes,
    });
    return null;
  }
  const decoded = attempt(() => UTF8.decode(bytes.value));
  if (!decoded.ok) {
    diagnostics.push({ code: "instruction_read_failed", path: logical, detail: "not valid UTF-8" });
    return null;
  }
  cache.set(real, { mtimeMs: info.value.mtimeMs, size: info.value.size, text: decoded.value });
  return decoded.value;
}

/** R부터 F까지 거쳐 가는 폴더. R이 먼저다. F가 R과 같으면 R 하나다 */
function folderChain(root: string, workspace: string): string[] {
  const chain = [root];
  const rel = relative(root, workspace);
  if (rel === "") return chain;
  let current = root;
  for (const segment of rel.split(sep)) {
    current = join(current, segment);
    chain.push(current);
  }
  return chain;
}

/** 절의 키. R 자신은 `project:.`다 */
function sectionKeyOf(root: string, folder: string): string {
  const rel = relative(root, folder).split(sep).join("/");
  return `project:${rel === "" ? "." : rel}`;
}

/** `path`가 `root` 안이거나 같은 자리인가. 둘 다 정규 경로여야 한다 */
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function ioFailureOf(cause: unknown): InstructionIoError {
  return { kind: "io_failed", detail: cause instanceof Error ? cause.message : "unknown error" };
}

/** 없는 경로로 나는 실패인가(ENOENT, 중간 경로가 파일인 ENOTDIR) */
function isMissing(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause.code === "ENOENT" || cause.code === "ENOTDIR")
  );
}

/** 운영 파일 시스템 포트(`node:fs/promises`). 없는 경로는 `ok(null)`이다 */
export const nodeInstructionFs: InstructionFs = {
  async realpath(path) {
    const real = await attemptAsync(() => nodeFs.realpath(path));
    if (real.ok) return ok(real.value);
    return isMissing(real.error.cause) ? ok(null) : err(ioFailureOf(real.error.cause));
  },
  async stat(realPath) {
    const info = await attemptAsync(() => nodeFs.stat(realPath));
    if (info.ok) return ok({ size: info.value.size, mtimeMs: info.value.mtimeMs });
    return isMissing(info.error.cause) ? ok(null) : err(ioFailureOf(info.error.cause));
  },
  async readBytes(realPath) {
    const bytes = await attemptAsync(() => nodeFs.readFile(realPath));
    return bytes.ok ? ok(bytes.value) : err(ioFailureOf(bytes.error.cause));
  },
};

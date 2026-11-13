import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { attemptAsync, err, ok, type Logger, type Result } from "@fresnel/contracts";
import type { BlobError } from "@fresnel/contracts/records";
import type { ToolOutputFiles, ToolOutputFilesError } from "@fresnel/contracts/services";

// L0.exec.spec §3.8.3 잘린 도구 출력의 파일 사본. `<dir>/<threadId>/<sha256>.txt`. blob 저장소가 정본이므로 사본은 지워져도 `restore`로 다시 만든다.

const THREAD_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FILE_SUFFIX = ".txt";

export interface ToolOutputFilesOptions {
  /** 사본 폴더. 운영은 `<상태 디렉터리>/spill/tool-output`이다 */
  readonly dir: string;
  /** blob 원문을 해시로 읽는다(`StoreService.readBlobByHash`) */
  readonly readBlobByHash: (sha256: string) => Result<Uint8Array, BlobError>;
  readonly logger?: Logger;
}

function ioError(cause: unknown): ToolOutputFilesError {
  return { kind: "io", cause };
}

async function exists(path: string): Promise<boolean> {
  const found = await attemptAsync(() => stat(path));
  return found.ok;
}

export function createToolOutputFiles(options: ToolOutputFilesOptions): ToolOutputFiles {
  const dir = resolve(options.dir);

  const pathFor = (threadId: string, sha256: string): string =>
    join(dir, threadId, `${sha256}${FILE_SUFFIX}`);

  /** `<dir>/<thread>/<sha>.txt` 꼴이면 그 두 조각, 아니면 undefined */
  function parts(path: string): { threadId: string; sha256: string } | undefined {
    const absolute = resolve(path);
    if (!absolute.startsWith(dir + sep)) return undefined;
    const segments = absolute.slice(dir.length + 1).split(sep);
    if (segments.length !== 2) return undefined;
    const [threadId, file] = segments;
    if (threadId === undefined || file === undefined || !THREAD_SEGMENT.test(threadId)) {
      return undefined;
    }
    if (!file.endsWith(FILE_SUFFIX)) return undefined;
    const sha256 = file.slice(0, -FILE_SUFFIX.length);
    return SHA256.test(sha256) ? { threadId, sha256 } : undefined;
  }

  async function write(
    threadId: string,
    sha256: string,
    bytes: Uint8Array,
  ): Promise<Result<string, ToolOutputFilesError>> {
    if (!THREAD_SEGMENT.test(threadId) || !SHA256.test(sha256)) {
      return err(ioError(new Error("invalid_output_file_key")));
    }
    const path = pathFor(threadId, sha256);
    if (await exists(path)) return ok(path);
    const made = await attemptAsync(async () => {
      await mkdir(join(dir, threadId), { recursive: true, mode: 0o700 });
      // 읽는 쪽이 반쯤 쓴 파일을 보지 않도록 임시 이름에 쓰고 옮긴다
      const staging = `${path}.${process.pid}.${Date.now()}.part`;
      await writeFile(staging, bytes, { mode: 0o600 });
      await rename(staging, path);
    });
    return made.ok ? ok(path) : err(ioError(made.error.cause));
  }

  async function restore(path: string): Promise<Result<boolean, ToolOutputFilesError>> {
    const key = parts(path);
    if (key === undefined) return ok(false);
    const target = pathFor(key.threadId, key.sha256);
    if (await exists(target)) return ok(true);
    const blob = options.readBlobByHash(key.sha256);
    if (!blob.ok) return err({ kind: "blob_missing", sha256: key.sha256 });
    const written = await write(key.threadId, key.sha256, blob.value);
    return written.ok ? ok(true) : written;
  }

  async function removeThread(threadId: string): Promise<void> {
    if (!THREAD_SEGMENT.test(threadId)) return;
    const removed = await attemptAsync(() =>
      rm(join(dir, threadId), { recursive: true, force: true }),
    );
    if (!removed.ok) {
      options.logger?.warn("tool_output.remove_failed", { threadId });
    }
  }

  async function sweep(isLive: (threadId: string) => boolean): Promise<number> {
    const names = await attemptAsync(() => readdir(dir));
    if (!names.ok) return 0;
    const stale = names.value.filter((name) => THREAD_SEGMENT.test(name) && !isLive(name));
    await Promise.all(stale.map((name) => removeThread(name)));
    return stale.length;
  }

  return { dir, pathFor, write, restore, removeThread, sweep };
}

import { constants } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { attemptAsync, err, ok, type Clock, type Logger, type Result } from "@fresnel/contracts";
import type {
  LoaderFs,
  TrustChoice,
  TrustOption,
  TrustStoreBackend,
} from "@fresnel/contracts/extensions";
import type { TrustDetails } from "@fresnel/contracts/wire";
import {
  createProjectTrustStore,
  resolveProjectTrust,
  trustOptions,
  type ProjectTrustResult,
  type ProjectTrustStore,
  type TrustListing,
  type TrustStoreError,
} from "@fresnel/ext-host";
import type { FileLock, FileLockError } from "@fresnel/platform-os";
import {
  previewTrustResources,
  type BoundedText,
  type TrustPreviewReader,
} from "./trust-preview.ts";

// X.loading-trust.spec §4.7. 프로젝트 신뢰 판정을 조립 루트에서 이어 붙인다: 저장 파일(`<config>/trust.json`), 파일 시스템 포트,
// 판정 호출. 엔진은 프롬프트를 띄우지 않는다(`headless`): 결정이 없는 프로젝트는 `undecided`(불신)이고, 사람의 결정은 클라이언트가
// wire `trust.get`·`trust.decide`(F wire §3.3.1)로 보낸다. `decide`가 `resolveProjectTrust`의 프롬프트 단계(§4.7.3 8번)와 같은 규칙으로
// 저장 파일이나 세션 기억에 쓴다. 저장 파일은 CLI의 `fresnel trust`와 데스크톱 카드가 각자의 호스트로 쓰므로 호스트 프로세스 사이의 쓰기가
// 겹친다: 읽고-고치고-쓰기는 L0.os의 파일 잠금(`fileLock.updateText`) 안에서 한다(G1-10). 조립 루트 코드(DR-14 예외 2).

type DefaultProjectTrust = "ask" | "always" | "never";

export interface ProjectTrustDeps {
  /** 신뢰 저장 파일이 있는 디렉터리(L0.os의 `dirs.config`) */
  readonly configDir: string;
  /** 프로세스 사이 파일 잠금(`OsServiceHandle.fileLock`). `trust.json`의 읽고-고치고-쓰기가 이 안에서 일어난다 */
  readonly fileLock: FileLock;
  readonly homeDir: string;
  readonly clock: Pick<Clock, "now">;
  readonly logger: Logger;
  /** `x.loading-trust.defaultProjectTrust` 유효 값 */
  readonly defaultTrust: () => DefaultProjectTrust;
}

/** 판정 결과와 클라이언트가 보일 수 있는 선택지. `details`는 결정이 필요한 판정에만 있다(§4.7.4 카드 미리 보기) */
export interface TrustInspection {
  readonly result: ProjectTrustResult;
  readonly options: readonly TrustOption[];
  readonly details: TrustDetails | null;
}

/** 결정을 반영하지 못한 이유 */
type TrustDecideFailure =
  /** 선택지에 없는 결정(상위 폴더가 없는데 `parent` 등) */
  | { readonly kind: "invalid_choice" }
  /** 저장 파일이 손상되었거나 쓰지 못했다. 기존 결정은 그대로다 */
  | { readonly kind: "store_failed"; readonly reason: "corrupt" | "io" };

export interface ProjectTrust {
  /** 판정과 선택지. 아무것도 바꾸지 않는다 */
  inspect(projectRoot: string, signal: AbortSignal): Promise<TrustInspection>;
  /**
   * 사람의 결정을 반영한다. `folder`·`parent`는 저장 파일에 쓰고(앞선 세션 기억은 지운다), `session`은 이 프로세스의 기억에만 둔다.
   * 반영한 뒤의 판정을 돌려준다. 신뢰 필요 자원이 없는 폴더도 미리 정할 수 있다
   */
  decide(
    projectRoot: string,
    choice: TrustChoice,
    signal: AbortSignal,
  ): Promise<Result<TrustInspection, TrustDecideFailure>>;
  /** 판정 전체 결과. 설정 쓰기가 "명시한 결정인가"(`via`)를 본다 */
  resolve(projectRoot: string, signal: AbortSignal): Promise<ProjectTrustResult>;
  /** 신뢰되었는가. 결정이 없으면(undecided) 거짓이다 */
  isTrusted(projectRoot: string, signal: AbortSignal): Promise<boolean>;
  /**
   * 신뢰 필요 자원이 있는지와 관계없이, 사람이 정한 결정(저장 파일)이나 기본 정책(`always`·`never`)이 있는가.
   * 신뢰 필요 자원이 없어 판정을 건너뛴 폴더에 설정 파일을 새로 쓸지 정할 때 쓴다(그 파일이 생기면 그 폴더는 판정 대상이 된다)
   */
  explicitVerdict(projectRoot: string): Promise<"allow" | "deny" | "none">;
  /**
   * 저장 파일의 결정 전부(`trust.list`). 읽기만 한다. 세션 결정은 저장하지 않아 없다. 손상이나 읽기 실패는 저장소 오류다
   * [결정: 오케스트레이터 기본값, fxPT]
   */
  list(): Promise<Result<readonly TrustListing[], TrustStoreError>>;
}

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/** 없는 파일은 null, 그 밖의 읽기 실패는 던진다 */
async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (caught) {
    if (errorCode(caught) === "ENOENT") return null;
    throw caught;
  }
}

/** 임시 파일에 쓰고 이름을 바꿔 교체한다(0600). 같은 디렉터리라 원자적이다 */
export async function replaceFileAtomically(
  path: string,
  text: string,
  tmpId: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${tmpId}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, path);
}

/** 파일 잠금을 얻지 못했거나 쓰지 못했다. `TrustStoreBackend.update`는 거부로 실패를 알리고 저장소가 `io`로 옮긴다 */
class TrustFileLockError extends Error {
  override readonly name: string = "TrustFileLockError";
  readonly lock: FileLockError;

  constructor(lock: FileLockError) {
    super(`trust.json update failed: ${lock.kind}`);
    this.lock = lock;
  }
}

/**
 * 신뢰 저장 파일 백엔드. 읽기는 잠금 없이 한다(쓰기가 같은 디렉터리의 임시 파일을 만들어 이름을 바꾸므로 읽는 쪽은 옛 파일이나 새 파일 하나를 본다).
 * 갱신은 `fileLock.updateText`가 `<path>.lock` 아래에서 읽고-고치고-쓴다: 호스트 둘이 동시에 결정을 저장해도 앞 쓰기를 덮지 않는다.
 */
export function fileBackend(path: string, fileLock: FileLock): TrustStoreBackend {
  return {
    async read() {
      const read = await attemptAsync(() => readTextOrNull(path));
      return read.ok
        ? { ok: true, text: read.value }
        : { ok: false, reason: errorCode(read.error.cause) };
    },
    async update(fn) {
      const updated = await fileLock.updateText(path, fn);
      if (!updated.ok) throw new TrustFileLockError(updated.error);
    },
  };
}

/** 읽기 전용으로 연다. 없으면 null. `O_NONBLOCK`이라 이름 있는 파이프(FIFO)를 열어도 쓰는 쪽을 기다리며 멈추지 않는다(종류를 본 뒤 `unreadable`로 닫는다) */
async function openForRead(path: string): Promise<FileHandle | null> {
  try {
    return await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (caught) {
    if (errorCode(caught) === "ENOENT" || errorCode(caught) === "ENOTDIR") return null;
    throw caught;
  }
}

/**
 * 일반 파일이면 `maxBytes`까지만 읽는다. 크기를 잰 뒤에도 자랄 수 있어 상한 한 바이트 너머까지 읽어 보고, 넘으면 `too_large`다.
 * 상한을 넘은 파일의 내용은 메모리에 `maxBytes + 1`바이트를 넘겨 올리지 않는다.
 */
async function readBoundedText(path: string, maxBytes: number): Promise<BoundedText> {
  const handle = await openForRead(path);
  if (handle === null) return { kind: "missing" };
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { kind: "unreadable" };
    if (info.size > maxBytes) return { kind: "too_large" };
    // 한 번의 읽기로 상한 한 바이트까지만 받는다. 정규 파일은 요청한 만큼 돌아오고(끝을 넘으면 짧다), 크기를 잰 뒤 자랐다면 상한을 넘는다
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return { kind: "too_large" };
    return { kind: "text", text: buffer.toString("utf8", 0, bytesRead) };
  } finally {
    await handle.close();
  }
}

export function createLoaderFs(): LoaderFs & TrustPreviewReader {
  return {
    readText: (path) => readTextOrNull(path),
    readBoundedText: (path, maxBytes) => readBoundedText(path, maxBytes),
    async listDir(path) {
      try {
        const entries = await readdir(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          kind: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "dir" : "file",
        }));
      } catch (caught) {
        if (errorCode(caught) === "ENOENT" || errorCode(caught) === "ENOTDIR") return null;
        throw caught;
      }
    },
    async exists(path) {
      try {
        await stat(path);
        return true;
      } catch (caught) {
        if (errorCode(caught) === "ENOENT" || errorCode(caught) === "ENOTDIR") return false;
        throw caught;
      }
    },
    realpath: (path) => realpath(path),
  };
}

export function createProjectTrust(deps: ProjectTrustDeps): ProjectTrust {
  const fs = createLoaderFs();
  const sessionMemory = new Map<string, "allow" | "deny">();
  const store: ProjectTrustStore = createProjectTrustStore(
    fileBackend(join(deps.configDir, "trust.json"), deps.fileLock),
    async (path) => {
      // 없는 경로는 정규화할 수 없다. 저장소 키로는 절대 경로를 그대로 쓴다
      const real = await attemptAsync(() => realpath(path));
      return real.ok ? real.value : resolve(path);
    },
    deps.clock,
  );

  async function resolveTrust(
    projectRoot: string,
    signal: AbortSignal,
  ): Promise<ProjectTrustResult> {
    const result = await resolveProjectTrust({
      projectRoot,
      // 프롬프트를 띄울 클라이언트가 없다. 결정이 없는 프로젝트는 undecided(불신)로 끝난다
      mode: "headless",
      defaultProjectTrust: deps.defaultTrust(),
      store,
      fs,
      homeDir: deps.homeDir,
      // session.trust.before 지점은 thread 없이 발화할 수 없고(DispatchOptions.threadId) M2에는 그 지점에 핸들러를 거는 확장이 없다 [미결]
      emitProjectTrust: () => Promise.resolve(undefined),
      sessionMemory,
      signal,
    });
    if (result.storeError !== undefined) {
      deps.logger.warn("trust.store_error", {
        kind: result.storeError.kind,
        root: result.projectRoot,
      });
    }
    return result;
  }

  /**
   * 결정이 필요한 판정(신뢰 필요 자원이 있고 허용이 아님)에만 자원 이름을 미리 본다(§4.7.4). 허용된 폴더는 카드가 없으므로 읽지 않는다.
   * 정의 파일이 손상되었거나 읽지 못했거나 상한을 넘은 자리는 진단 로그로 남기고 목록에서는 뺀다(잘렸다는 표시는 `truncated`로 간다)
   */
  async function previewOf(result: ProjectTrustResult): Promise<TrustDetails | null> {
    if (!result.required || result.verdict === "allow") return null;
    const preview = await previewTrustResources(fs, result.projectRoot);
    for (const issue of preview.issues) {
      deps.logger.warn("trust.preview_skipped", {
        root: result.projectRoot,
        path: issue.path,
        reason: issue.reason,
      });
    }
    return preview.details;
  }

  async function inspect(projectRoot: string, signal: AbortSignal): Promise<TrustInspection> {
    const result = await resolveTrust(projectRoot, signal);
    const parent = dirname(result.projectRoot);
    return {
      result,
      options: trustOptions(result.projectRoot, parent === result.projectRoot ? null : parent),
      details: await previewOf(result),
    };
  }

  return {
    inspect,
    async decide(projectRoot, choice, signal) {
      const before = await inspect(projectRoot, signal);
      const option = before.options.find(
        (candidate) =>
          candidate.choice.kind === choice.kind && candidate.choice.verdict === choice.verdict,
      );
      if (option === undefined) return err({ kind: "invalid_choice" });
      const root = before.result.projectRoot;
      if (choice.kind === "session") {
        sessionMemory.set(root, choice.verdict);
      } else {
        const saved = await store.setMany(option.updates);
        if (!saved.ok) {
          deps.logger.warn("trust.store_error", { kind: saved.error.kind, root });
          return err({
            kind: "store_failed",
            reason: saved.error.kind === "corrupt" ? "corrupt" : "io",
          });
        }
        // 세션 기억이 저장한 결정보다 먼저 보이므로(X.loading-trust.spec §4.7.3 3번) 앞선 기억은 지운다
        sessionMemory.delete(root);
      }
      return ok(await inspect(root, signal));
    },
    resolve: resolveTrust,
    async explicitVerdict(projectRoot) {
      const looked = await store.lookup(projectRoot);
      if (looked.kind === "found") return looked.verdict;
      const policy = deps.defaultTrust();
      if (policy === "always") return "allow";
      if (policy === "never") return "deny";
      return "none";
    },
    list: () => store.list(),
    async isTrusted(projectRoot, signal) {
      return (await resolveTrust(projectRoot, signal)).trusted;
    },
  };
}

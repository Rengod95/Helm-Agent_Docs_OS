import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { attemptAsync, type Clock, type Logger } from "@xeon/contracts";
import type { LoaderFs, TrustStoreBackend } from "@xeon/contracts/extensions";
import {
  createProjectTrustStore,
  resolveProjectTrust,
  type ProjectTrustResult,
  type ProjectTrustStore,
} from "@xeon/ext-host";

// X.loading-trust.spec §4.7. 프로젝트 신뢰 판정을 조립 루트에서 이어 붙인다: 저장 파일(`<config>/trust.json`), 파일 시스템 포트,
// 판정 호출. 프롬프트는 대화형 클라이언트(CLI.2, DESK)가 생기면 `prompter`로 더한다. 그 전에는 결정이 없는 프로젝트가
// `undecided`(불신)로 끝난다. 조립 루트 코드(DR-14 예외 2).

export type DefaultProjectTrust = "ask" | "always" | "never";

export interface ProjectTrustDeps {
  /** 신뢰 저장 파일이 있는 디렉터리(L0.os의 `dirs.config`) */
  readonly configDir: string;
  readonly homeDir: string;
  readonly clock: Pick<Clock, "now">;
  readonly logger: Logger;
  /** `x.loading-trust.defaultProjectTrust` 유효 값 */
  readonly defaultTrust: () => DefaultProjectTrust;
}

export interface ProjectTrust {
  /** 판정 전체 결과. 설정 쓰기가 "명시한 결정인가"(`via`)를 본다 */
  resolve(projectRoot: string, signal: AbortSignal): Promise<ProjectTrustResult>;
  /** 신뢰되었는가. 결정이 없으면(undecided) 거짓이다 */
  isTrusted(projectRoot: string, signal: AbortSignal): Promise<boolean>;
  /**
   * 신뢰 필요 자원이 있는지와 관계없이, 사람이 정한 결정(저장 파일)이나 기본 정책(`always`·`never`)이 있는가.
   * 신뢰 필요 자원이 없어 판정을 건너뛴 폴더에 설정 파일을 새로 쓸지 정할 때 쓴다(그 파일이 생기면 그 폴더는 판정 대상이 된다)
   */
  explicitVerdict(projectRoot: string): Promise<"allow" | "deny" | "none">;
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

/**
 * 신뢰 저장 파일 백엔드. 갱신은 이 프로세스 안에서 차례로 한다. 프로세스 사이 잠금은 L0.os가 아직 내놓지 않아 없다:
 * 호스트 둘이 동시에 결정을 저장하면 나중 쓰기가 앞 쓰기를 덮을 수 있다 [미결].
 */
function fileBackend(path: string, tmpId: () => string): TrustStoreBackend {
  const queue: { tail: Promise<unknown> } = { tail: Promise.resolve() };
  return {
    async read() {
      const read = await attemptAsync(() => readTextOrNull(path));
      return read.ok
        ? { ok: true, text: read.value }
        : { ok: false, reason: errorCode(read.error.cause) };
    },
    update(fn) {
      const run = (async (): Promise<void> => {
        await queue.tail;
        const current = await readTextOrNull(path);
        await replaceFileAtomically(path, fn(current), tmpId());
      })();
      // 앞 갱신이 실패해도 다음 갱신은 이어서 한다. 실패는 이 호출의 약속으로 알린다
      queue.tail = attemptAsync(() => run);
      return run;
    },
  };
}

export function createLoaderFs(): LoaderFs {
  return {
    readText: (path) => readTextOrNull(path),
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
  const counter = { next: 0 };
  const store: ProjectTrustStore = createProjectTrustStore(
    fileBackend(join(deps.configDir, "trust.json"), () => {
      counter.next += 1;
      return `${String(process.pid)}-${String(counter.next)}`;
    }),
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
      // project_trust 지점은 thread 없이 발화할 수 없고(DispatchOptions.threadId) M2에는 그 지점에 핸들러를 거는 확장이 없다 [미결]
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

  return {
    resolve: resolveTrust,
    async explicitVerdict(projectRoot) {
      const looked = await store.lookup(projectRoot);
      if (looked.kind === "found") return looked.verdict;
      const policy = deps.defaultTrust();
      if (policy === "always") return "allow";
      if (policy === "never") return "deny";
      return "none";
    },
    async isTrusted(projectRoot, signal) {
      return (await resolveTrust(projectRoot, signal)).trusted;
    },
  };
}

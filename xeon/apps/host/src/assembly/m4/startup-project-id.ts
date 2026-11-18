import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { attemptAsync, type Clock, type Logger } from "@fresnel/contracts";
import type { FileLock } from "@fresnel/platform-os";
import { PROJECT_DEFAULT_FOLDER_KEY } from "../../settings.ts";
import { defaultFolderOf, scopeRootsOf } from "./project-port.ts";
import { deepestRoot } from "./project-scope.ts";
import { createProjectStore } from "./project-store.ts";

// 시작 때 cwd의 프로젝트 id(AGE-41). 외부 로더는 프로젝트 포트(`m4.project`)가 올라오기 전에 cwd의 프로젝트를 판정해 싣는다.
// 그래서 포트의 루트 목록 대신 `projects.json`과 기본 폴더 설정에서 같은 계산(`scopeRootsOf`, 가장 깊은 루트)을 바로 한다.
// 읽지 못하면 진단을 남기고 `undefined`다(그러면 이번 시작에 프로젝트 검토본을 싣지 않는다).

export interface StartupProjectIdDeps {
  /** 사용자 설정 폴더. `projects.json`이 있다 */
  readonly configDir: string;
  /** 데이터 폴더. 기본 폴더 설정이 비었을 때 `<dataDir>/default-project`를 쓴다 */
  readonly dataDir: string;
  readonly fileLock: FileLock;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  readonly settingValue: (key: string) => unknown;
  readonly logger: Logger;
}

/** 프로젝트 루트(정규 경로가 아니어도 된다)의 프로젝트 id. 어느 루트에도 없으면 `undefined`다 */
export function createStartupProjectIdOf(
  deps: StartupProjectIdDeps,
): (projectRoot: string) => Promise<string | undefined> {
  const store = createProjectStore({
    path: join(deps.configDir, "projects.json"),
    fileLock: deps.fileLock,
    clock: deps.clock,
    signal: deps.signal,
  });
  return async (projectRoot) => {
    const snapshot = await store.read();
    if (!snapshot.ok) {
      deps.logger.error("project.startup_id_failed", { kind: snapshot.error.kind });
      return undefined;
    }
    const folder = defaultFolderOf(deps.settingValue(PROJECT_DEFAULT_FOLDER_KEY), deps.dataDir);
    if (folder === null) return undefined;
    const roots = await scopeRootsOf(snapshot.value.projects, folder);
    const real = await attemptAsync(() => realpath(projectRoot));
    const canonical = real.ok ? real.value : resolve(projectRoot);
    return deepestRoot(canonical, roots)?.projectId;
  };
}

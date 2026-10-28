import type { Logger } from "@xeon/contracts";
import type { ExtensionLoader } from "@xeon/ext-host";
import type { HostMode } from "../types.ts";
import type { ProjectTrust } from "./trust.ts";

// X.loading-trust.spec §4.7.8, M3-REQ-38. 서비스 모드는 작업 폴더를 여는 때 그 프로젝트의 확장을 싣는다(시작 때는 싣지 않는다).
// 판정은 조립 루트의 `ProjectTrust`(저장 파일, 세션 기억, 기본 정책)가 하고, 신뢰된 폴더만 로더의 `loadProject`로 싣는다.
// 프롬프트를 받을 클라이언트는 그 폴더를 연 연결이다: 결정이 없는 폴더는 싣지 않고, 클라이언트가 `trust.get`·`trust.decide`로 정한 뒤
// 신뢰 포트가 이 모듈을 다시 부른다. in-process·stdio 호스트는 시작 때 `loadAll`이 cwd의 프로젝트를 이미 처리했으므로 아무것도 하지 않는다.

export interface ProjectExtensions {
  /** 작업 폴더의 프로젝트 확장을 싣는다. 불신·미결정이면 싣지 않는다. 같은 폴더의 동시 호출은 한 번만 싣는다 */
  ensure(workspace: string | undefined, signal: AbortSignal): Promise<void>;
}

export interface ProjectExtensionsDeps {
  readonly mode: HostMode;
  /** 외부 확장 로더. 외부 확장을 싣지 않는 조립(`defaultGroups: false`)이면 아직 없다 */
  readonly loader: () => ExtensionLoader | undefined;
  readonly trust: ProjectTrust;
  readonly logger: Logger;
}

export function createProjectExtensions(deps: ProjectExtensionsDeps): ProjectExtensions {
  const inFlight = new Map<string, Promise<void>>();

  async function load(
    loader: ExtensionLoader,
    workspace: string,
    signal: AbortSignal,
  ): Promise<void> {
    const trust = await deps.trust.resolve(workspace, signal);
    if (!trust.trusted) return;
    const report = await loader.loadProject({
      projectRoot: workspace,
      mode: "headless",
      // 판정은 위에서 끝냈다. 같은 결정을 로더에 그대로 넘긴다
      trustOverride: true,
      signal,
    });
    if (report.alreadyLoaded) return;
    for (const diagnostic of report.diagnostics) {
      const fields = {
        extension: diagnostic.extension ?? "",
        code: diagnostic.code,
        message: diagnostic.message,
      };
      if (diagnostic.severity === "error") deps.logger.error("ext.project_diagnostic", fields);
      else deps.logger.warn("ext.project_diagnostic", fields);
    }
  }

  return {
    ensure(workspace, signal) {
      if (deps.mode !== "service" || workspace === undefined) return Promise.resolve();
      const loader = deps.loader();
      if (loader === undefined) return Promise.resolve();
      const pending = inFlight.get(workspace);
      if (pending !== undefined) return pending;
      const started = load(loader, workspace, signal).finally(() => {
        inFlight.delete(workspace);
      });
      inFlight.set(workspace, started);
      return started;
    },
  };
}

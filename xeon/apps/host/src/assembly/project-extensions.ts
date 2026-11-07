import type { Logger } from "@fresnel/contracts";
import type { ExtensionLoader } from "@fresnel/ext-host";
import type { ProjectTrust } from "./trust.ts";

// X.loading-trust.spec §4.7.8, M3-REQ-38. 모든 호스트 모드(in-process, stdio, 서비스)는 작업 폴더를 여는 때 그 프로젝트의 확장을 싣는다.
// 시작 때 cwd의 프로젝트는 `loadAll`이 이미 실었을 수 있고(in-process·stdio), 로더의 `alreadyLoaded`가 같은 루트를 다시 싣지 않는다.
// 판정은 조립 루트의 `ProjectTrust`(저장 파일, 세션 기억, 기본 정책)가 하고, 프롬프트 없이 신뢰된 폴더만 로더의 `loadProject`로 싣는다.
// 결정이 없는 폴더는 싣지 않고 묻지도 않는다. 프롬프트를 받을 클라이언트는 그 폴더를 연 연결이다: 클라이언트가 `trust.decide`로 정하면
// 신뢰 포트가 이 모듈을 다시 부른다(`trust.get`은 아무것도 바꾸지 않는다).

export interface ProjectExtensions {
  /**
   * 작업 폴더의 프로젝트 확장을 싣는다. 불신·미결정이면 싣지 않는다. 같은 폴더의 동시 호출은 한 번만 싣고,
   * 각 호출자는 자기 신호로만 기다린다: 한 호출자가 떠나도 적재와 다른 호출자의 결과는 그대로다
   */
  ensure(workspace: string | undefined, signal: AbortSignal): Promise<void>;
}

export interface ProjectExtensionsDeps {
  /** 외부 확장 로더. 외부 확장을 싣지 않는 조립(`defaultGroups: false`)이면 아직 없다 */
  readonly loader: () => ExtensionLoader | undefined;
  readonly trust: ProjectTrust;
  readonly logger: Logger;
  /** 엔진 수명 신호. 공유 적재는 이 신호로 돈다: 닫히면 적재를 중단하고, 먼저 부른 호출자가 떠나도 멈추지 않는다 */
  readonly signal: AbortSignal;
}

export function createProjectExtensions(deps: ProjectExtensionsDeps): ProjectExtensions {
  /** 작업 폴더마다 진행 중인 적재 하나. 실패하면 지워서 다음 호출이 다시 싣게 한다 */
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
      if (workspace === undefined) return Promise.resolve();
      const loader = deps.loader();
      if (loader === undefined) return Promise.resolve();
      let shared = inFlight.get(workspace);
      if (shared === undefined) {
        // 적재는 호출자의 신호가 아니라 엔진 수명 신호로 돈다(이 호출자의 신호는 아래에서 이 호출자만 본다)
        shared = load(loader, workspace, deps.signal).finally(() => {
          inFlight.delete(workspace);
        });
        inFlight.set(workspace, shared);
      }
      return untilCallerAborts(shared, signal);
    },
  };
}

/**
 * 공유 적재를 호출자 자기 신호로만 기다린다. 이 신호가 닫히면 이 호출자만 그 사유로 거절되고, 공유 적재는 계속 돈다.
 * 공유 적재는 항상 구독되어 있어서, 아무도 기다리지 않게 된 실패도 처리되지 않은 거절로 새지 않는다.
 */
function untilCallerAborts(shared: Promise<void>, signal: AbortSignal): Promise<void> {
  const cancelled = Promise.withResolvers<never>();
  const onAbort = (): void => {
    const reason: unknown = signal.reason;
    cancelled.reject(reason);
  };
  // 이미 닫힌 신호에는 abort 사건이 다시 오지 않는다
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  return Promise.race([shared, cancelled.promise]).finally(() => {
    signal.removeEventListener("abort", onAbort);
  });
}

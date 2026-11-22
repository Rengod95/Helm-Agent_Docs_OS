import { attemptAsync } from "@fresnel/contracts";
import { dependenciesOf } from "@fresnel/contracts/extensions";
import type { ExtensionLoader } from "@fresnel/ext-host";
import type { PluginLifecycle } from "./plugin-set.ts";

// M5c §4.1.11: 대화의 참조가 0→1이면 로더의 `ensureLoaded`, 1→0이면 `unload`를 부른다. 로더가 기록을 모르는 이름은 `loadInstalled`로 검토본에서 처음 싣는다(승인은 적재가 아니다).
// 검토본이 없는 이름(내장 단위, 설치하지 않은 이름)은 건너뛴다. `ensureLoaded`는 모르는 이름에 `Bug`를 던지기 때문이다.
// AGE-33: 기대는 확장을 싣기 전에 그 hard 대상을 먼저 싣는다(이어서 기대는 것까지, 순환은 한 번만 방문). 대상이 실패해도 던지지 않는다.
// 실패는 로더의 진단에 남고, 기대는 쪽은 로더가 `dependency_missing`이나 `dependency_provider_failed`로 막는다.

export interface PluginLifecycleDeps {
  /** 로더. 조립이 외부 확장을 싣기 전이면 undefined다 */
  readonly loader: () => ExtensionLoader | undefined;
  /**
   * 그 이름의 Drive 프레임을 쥔 대화가 있는가. 있으면 내리지 않는다(프레임이 쥔 실행을 끊지 않는다). 내리지 않은 확장은 참조가 0이어도
   * 적재된 채 남는다 [미결: 프레임이 풀린 뒤 내리는 신호가 X에 없다]
   */
  readonly busy: (name: string) => boolean;
  /** 엔진 생명 신호. 적재를 이 신호로 묶는다 */
  readonly signal: AbortSignal;
}

export function pluginLifecycleOf(deps: PluginLifecycleDeps): PluginLifecycle {
  // 진행 중인 적재. 대화의 참조 적재와 기대는 쪽이 부른 대상 적재가 겹칠 수 있다. 로더의 `ensureLoaded`는 동시 호출을 가리지 않으므로
  // 같은 이름의 진행 중인 적재는 한 번만 부르고 그 결과를 함께 기다린다
  const running = new Map<string, Promise<unknown>>();

  function ensureOne(
    loader: ExtensionLoader,
    name: string,
    visited: Set<string>,
  ): Promise<unknown> {
    const pending = running.get(name);
    if (pending !== undefined) return pending;
    const work = loadAfterTargets(loader, name, visited).finally(() => {
      running.delete(name);
    });
    running.set(name, work);
    return work;
  }

  /** hard 대상을 먼저 싣고(대상마다 같은 방법으로 이어서), 그 뒤에 이름을 싣는다 */
  async function loadAfterTargets(
    loader: ExtensionLoader,
    name: string,
    visited: Set<string>,
  ): Promise<unknown> {
    const info = loader.list().find((candidate) => candidate.name === name);
    const manifest = info?.manifest;
    if (manifest !== undefined) {
      for (const dependency of dependenciesOf(manifest)) {
        const target = dependency.targetExtension;
        if (dependency.kind !== "hard" || visited.has(target)) continue;
        visited.add(target);
        // 기록이 없는 대상은 먼저 싣지 않는다. 로더가 그 확장을 `dependency_missing`으로 막는다
        const hasRecord = loader
          .list()
          .some((candidate) => candidate.name === target && candidate.manifest !== undefined);
        if (!hasRecord) continue;
        // 대상이 실패해도 던지지 않는다. 대상의 진단은 로더에 남는다
        // oxlint-disable-next-line no-await-in-loop -- 대상은 차례로 싣는다(앞 대상이 방문 표를 바꾸고, 뒤 대상은 그 뒤에 켜야 한다) (AGE-33)
        await attemptAsync(() => ensureOne(loader, target, visited));
      }
    }
    if (info !== undefined) return await loader.ensureLoaded(name, deps.signal);
    // 기록이 없는 이름: 승인만 하고 아직 어느 대화도 쓰지 않은 검토본이다. 처음 들어올 때 검토본에서 싣는다(§4.1.11).
    // 검토본이 없는 이름(내장 단위, 설치하지 않은 이름)은 `not_found`로 건너뛴다
    const installed = await loader.loadInstalled(name, deps.signal);
    return installed.ok ? installed.value.info : undefined;
  }

  return {
    async ensureLoaded(name) {
      const loader = deps.loader();
      if (loader === undefined) return undefined;
      return await ensureOne(loader, name, new Set([name]));
    },
    async unload(name) {
      const loader = deps.loader();
      if (loader === undefined || deps.busy(name)) return false;
      return await loader.unload(name);
    },
  };
}

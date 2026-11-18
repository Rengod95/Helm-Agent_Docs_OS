import type { ExtensionLoader } from "@fresnel/ext-host";
import type { PluginLifecycle } from "./plugin-set.ts";

// M5c §4.1.11: 대화의 참조가 0→1이면 로더의 `ensureLoaded`, 1→0이면 `unload`를 부른다. 로더가 모르는 이름(내장 단위, 아직 설치하지 않은 이름,
// 검토본만 있고 코드가 없는 이름)은 건너뛴다. `ensureLoaded`는 모르는 이름에 `Bug`를 던지기 때문이다.

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
  return {
    async ensureLoaded(name) {
      const loader = deps.loader();
      if (loader === undefined || !loader.list().some((info) => info.name === name)) {
        return undefined;
      }
      return await loader.ensureLoaded(name, deps.signal);
    },
    async unload(name) {
      const loader = deps.loader();
      if (loader === undefined || deps.busy(name)) return false;
      return await loader.unload(name);
    },
  };
}

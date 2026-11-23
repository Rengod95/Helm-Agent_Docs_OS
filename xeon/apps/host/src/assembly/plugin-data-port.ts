import { err, type Result } from "@fresnel/contracts";
import type { PluginStoreError, PluginStorePort } from "@fresnel/contracts/extensions";

// 플러그인 전용 저장소(X.primitives.spec §4.6.7)의 조립 자리. ext-host는 포트를 만들 때 받고 저장소는 조립의 뒤쪽에서 열리므로,
// 같은 객체가 열린 뒤의 포트에 위임한다. 열기 전의 호출은 `storage_unavailable` 값이다.

const UNAVAILABLE: PluginStoreError = { kind: "storage_unavailable" };

function unavailable(): Promise<Result<never, PluginStoreError>> {
  return Promise.resolve(err(UNAVAILABLE));
}

/** `read()`가 현재 포트를 돌려준다. 아직 열리지 않았으면 undefined다 */
export function latePluginStorePort(read: () => PluginStorePort | undefined): PluginStorePort {
  return {
    get: (extension, key) => read()?.get(extension, key) ?? unavailable(),
    put: (extension, key, valueJson) => read()?.put(extension, key, valueJson) ?? unavailable(),
    delete: (extension, key) => read()?.delete(extension, key) ?? unavailable(),
    list: (extension, prefix) => read()?.list(extension, prefix) ?? unavailable(),
    usage: (extension) => read()?.usage(extension) ?? unavailable(),
    clear: (extension) => read()?.clear(extension) ?? unavailable(),
  };
}

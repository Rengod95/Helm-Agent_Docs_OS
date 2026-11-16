import { err, ok, parse } from "@fresnel/contracts";
import {
  checkSettingWrite,
  type ScopeStack,
  type SettingDef,
  type SettingKey,
} from "@fresnel/contracts/settings";
import { isDomainPattern, normalizeHost, type WebPolicyWriter } from "@fresnel/cap-web";
import { Type } from "typebox";
import type { SettingsStorePort } from "../types.ts";

// L2.web.spec §4.5.5. 웹 접근 승인의 "이 사이트 계속 허용"·"모든 사이트 허용"을 user 범위 설정에 쓴다.
// 값 검사는 settings.set과 같은 `checkSettingWrite`를 거친다(관리 범위 잠금, 허용 범위, 값 형식). 조립 루트 코드(DR-14 예외 2).

const ALLOW_SETTING = "l2.web.policy.allow";
const DEFAULT_SETTING = "l2.web.policy.default";
const StringList = Type.Array(Type.String());

export interface WebPolicyWriterDeps {
  readonly catalog: ReadonlyMap<SettingKey, SettingDef>;
  /** 설정 저장소. 엔진 포트가 만들어지기 전에는 undefined다 */
  readonly store: () => SettingsStorePort | undefined;
  readonly layers: () => ScopeStack;
}

export function createWebPolicyWriter(deps: WebPolicyWriterDeps): WebPolicyWriter {
  async function write(key: string, value: unknown) {
    const store = deps.store();
    if (store === undefined) return err({ kind: "failed" as const, message: "no settings store" });
    const checked = checkSettingWrite(deps.catalog, deps.layers(), key, "user", value);
    if (!checked.ok) return err({ kind: "failed" as const, message: checked.kind });
    const written = await store.write("user", key, checked.value, undefined);
    return written.ok
      ? ok(undefined)
      : err({ kind: "failed" as const, message: `write: ${written.error.kind}` });
  }

  return {
    async allowHost(host) {
      const normalized = normalizeHost(host);
      if (!isDomainPattern(normalized)) {
        return err({ kind: "failed", message: "the host is not a domain pattern" });
      }
      const user = deps.layers().find((layer) => layer.scope === "user");
      const current = parse(StringList, user?.values.get(ALLOW_SETTING) ?? []);
      const list = current.ok ? current.value : [];
      if (list.includes(normalized)) return ok(undefined);
      return write(ALLOW_SETTING, [...list, normalized]);
    },
    allowAllSites: () => write(DEFAULT_SETTING, "allow"),
  };
}

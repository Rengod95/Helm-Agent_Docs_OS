import type { SecretHandle, SecretMeta, SecretName } from "@xeon/contracts/capabilities";
import { resolveSetting } from "@xeon/contracts/settings";
import type { SecretAdminService } from "@xeon/contracts/services";
import type { SecretsConfig } from "@xeon/platform-secrets";
import { createSecretOfferStore } from "../secrets/offers.ts";
import type { SecretsPort } from "../types.ts";
import type { SettingsEngine } from "./settings-engine.ts";

// HOST.3. 비밀 관리 서비스(platform-secrets의 admin)를 `secret.*` 처리기가 쓰는 SecretsPort로 감싼다. 조립 루트 코드(DR-14 예외 2).

/** 비밀 이름 → SOPS 파일 안 키 이름. `exa-key` → `EXA_KEY` (`just secret-add`가 만드는 대문자 키와 같은 규칙) */
function sopsKeyOf(name: SecretName): string {
  return name.toUpperCase().replaceAll("-", "_");
}

export function createSecretsPort(
  admin: SecretAdminService,
  config: () => SecretsConfig,
): SecretsPort {
  return {
    admin,
    offers: createSecretOfferStore(),
    newMeta(name): SecretMeta | undefined {
      const current = config();
      // 메타 ref 규칙(`<env>/<KEY>`)을 아는 제공자는 sops뿐이다. 파일이 설정되지 않았으면 값을 놓을 곳이 없다
      const file = current.sops.files[0];
      if (current.defaultProvider !== "sops" || file === undefined) return undefined;
      return {
        name,
        desc: name,
        provider: "sops",
        ref: `${file.env}/${sopsKeyOf(name)}`,
        scope: "user",
        expiresAt: null,
        // 빈 정책은 사용 불가다. 사람이 `secret.meta`로 모드·도구·호스트를 정해야 에이전트가 쓴다
        use: { modes: [], tools: [], hosts: [] },
        approval: current.approval.default,
        ttlSeconds: current.lease.ttlSeconds,
        maxUses: current.lease.maxUses,
      };
    },
  };
}

/** 핸들을 값으로 가진 비밀 설정 키(`secret.references`·`rm`이 보인다). 파일 범위의 유효 값만 본다 */
export function settingKeysReferencing(
  settings: SettingsEngine,
  handle: SecretHandle,
): readonly string[] {
  const layers = settings.layers(undefined);
  const keys: string[] = [];
  for (const [key, def] of settings.catalog) {
    if (def.secret !== true) continue;
    if (resolveSetting(def, layers).setting.value === handle) keys.push(key);
  }
  return keys.toSorted();
}

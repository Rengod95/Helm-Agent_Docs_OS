import type { SecretHandle, SecretMeta, SecretName } from "@xeon/contracts/capabilities";
import { resolveSetting } from "@xeon/contracts/settings";
import type { SecretAdminService } from "@xeon/contracts/services";
import { withDefaultSopsFile, type SecretsConfig } from "@xeon/platform-secrets";
import { createSecretOfferStore } from "../secrets/offers.ts";
import type { ProviderLinker } from "../secrets/provider-link.ts";
import type { SecretsPort } from "../types.ts";
import type { SettingsEngine } from "./settings-engine.ts";

// HOST.3. 비밀 관리 서비스(platform-secrets의 admin)를 `secret.*` 처리기가 쓰는 SecretsPort로 감싼다. 조립 루트 코드(DR-14 예외 2).

/** 비밀 이름 → SOPS 파일 안 키 이름. `exa-key` → `EXA_KEY` (`just secret-add`가 만드는 대문자 키와 같은 규칙) */
function sopsKeyOf(name: SecretName): string {
  return name.toUpperCase().replaceAll("-", "_");
}

/**
 * 설정에 SOPS 파일이 없으면 사용자 기본 파일을 채운 유효 설정(L0.secrets.spec §4.8). `newMeta`는 platform-secrets가 읽는 것과
 * 같은 유효 설정을 봐야 새 비밀의 `ref`(`user/<KEY>`)가 SOPS 제공자가 찾는 파일과 맞는다. `configDir`은 `os.dirs.config`다
 */
export function effectiveSecretsConfig(
  config: () => SecretsConfig,
  configDir: string,
): () => SecretsConfig {
  return () => withDefaultSopsFile(config(), configDir);
}

export function createSecretsPort(
  admin: SecretAdminService,
  config: () => SecretsConfig,
  linker: ProviderLinker,
): SecretsPort {
  return {
    admin,
    offers: createSecretOfferStore(),
    linkModelProviders: () => linker.link(),
    newMeta(name): SecretMeta | undefined {
      const current = config();
      // 메타 ref 규칙(`<env>/<KEY>`)을 아는 제공자는 sops뿐이다. 기본 제공자가 sops가 아니면 값을 놓을 곳을 정할 수 없다.
      // 파일 목록이 비는 일은 effectiveSecretsConfig가 기본 파일을 채우므로 없다(빈 목록은 방어일 뿐이다)
      const file = current.sops.files[0];
      if (current.defaultProvider !== "sops" || file === undefined) return undefined;
      // 이미 사용자 설정이 모델 provider에 연결한 이름이면 그 호출 하나만 허용하는 정책으로 시작한다(HS-45). 아니면 빈 정책이다
      const granted = linker.grantFor(name);
      return {
        name,
        desc: name,
        provider: "sops",
        ref: `${file.env}/${sopsKeyOf(name)}`,
        scope: "user",
        expiresAt: null,
        // 빈 정책은 사용 불가다. 사람이 `secret.meta`로 모드·도구·호스트를 정하거나 모델 provider에 연결해야 쓴다
        use: granted?.use ?? { modes: [], tools: [], hosts: [] },
        approval: granted?.approval ?? current.approval.default,
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

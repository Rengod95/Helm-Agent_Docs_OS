import type { PortKey } from "@xeon/contracts/extensions";
import { ExecPortKey, SecretServiceName } from "@xeon/contracts/services";
import { attempt, type Logger } from "@xeon/contracts";
import type { PlatformModule } from "@xeon/ext-host";
import type { ExecPlatformProvider } from "./provider.ts";
import type { SecretEnvSource } from "./secret-env.ts";
import { createExecService, type ExecServiceOptions } from "./service.ts";

// L0.exec.spec §3.8, L0.exec.plan EX-14. ext-host의 L0 등록 단위(PlatformModule)로 xeon.exec를 제공한다.
// 이 패키지는 Cordis를 import하지 않는다(DR-11). 등록은 조립 루트가 `ExtHost.registerPlatform`으로 한다.

const SecretsPortKey: PortKey<SecretEnvSource> = { name: SecretServiceName };

export interface ExecPlatformModuleConfig {
  /** l0.exec.* 설정에서 만든 값 */
  readonly options: ExecServiceOptions;
  /** select.ts가 고른 provider */
  readonly platform: ExecPlatformProvider;
  /** 허용 목록 빌더가 이름을 골라 옮길 부모 env의 읽기 전용 사본 */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly logger?: Logger;
}

/**
 * `xeon.secrets`가 먼저 등록되어 있으면 env 모드 비밀 주입을 켠다. 없으면 `secretEnv`가 있는 호출은
 * `secret_unavailable`이다(L0.exec.spec §3.6). 등록 순서는 조립 루트가 정한다.
 */
export function createExecPlatformModule(config: ExecPlatformModuleConfig): PlatformModule {
  return {
    name: "platform-exec",
    setup(ctx) {
      // ctx.port는 포트가 없으면 던진다. 비밀 서비스가 없는 구성도 정상이라 값으로 받는다
      const found = attempt((): SecretEnvSource => ctx.port(SecretsPortKey));
      const secrets: SecretEnvSource | undefined = found.ok ? found.value : undefined;
      const service = createExecService(config.options, {
        platform: config.platform,
        secrets,
        parentEnv: config.parentEnv,
        ...(config.logger === undefined ? {} : { logger: config.logger }),
      });
      ctx.providePort(ExecPortKey, service);
      ctx.onDispose(() => service.cleanup({ abortSignal: undefined }));
    },
  };
}

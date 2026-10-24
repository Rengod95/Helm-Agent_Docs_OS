import type { PortKey } from "@xeon/contracts/extensions";
import {
  OsServiceName,
  SandboxServiceName,
  SecretServiceName,
  type OsService,
  type SandboxService,
  type SecretService,
} from "@xeon/contracts/services";
import type { PlatformModule } from "@xeon/ext-host";
import { createSandboxService, type SandboxSettings } from "@xeon/platform-sandbox";
import type { SecretServiceRuntime } from "@xeon/platform-secrets";

// L0 패키지 가운데 PlatformModule을 내놓지 않는 둘(platform-secrets, platform-sandbox)의 등록 단위. 서비스 팩토리는 각 패키지가
// 내놓고, ExtHost.registerPlatform에 올리는 모듈은 조립 루트가 만든다(L0.secrets.plan SC-12, L0.sandbox.spec 둘 다 그렇게 적었다).

const OS_KEY: PortKey<OsService> = { name: OsServiceName };
const SECRETS_KEY: PortKey<SecretService> = { name: SecretServiceName };
const SANDBOX_KEY: PortKey<SandboxService> = { name: SandboxServiceName };

export function secretsPlatform(runtime: SecretServiceRuntime): PlatformModule {
  return {
    name: "platform-secrets",
    setup(ctx) {
      ctx.providePort(SECRETS_KEY, runtime);
      ctx.onDispose(() => {
        runtime[Symbol.dispose]();
      });
    },
  };
}

/** xeon.os와 xeon.secrets가 먼저 등록되어 있어야 한다. 시작 때 상태 탐지와 srt 초기화를 한 번 한다(L0.sandbox.spec §4.1) */
export function sandboxPlatform(
  settings: () => SandboxSettings,
  signal: AbortSignal,
): PlatformModule {
  return {
    name: "platform-sandbox",
    async setup(ctx) {
      const handle = await createSandboxService(
        { os: ctx.port(OS_KEY), secrets: ctx.port(SECRETS_KEY), settings },
        signal,
      );
      ctx.providePort(SANDBOX_KEY, handle);
      ctx.onDispose(() => handle.dispose());
    },
  };
}

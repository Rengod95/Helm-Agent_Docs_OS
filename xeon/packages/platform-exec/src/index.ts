// @xeon/platform-exec: xeon.exec(ExecService)의 로컬 구현. pi durable env 포크 + Xeon 연결 코드(L0.exec.spec).
export { createExecService, type ExecServiceDeps, type ExecServiceOptions } from "./service.ts";
export {
  BASE_ENV_POLICY,
  buildChildEnv,
  isDeniedEnvName,
  type EnvBuildError,
  type EnvPolicy,
} from "./env-builder.ts";
export type { SecretEnvSource } from "./secret-env.ts";
export type { ExecPlatform, ExecPlatformProvider, ShellConfig } from "./provider.ts";
export { detectExecPlatform, selectExecPlatform, type ExecSelectError } from "./select.ts";
// 줄 스캔과 디코더(L0.exec.spec §4.4). 원본 env/index.ts:326-327과 같은 이름이다.
export { LineScanner, rangeDecoder, StreamDecoder, startsWithBom } from "./upstream/env/index.ts";
export {
  createExecPlatformModule,
  ExecPortKey,
  type ExecPlatformModuleConfig,
} from "./platform-module.ts";

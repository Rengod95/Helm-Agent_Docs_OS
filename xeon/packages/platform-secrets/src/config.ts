import { join } from "node:path";
import type { SecretApproval, SecretProviderId } from "@xeon/contracts/capabilities";

// L0.secrets.spec §6.1 `l0.secrets.*` 설정 키의 값 모양. 설정 정의(defineSettings)는 settings.ts에, 로딩은 조립 루트가 하고,
// 이 패키지는 이미 검증된 값을 getter로 받는다(live 키는 호출마다 다시 읽는다).

export interface SecretsSopsFile {
  /** 메타 `ref`("<env>/<KEY>")의 <env> 부분 */
  readonly env: string;
  /** SOPS 파일 경로. 절대 경로여야 한다 */
  readonly path: string;
}

export interface SecretsConfig {
  readonly providers: readonly SecretProviderId[];
  readonly defaultProvider: SecretProviderId;
  readonly sops: {
    readonly files: readonly SecretsSopsFile[];
    readonly binary: string | null;
  };
  readonly ageKey: {
    readonly source: "auto" | "keychain" | "file";
    readonly filePath: string | null;
  };
  readonly approval: {
    readonly default: SecretApproval;
    readonly writeHosts: "per-session" | "per-use";
  };
  readonly lease: {
    readonly ttlSeconds: number;
    readonly maxUses: number;
  };
  readonly redaction: { readonly enabled: boolean };
  readonly audit: { readonly retentionDays: number };
}

/** spec §6.1 기본값 */
export const DEFAULT_SECRETS_CONFIG: SecretsConfig = {
  providers: ["sops"],
  defaultProvider: "sops",
  sops: { files: [], binary: null },
  ageKey: { source: "auto", filePath: null },
  approval: { default: "per-session", writeHosts: "per-use" },
  lease: { ttlSeconds: 900, maxUses: 200 },
  redaction: { enabled: true },
  audit: { retentionDays: 90 },
};

/** sops 하한 버전(`SOPS_AGE_KEY_CMD` 도입, spec §4.6 1번) */
export const SOPS_MIN_VERSION = "3.10.0";

/** 메타 위치: `<OsDirs.config>/secrets/meta/` (spec §3.2) */
export const SECRETS_SUBDIR = "secrets";
export const META_SUBDIR = "meta";
export const DEFAULT_AGE_KEY_SUBPATH: readonly string[] = ["secrets", "age", "keys.txt"];

/**
 * 기본 SOPS 파일(spec §4.8). `l0.secrets.sops.files`가 비어 있으면 이 항목 하나를 쓴다.
 * 위치는 `<OsDirs.config>/secrets/sops/user.yaml`이다. OsDirs는 사용자 하나에 하나뿐이고 클라이언트(CLI, 데스크톱 사이드카)마다
 * 나뉘지 않으므로 어느 클라이언트가 등록해도 같은 파일이다. `<config>/secrets/` 아래라 샌드박스 보호 경로가 이미 덮는다.
 */
export const DEFAULT_SOPS_ENV = "user";
export const DEFAULT_SOPS_SUBPATH: readonly string[] = ["secrets", "sops", "user.yaml"];

export function defaultSopsFile(configDir: string): SecretsSopsFile {
  return { env: DEFAULT_SOPS_ENV, path: join(configDir, ...DEFAULT_SOPS_SUBPATH) };
}

/** 사람이 파일을 적지 않았으면 기본 파일을 채운다. 적었으면 그대로 둔다(기본 파일을 섞지 않는다) */
export function withDefaultSopsFile(config: SecretsConfig, configDir: string): SecretsConfig {
  if (config.sops.files.length > 0) return config;
  return { ...config, sops: { ...config.sops, files: [defaultSopsFile(configDir)] } };
}

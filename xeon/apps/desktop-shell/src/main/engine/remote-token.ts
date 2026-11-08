import {
  createTokenVault,
  nodeProcessRunner,
  type ProcessRunner,
} from "@fresnel/platform-secrets/vault";

// 원격(`wss`) 대상의 기기 토큰을 OS 보안 저장소(macOS Keychain, Linux Secret Service)에서 읽는다(L4.remote.spec §8.3 4번).
// 저장소 접근은 L0 `platform-secrets`의 `TokenVault`가 한다. 셸은 Electron(Node)에서 도므로 Bun 실행기 대신 `platform-secrets`의 Node 실행기(`nodeProcessRunner`)를 쓴다.
// 토큰은 설정 파일과 인자에 두지 않는다. 읽은 값은 엔진 자식의 환경 변수로만 간다(`planCommand`).

/** 보안 저장소 도구가 쓰는 환경만 남긴다(세션 버스, 홈). 그 밖의 부모 환경은 넘기지 않는다 */
const VAULT_ENV_KEYS = ["PATH", "HOME", "USER", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"];

/**
 * 보안 저장소 항목 이름. `host:port`(호스트는 소문자, IPv6는 괄호)다. `packages/client`의 `tokenAccountOf`와 같은 값이어야 한다
 * (두 패키지는 같은 L4라 서로 import하지 못한다). `wss`가 아니면 null이다.
 */
export function remoteTokenAccount(address: string): string | null {
  const match = /^wss:\/\/(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9][A-Za-z0-9.-]*):(\d{1,5})(?:\/|$)/.exec(
    address.trim(),
  );
  if (match === null) return null;
  const [, host = "", port = ""] = match;
  return `${host.toLowerCase()}:${port}`;
}

export interface RemoteTokenSourceDeps {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  /** 시험이 바꿔 넣는다. 기본은 child_process 실행기 */
  readonly runner?: ProcessRunner;
  readonly signal?: AbortSignal;
}

/** 대상 주소의 기기 토큰을 읽는다. `wss`가 아니거나 저장소에 없거나 읽지 못하면 undefined다 */
export function remoteTokenSource(
  deps: RemoteTokenSourceDeps,
): (address: string) => Promise<string | undefined> {
  const env: Record<string, string> = {};
  for (const key of VAULT_ENV_KEYS) {
    const value = deps.env[key];
    if (value !== undefined) env[key] = value;
  }
  const vault = createTokenVault({
    platform: deps.platform === "darwin" ? "darwin" : deps.platform === "linux" ? "linux" : "other",
    securityPath: deps.platform === "darwin" ? "/usr/bin/security" : null,
    secretToolPath: deps.platform === "linux" ? "/usr/bin/secret-tool" : null,
    runner: deps.runner ?? nodeProcessRunner,
    env,
    signal: deps.signal ?? new AbortController().signal,
  });
  return async (address) => {
    const account = remoteTokenAccount(address);
    if (account === null) return undefined;
    const read = await vault.get(account);
    return read.ok ? read.value : undefined;
  };
}

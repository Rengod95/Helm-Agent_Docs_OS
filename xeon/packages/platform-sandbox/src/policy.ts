import type { SandboxNetworkPolicy, SandboxPolicy } from "@xeon/contracts/services";
import { toAbsolutePath, canonicalizePath, sortedUnique } from "./paths.ts";
import type { SrtCommandConfig, SrtConfig } from "./srt.ts";

// L0.sandbox.spec §3.2. Xeon 정책을 srt 설정으로 바꾸는 순수 함수들이다. 경로 정규화는 파일 시스템을 읽는다(realpath).

/** 보호 경로를 합친 뒤의 정책. 경로는 모두 정규 절대 경로이고 정렬·중복 제거되어 있다 */
export interface EffectivePolicy {
  readonly writeRoots: readonly string[];
  readonly readDeny: readonly string[];
  readonly writeDeny: readonly string[];
}

/** 상태 탐지가 찾은 헬퍼 절대 경로(L0.sandbox.spec §3.2 마지막 행, §5.3) */
export interface SrtTools {
  readonly bwrapPath?: string;
  readonly socatPath?: string;
  readonly ripgrepCommand?: string;
}

/** M1은 네트워크를 전부 차단한다. 허용 도메인 정책은 M2 이후다(L0.sandbox.spec §1) */
export const BLOCKED_NETWORK: SandboxNetworkPolicy = { allowedDomains: [], deniedDomains: [] };

export interface PolicyInput {
  readonly policy: SandboxPolicy;
  /** 보호 경로 중 이름 패턴이 아닌 항목(exact·prefix)의 읽기·쓰기 거부 경로 */
  readonly protectedReadDeny: readonly string[];
  readonly protectedWriteDeny: readonly string[];
  /** basename 항목을 쓰기 루트 아래에서 전개한 파일 경로 */
  readonly basenameFiles: readonly string[];
  /** 설정 l0.sandbox.writeRoots.extra */
  readonly extraWriteRoots: readonly string[];
  readonly home: string;
  /** 상대 경로의 기준 디렉터리 */
  readonly base: string;
}

function normalizeAll(paths: readonly string[], home: string, base: string): string[] {
  return sortedUnique(paths.map((path) => canonicalizePath(toAbsolutePath(path, home, base))));
}

/**
 * 호출자 정책에 보호 경로와 설정 추가분을 합친다. 호출자가 readDeny·writeDeny를 비워도 보호 경로는 빠지지 않는다.
 * readDeny는 읽기와 쓰기를 모두 거부하므로 writeDeny에도 들어간다(SandboxPolicy.readDeny).
 * 쓰기 루트에서 보호 경로 안에 있는 것을 지우는 일은 호출자가 먼저 한다(protected-paths.ts dropProtectedWriteRoots).
 */
export function mergePolicy(
  input: PolicyInput,
  keptWriteRoots: readonly string[],
): EffectivePolicy {
  const { home, base } = input;
  const readDeny = normalizeAll(
    [...input.policy.readDeny, ...input.protectedReadDeny, ...input.basenameFiles],
    home,
    base,
  );
  const writeDeny = normalizeAll(
    [
      ...input.policy.writeDeny,
      ...input.policy.readDeny,
      ...input.protectedWriteDeny,
      ...input.basenameFiles,
    ],
    home,
    base,
  );
  return { writeRoots: sortedUnique(keptWriteRoots), readDeny, writeDeny };
}

/** 정책이 쓸 쓰기 루트 후보(호출자 정책 + 설정 추가분)를 정규 절대 경로로 만든다 */
export function candidateWriteRoots(input: PolicyInput): string[] {
  return normalizeAll(
    [...input.policy.writeRoots, ...input.extraWriteRoots],
    input.home,
    input.base,
  );
}

/** srt는 글롭 메타문자가 든 문자열을 패턴으로 읽는다. 그런 경로만 literal 표기로 넘긴다 */
const GLOB_CHARS = /[*?[\]{}]/;

function toPathEntry(path: string): string | { path: string; literal: true } {
  return GLOB_CHARS.test(path) ? { path, literal: true } : path;
}

/** 명령마다 넘기는 파일 정책(customConfig). 네트워크는 넣지 않는다(프로세스 전역 설정이다) */
export function toSrtFileConfig(policy: EffectivePolicy): SrtCommandConfig {
  return {
    filesystem: {
      allowWrite: policy.writeRoots.map(toPathEntry),
      denyRead: policy.readDeny.map(toPathEntry),
      denyWrite: policy.writeDeny.map(toPathEntry),
      allowGitConfig: false,
    },
  };
}

/**
 * srt `initialize`에 한 번 넘기는 프로세스 전역 설정. 네트워크와 고정 값만 담고 파일 정책은 비워 둔다.
 * 완화 옵션은 모두 거짓으로 고정한다(L0.sandbox.spec §3.2).
 */
export function toSrtGlobalConfig(tools: SrtTools, network: SandboxNetworkPolicy): SrtConfig {
  return {
    network: {
      allowedDomains: [...network.allowedDomains],
      deniedDomains: [...network.deniedDomains],
      strictAllowlist: true,
      allowAllUnixSockets: false,
      allowLocalBinding: false,
    },
    filesystem: { denyRead: [], allowWrite: [], denyWrite: [], allowGitConfig: false },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowAppleEvents: false,
    allowPty: false,
    ...(tools.ripgrepCommand === undefined ? {} : { ripgrep: { command: tools.ripgrepCommand } }),
    ...(tools.bwrapPath === undefined ? {} : { bwrapPath: tools.bwrapPath }),
    ...(tools.socatPath === undefined ? {} : { socatPath: tools.socatPath }),
  };
}

/** 명령별 설정을 srt 스키마로 검증하려고 전역 설정과 합친 후보 */
export function validationCandidate(tools: SrtTools, custom: SrtCommandConfig): SrtConfig {
  const global = toSrtGlobalConfig(tools, BLOCKED_NETWORK);
  return custom.filesystem === undefined ? global : { ...global, filesystem: custom.filesystem };
}

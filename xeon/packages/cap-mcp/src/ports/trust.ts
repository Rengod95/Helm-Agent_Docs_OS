import { resolveProjectTrust, type ResolveProjectTrustInput } from "@xeon/ext-host";

// 프로젝트 신뢰(결정 D6): `.mcp.json`, `.xeon/mcp.json`, project 범위 서버 정의는 신뢰 뒤에만 읽는다.
// 판정은 X의 `resolveProjectTrust`가 한다(X.loading-trust.spec §4.7.3).

export interface McpProjectTrust {
  /** 프로젝트가 신뢰되는가. 결정이 없거나(undecided) 거부면 거짓이다 */
  isTrusted(projectRoot: string, signal: AbortSignal): Promise<boolean>;
}

/** `resolveProjectTrust` 입력 중 프로젝트마다 달라지지 않는 부분 */
export type TrustResolverDeps = Omit<ResolveProjectTrustInput, "projectRoot" | "signal">;

export function createProjectTrust(deps: TrustResolverDeps): McpProjectTrust {
  return {
    async isTrusted(projectRoot, signal) {
      const result = await resolveProjectTrust({ ...deps, projectRoot, signal });
      return result.trusted;
    },
  };
}

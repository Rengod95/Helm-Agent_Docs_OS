// 비밀 env를 쓰는 stdio 서버의 기동 승인 포트(L2.mcp.spec §4.3, M3-05). L1 core-tools의 `createMcpStartGate`와 같은 모양이다.
// cap-mcp는 L1을 import하지 않으므로 필요한 모양을 선언하고 조립 루트가 잇는다. 비밀 값은 이 경계를 지나지 않는다(참조만).

export interface McpStartDefinition {
  readonly server: string;
  /** 정의 출처(`settings:user`, `mcpjson:project`, `ext:<이름>` 등) */
  readonly source: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | null;
  /** 평문 env */
  readonly env: Readonly<Record<string, string>>;
  /** env 이름 → `secret://` 참조 */
  readonly secretEnv: Readonly<Record<string, string>>;
}

/** L0 `UseCtx.approval`과 같은 모양의 기동 승인 증거 */
export interface McpStartEvidence {
  readonly approvalId: string;
  readonly scope: "per-session" | "per-use";
  readonly grantedAt: number;
  readonly expiresAt: number | null;
}

export type McpStartVerdict =
  | { readonly kind: "approved"; readonly evidence: McpStartEvidence }
  /** 사용자의 응답을 기다린다. 응답이 오면 `onResolved`가 서버 id로 알린다 */
  | { readonly kind: "pending" }
  | { readonly kind: "denied"; readonly reason: string };

export interface McpStartGate {
  check(
    definition: McpStartDefinition,
    context: { readonly threadId: string | undefined },
  ): Promise<McpStartVerdict>;
  /** 승인이나 거부가 기록되면 서버 id로 알린다. 돌려주는 함수가 구독을 푼다 */
  onResolved(listener: (server: string) => void): () => void;
}

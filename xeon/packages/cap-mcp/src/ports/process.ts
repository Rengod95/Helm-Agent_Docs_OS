import type { Result } from "@xeon/contracts";
import type { McpStartEvidence } from "./start-gate.ts";

// stdio 서버를 띄우는 포트(L2.mcp.spec §4.3). 자식 프로세스의 표준 입출력을 SDK 전송으로 감싸려면 스트림이 필요한데
// F의 `ProcessPort.spawn`(격리 확장용)과 `ExecService.startBackground`(스트림 없음)는 둘 다 맞지 않는다.
// 그래서 이 패키지가 필요한 모양을 선언한다. 실제 구현은 L0 platform-process가 맡는다(통합 단계, 다른 레인 요청).

export interface McpSpawnSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  /**
   * 환경 변수 이름 → `secret://` 참조. 값은 이 패키지가 풀지 않는다. L0.secrets가 실행 직전에 주입한다(§4.3).
   * 참조가 아닌 값은 서버 정의 검사에서 이미 걸러진다.
   */
  readonly secretEnv: Readonly<Record<string, string>>;
  /** 평문 환경 변수(비밀 이름 패턴은 정의를 읽을 때 이미 거부했다, M3-REQ-97) */
  readonly env?: Readonly<Record<string, string>>;
  /** 비밀 env의 기동 승인 증거(정의 해시마다 한 번 받은 것). `secretEnv`가 있을 때 쓴다 */
  readonly approval?: McpStartEvidence | null;
  /**
   * 샌드박스에 넣어 띄우는가(출처별 기본값과 서버별 설정으로 정한 값, L2.mcp.spec §4.3).
   * 참이면 격리를 쓸 수 없을 때 띄우지 않고 `sandbox_unavailable`을 돌려받는다
   */
  readonly sandbox?: boolean;
  /** 화면 표시. 비밀 값을 넣지 않는다 */
  readonly label: string;
  /** BackgroundOwner.ref에 들어가는 서버 id */
  readonly server: string;
}

export interface McpChild {
  readonly pid: number;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export type McpSpawnError =
  | { readonly kind: "spawn_failed"; readonly code: string; readonly message: string }
  | { readonly kind: "secret_missing"; readonly ref: string }
  | { readonly kind: "secret_denied"; readonly ref: string }
  /** 샌드박스에 넣어야 하는데 이 기기에서 격리할 수 없다. 서버는 띄우지 않는다(L0.process.spec §4.9) */
  | { readonly kind: "sandbox_unavailable"; readonly reason: string };

export interface McpProcessPort {
  spawn(spec: McpSpawnSpec, signal: AbortSignal): Promise<Result<McpChild, McpSpawnError>>;
}

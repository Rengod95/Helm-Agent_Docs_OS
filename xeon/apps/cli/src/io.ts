import type { Clock } from "@xeon/contracts";
import type { CommandIo, HostCommand } from "@xeon/host";
import type { TerminalFacts } from "./cli/command.ts";
import type { ConnectEngine, EngineAssembleOverrides } from "./engine.ts";

// L4.cli.spec §3.4. 프로세스 밖 효과는 io와 deps로만 한다. 테스트는 둘을 가짜로 넣는다.

export type CliSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

export interface CliIo {
  readonly stdin: ReadableStream<Uint8Array>;
  /** EPIPE면 거부한다(§4.6) */
  readonly stdout: (text: string) => Promise<void>;
  readonly stderr: (text: string) => Promise<void>;
  readonly terminal: TerminalFacts & { readonly columns: number | null };
  readonly env: Readonly<Record<string, string | undefined>>;
  /** 현재 작업 폴더 절대 경로. `-C`가 없을 때의 작업 폴더다 [spec에 더한 필드: 파서가 순수 함수라서] */
  readonly cwd: string;
  onSignal(signal: CliSignal, handler: () => void): () => void;
  /**
   * 대화형 입력 한 줄. EOF(Ctrl+D)면 null이다. signal이 중단되면 null이다. TTY가 아닌 환경에서는 쓰지 않는다
   * [spec에 더한 필드: 최소 renderer의 입력 편집]
   */
  readLine(prompt: string, signal: AbortSignal): Promise<string | null>;
}

export interface CliDeps {
  /** §3.3. 실제 값은 connectEngine */
  readonly connect: ConnectEngine;
  /** @xeon/host의 runHostCommand 그대로. host --stdio, service *, config schema가 쓴다(§3.3 표) */
  readonly runHostCommand: (command: HostCommand, io: CommandIo) => Promise<0 | 1 | 2>;
  /** Ctrl+C 2회 판정(§4.6) */
  readonly clock: Clock;
  /** 개발 빌드면 참(§4.3). 컴파일 바이너리는 거짓 */
  readonly devWireRoundTrip: boolean;
  /** `xeon version`이 보이는 Bun 버전 */
  readonly bunVersion: string;
  /** 조립 옵션 덮어쓰기. 모델 테이프와 테스트용 그룹을 넣는 자리다. 운영 진입은 넘기지 않는다 */
  readonly assemble?: EngineAssembleOverrides;
  /** CLI 상태 파일 위치. 없으면 null(@xeon/host가 경로 API를 내기 전까지의 틈, engine.ts 참고) */
  readonly stateFile?: string | null;
}

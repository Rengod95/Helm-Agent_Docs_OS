import type { Clock } from "@xeon/contracts";
import type {
  BridgeExit,
  BridgeOptions,
  CommandIo,
  HostCommand,
  HostExit,
  RemoteResolution,
  StdioHostOptions,
} from "@xeon/host";
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
  /** Tab 완성기를 바꾼다. 대화형 입력만 쓴다 [spec에 더한 필드: /set 자동 완성, §4.12] */
  setCompleter?(complete: (line: string) => readonly string[]): void;
  /**
   * 가려진 입력 한 줄(비밀 값). 에코 없이 바이트로 받는다. EOF나 중단이면 null이다. TTY일 때만 쓴다 [spec에 더한 필드: §4.7]
   * 값 문자열을 만들지 않으려고 바이트 배열로 돌려주고, 부른 쪽이 쓴 뒤 0으로 덮는다
   */
  readSecret(prompt: string, signal: AbortSignal): Promise<Uint8Array | null>;
  /** 바이트 stdout. `host --stdio`는 계약(JSON Lines) 전용으로 이 스트림만 쓴다 [spec에 더한 필드: §3.3 표] */
  readonly stdoutStream: WritableStream<Uint8Array>;
  readonly stderrStream: WritableStream<Uint8Array>;
}

/** doctor가 쓰는 바깥 세계 조회. 실제 값은 runtime.ts, 시험은 가짜를 넣는다 */
export interface DoctorProbes {
  /**
   * SearXNG 탐침(L2.web.spec §4.8.3): `GET <base>/search?q=xeon&format=json&pageno=1`, 제한 시간 1.5초, 응답 64 KiB 상한.
   * 200이고 JSON에 results 배열과 query 문자열이 있으면 ok, 403이면 json-disabled, 그 밖에는 unreachable
   */
  probeSearxng(
    baseUrl: string,
    signal: AbortSignal,
  ): Promise<"ok" | "json-disabled" | "unreachable">;
}

export interface CliDeps {
  /** §3.3. 실제 값은 connectEngine */
  readonly connect: ConnectEngine;
  /** @xeon/host의 runHostCommand 그대로. host --stdio, service *, config schema가 쓴다(§3.3 표) */
  readonly runHostCommand: (command: HostCommand, io: CommandIo) => Promise<0 | 1 | 2>;
  /**
   * `host --stdio`의 본체. l4.cli.* 설정 그룹을 카탈로그에 넣으려고 runHostCommand 대신 이것을 부른다(§3.3 표).
   * 실제 값은 @xeon/host의 startStdioHost
   */
  readonly startStdioHost: (options: StdioHostOptions) => Promise<HostExit>;
  /**
   * `host --stdio`가 원격 주소를 받았을 때 주소를 정한다(HS-89). 실제 값은 @xeon/host의 resolveRemoteEndpoint.
   * `--remote` 플래그가 없으면 `flag`를 넘기지 않는다
   */
  readonly resolveRemote: (options: {
    readonly flag?: string;
    readonly env: Readonly<Record<string, string | undefined>>;
  }) => Promise<RemoteResolution>;
  /** stdin/stdout을 원격 서비스에 중계한다(HS-89). 실제 값은 @xeon/host의 bridgeStdioToService */
  readonly bridgeStdio: (options: BridgeOptions) => Promise<BridgeExit>;
  readonly probes: DoctorProbes;
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

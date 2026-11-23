import type { Clock, Result } from "@fresnel/contracts";
import type {
  BridgeExit,
  BridgeOptions,
  CommandIo,
  HostCommand,
  HostExit,
  RemoteResolution,
  StdioHostOptions,
} from "@fresnel/host";
import type {
  ExportError,
  ExportOptions,
  ExportReport,
  RestoreError,
  RestoreOptions,
  RestoreReport,
} from "@fresnel/platform-store";
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
   * 가려진 입력 한 줄(시크릿 값). 에코 없이 바이트로 받는다. EOF나 중단이면 null이다. TTY일 때만 쓴다 [spec에 더한 필드: §4.7]
   * 값 문자열을 만들지 않으려고 바이트 배열로 돌려주고, 부른 쪽이 쓴 뒤 0으로 덮는다
   */
  readSecret(prompt: string, signal: AbortSignal): Promise<Uint8Array | null>;
  /** 바이트 stdout. `host --stdio`는 계약(JSON Lines) 전용으로 이 스트림만 쓴다 [spec에 더한 필드: §3.3 표] */
  readonly stdoutStream: WritableStream<Uint8Array>;
  readonly stderrStream: WritableStream<Uint8Array>;
}

export interface CliDeps {
  /** §3.3. 실제 값은 connectEngine */
  readonly connect: ConnectEngine;
  /** @fresnel/host의 runHostCommand 그대로. host --stdio, service *, config schema가 쓴다(§3.3 표) */
  readonly runHostCommand: (
    command: HostCommand,
    io: CommandIo,
  ) => Promise<0 | 1 | 2 | 70 | 71 | 72 | 73 | 74 | 75 | 76>;
  /**
   * `host --stdio`의 본체. l4.cli.* 설정 그룹을 카탈로그에 넣으려고 runHostCommand 대신 이것을 부른다(§3.3 표).
   * 실제 값은 @fresnel/host의 startStdioHost
   */
  readonly startStdioHost: (options: StdioHostOptions) => Promise<HostExit>;
  /**
   * `plugin-host --stdio`의 본체(L4.host-service.spec §4.9). 실제 값은 @fresnel/host/plugin-host의 runPluginHostStdio다.
   * 엔진을 싣지 않도록 모듈은 부를 때 읽는다(runtime.ts). 끝나면 0(정상 끝), 1(시작 실패 또는 루프 실패)이다
   */
  readonly runPluginHost: (io: CommandIo) => Promise<0 | 1>;
  /**
   * `host --stdio`가 원격 주소를 받았을 때 주소를 정한다(HS-89). 실제 값은 @fresnel/host의 resolveRemoteEndpoint.
   * `--remote` 플래그가 없으면 `flag`를 넘기지 않는다
   */
  readonly resolveRemote: (options: {
    readonly flag?: string;
    readonly env: Readonly<Record<string, string | undefined>>;
  }) => Promise<RemoteResolution>;
  /** stdin/stdout을 원격 서비스에 중계한다(HS-89). 실제 값은 @fresnel/host의 bridgeStdioToService */
  readonly bridgeStdio: (options: BridgeOptions) => Promise<BridgeExit>;
  /** Ctrl+C 2회 판정(§4.6) */
  readonly clock: Clock;
  /** 개발 빌드면 참(§4.3). 컴파일 바이너리는 거짓 */
  readonly devWireRoundTrip: boolean;
  /** `fresnel version`이 보이는 Bun 버전 */
  readonly bunVersion: string;
  /**
   * 저장소 내보내기(`db export`, L4.cli.spec §4.13). 실제 값은 @fresnel/platform-store의 exportDatabase다.
   * 엔진을 띄우지 않으므로 이 함수가 원본 DB를 읽기 전용으로 연다. 모듈은 부를 때 읽는다(runtime.ts)
   * [spec에 더한 필드: M3b B3-DATA]
   */
  readonly exportDatabase: (options: ExportOptions) => Promise<Result<ExportReport, ExportError>>;
  /**
   * 저장소 되돌리기(`db restore`, L4.cli.spec §4.13). 실제 값은 @fresnel/platform-store의 restoreDatabase다.
   * 엔진을 띄우지 않고, 엔진이 떠 있으면 거절한다. 같은 함수를 나중의 설정 화면이 쓴다 [결정: 2026-11-04 사용자]
   */
  readonly restoreDatabase: (
    options: RestoreOptions,
  ) => Promise<Result<RestoreReport, RestoreError>>;
  /**
   * 데이터 디렉터리(OsDirs.data)의 절대 경로. 엔진을 띄우지도 디렉터리를 만들지도 않고 위치만 묻는다.
   * 정할 수 없으면 null이다. 실제 값은 runtime.ts가 @fresnel/platform-os의 resolveOsDirs로 정한다 [spec에 더한 필드: M3b B3-DATA]
   */
  readonly resolveDataDir: () => string | null;
  /**
   * 상태 디렉터리(OsDirs.state)의 절대 경로. 엔진 로그 폴더(`<상태>/logs`)가 여기 있다(`db usage`, L4.cli.spec §4.13.2).
   * 엔진을 띄우지 않고 위치만 묻는다. 정할 수 없으면 null이다. 실제 값은 runtime.ts가 resolveOsDirs로 정한다 [spec에 더한 필드: db usage]
   */
  readonly resolveStateDir: () => string | null;
  /** 조립 옵션 덮어쓰기. 모델 테이프와 테스트용 그룹을 넣는 자리다. 운영 진입은 넘기지 않는다 */
  readonly assemble?: EngineAssembleOverrides;
  /** CLI 상태 파일 위치. 없으면 null(@fresnel/host가 경로 API를 내기 전까지의 틈, engine.ts 참고) */
  readonly stateFile?: string | null;
}

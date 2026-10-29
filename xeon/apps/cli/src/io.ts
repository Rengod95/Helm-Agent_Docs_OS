import type { Clock, Result } from "@xeon/contracts";
import type {
  BridgeExit,
  BridgeOptions,
  CommandIo,
  HostCommand,
  HostExit,
  RemoteResolution,
  StdioHostOptions,
} from "@xeon/host";
import type { ExportError, ExportOptions, ExportReport } from "@xeon/platform-store";
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

/** 그룹 생성 명령의 파일 작업이 낸 실패. path는 실패한 위치, message는 사람이 읽는 한 줄이다 */
export interface GroupIoError {
  readonly path: string;
  readonly message: string;
  /** 경로가 없어서 실패했는가(ENOENT). 없는 것을 정상으로 볼 때 쓴다 */
  readonly missing: boolean;
}

/** 대상 폴더의 상태. absent는 없음, empty는 있지만 비었음, occupied는 내용이 있거나 폴더가 아님 */
export type GroupTargetState = "absent" | "empty" | "occupied";

/**
 * `xeon group new`가 읽고 쓰는 파일 작업(L4.cli.spec §3.8, L3.slots.spec §3.3.6 R3). 템플릿 코드는 실행하지 않는다(R5).
 * 실제 값은 group/fs-port.ts(runtime.ts가 조립한다), 시험은 메모리 가짜를 넣는다.
 */
export interface GroupTemplatesPort {
  /** `templates/index.json` 텍스트. 템플릿 위치를 찾지 못하면 실패다 */
  readIndex(): Promise<Result<string, GroupIoError>>;
  /** templates/ 기준 상대 경로의 파일 바이트 */
  readTemplateFile(rel: string): Promise<Result<Uint8Array, GroupIoError>>;
  /**
   * 설치된 확장 이름(사용자 확장 폴더와 작업 폴더의 `.xeon/extensions`, 기본 그룹 이름 포함). 같은 이름을 쓸 수 없다(R2).
   * 매니페스트가 없는 폴더는 건너뛰고, 있는데 읽지 못하면 실패다
   */
  installedExtensionNames(workspace: string): Promise<Result<readonly string[], GroupIoError>>;
  targetState(path: string): Promise<Result<GroupTargetState, GroupIoError>>;
  makeDir(path: string): Promise<Result<void, GroupIoError>>;
  /** 상위 폴더가 없으면 만든다 */
  writeFile(path: string, bytes: Uint8Array): Promise<Result<void, GroupIoError>>;
  /** 폴더 아래를 모두 지운다. keepRoot가 참이면 폴더 자체는 남긴다(처음부터 있던 빈 폴더를 지키려고) */
  removeDir(
    path: string,
    options: { readonly keepRoot: boolean },
  ): Promise<Result<void, GroupIoError>>;
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
  /** `xeon group new`의 파일 작업. 실제 값은 group/fs-port.ts, 시험은 메모리 가짜 */
  readonly groupTemplates: GroupTemplatesPort;
  /** Ctrl+C 2회 판정(§4.6) */
  readonly clock: Clock;
  /** 개발 빌드면 참(§4.3). 컴파일 바이너리는 거짓 */
  readonly devWireRoundTrip: boolean;
  /** `xeon version`이 보이는 Bun 버전 */
  readonly bunVersion: string;
  /**
   * 저장소 내보내기(`db export`, L4.cli.spec §4.13). 실제 값은 @xeon/platform-store의 exportDatabase다.
   * 엔진을 띄우지 않으므로 이 함수가 원본 DB를 읽기 전용으로 연다. 모듈은 부를 때 읽는다(runtime.ts)
   * [spec에 더한 필드: M3b B3-DATA]
   */
  readonly exportDatabase: (options: ExportOptions) => Promise<Result<ExportReport, ExportError>>;
  /**
   * 데이터 디렉터리(OsDirs.data)의 절대 경로. 엔진을 띄우지도 디렉터리를 만들지도 않고 위치만 묻는다.
   * 정할 수 없으면 null이다. 실제 값은 runtime.ts가 @xeon/platform-os의 resolveOsDirs로 정한다 [spec에 더한 필드: M3b B3-DATA]
   */
  readonly resolveDataDir: () => string | null;
  /** 조립 옵션 덮어쓰기. 모델 테이프와 테스트용 그룹을 넣는 자리다. 운영 진입은 넘기지 않는다 */
  readonly assemble?: EngineAssembleOverrides;
  /** CLI 상태 파일 위치. 없으면 null(@xeon/host가 경로 API를 내기 전까지의 틈, engine.ts 참고) */
  readonly stateFile?: string | null;
}

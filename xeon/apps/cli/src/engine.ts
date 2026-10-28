import { assertNever, attemptAsync, err, ok, type Clock, type Result } from "@xeon/contracts";
import type { SecretOutOfBandPort } from "@xeon/contracts/services";
import type { SettingDefInput, SettingGroup } from "@xeon/contracts/settings";
import {
  checkEnvelope,
  WIRE_PROTOCOL_VERSION,
  WireError,
  type HostConnection,
  type JsonRpcMessage,
  type StoreId,
  type Transport,
  type TransportKind,
} from "@xeon/contracts/wire";
import type { IdFactory } from "@xeon/contracts/conversation";
import {
  AssembleError,
  startInProcessHost,
  type AssembleIssue,
  resolveHostStatePaths,
  type AssembleOptions,
  type HostPluginModule,
  type HostStatePathError,
  type HostStatePaths,
  type ResolveHostStatePathsOptions,
} from "@xeon/host";
import { createHostConnection, type HostConnectionOptions } from "./host-client.ts";

// L4.cli.spec §3.3. 엔진 연결: @xeon/host의 공개 API를 조합한다. CLI는 엔진 객체를 다루지 않고 HostConnection만 쓴다.
// EngineConnector 같은 이름은 @xeon/host에 없다. 연결 타입과 오류 문구는 CLI 안의 이름이다(L4.host-service.spec §3.3.5).

type ConnectPreference = "auto" | "in-process" | "service";

/**
 * 조립 옵션 덮어쓰기. 모델 테이프 provider와 테스트용 그룹을 extraPlugins로 넣는 자리다(L4.host-service.spec §3.3.1,
 * L4.cli.plan §5.2). 테이프를 만드는 코드는 @xeon/core-models/testing에 있어 CLI 소스가 import할 수 없다(DR-08, DR-14):
 * 그것을 만드는 테스트 진입(scenario-main)이 이 자리로 넘긴다.
 */
export interface EngineAssembleOverrides {
  readonly dataDir?: string;
  readonly extraPlugins?: readonly HostPluginModule[];
  /** 모델 테이프 provider를 더한 pi-ai 모델 모음 팩토리(AssembleOptions.buildModels) */
  readonly buildModels?: AssembleOptions["buildModels"];
  readonly defaultGroups?: boolean;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
}

export interface EngineConnectOptions {
  /** 작업 폴더 절대 경로 */
  readonly workspace: string;
  /** "auto"면 서비스 사용 설정을 엔진 없이 읽어 정한다. 서비스 모드(M3)가 없는 동안 "auto"는 in-process다 */
  readonly preference: ConnectPreference;
  readonly client: { readonly name: "xeon-cli"; readonly version: string };
  /** AssembleOptions.settingGroups로 넘긴다(§6) */
  readonly settingGroups: readonly SettingGroup<
    "l4.cli",
    Readonly<Record<string, SettingDefInput>>
  >[];
  /** AssembleOptions.devChecks로 넘긴다(F wire §3.1) */
  readonly devWireRoundTrip: boolean;
  /** CLI가 Transport를 감싸 send·onMessage를 탭한다(JSON 모드). 호스트는 관여하지 않는다 */
  readonly observe?: (message: JsonRpcMessage) => void;
  readonly assemble?: EngineAssembleOverrides;
  /**
   * 테스트 격리용 CLI 상태 파일 덮어쓰기(환경 변수 XEON_CLI_STATE_FILE). 경로 계산(OS 분기)은 CLI가 하지 않는다(DR-13).
   * 없으면 `@xeon/host`의 `resolveHostStatePaths()`가 정한 `<OsDirs.state>/cli/state.json`을 쓴다 [결정: review.decisions-2 B-07]
   */
  readonly stateFile?: string | null;
}

export type EngineStartErrorKind =
  | "fts5Missing"
  | "sopsMissing"
  | "dataDirPermission"
  | "storeUnavailable"
  | "catalogConflict"
  | "missingService"
  /** 플러그인 설치 실패(AssembleIssue "plugin"). spec의 kind 목록에 더한 값이다 */
  | "pluginFailed"
  | "serviceUnreachable"
  | "protocolUnsupported";

export interface EngineStartError {
  readonly kind: EngineStartErrorKind;
  /** 한 줄 */
  readonly message: string;
  /** 한 줄 */
  readonly fix: string;
}

export interface EngineHandle {
  /** host.hello까지 마친 연결 */
  readonly connection: HostConnection;
  /** "in-process" | "socket" */
  readonly transport: TransportKind;
  /** host.hello 결과의 storeId */
  readonly storeId: StoreId;
  readonly paths: { readonly cliStateFile: string };
  /**
   * 값 입력·열람 수단을 wire 밖으로 호스트에 맡기는 통로(F wire §3.3.1). in-process 접속에만 있고 서비스 접속은 null이다:
   * 서비스 쪽 L0.secrets가 OS 입력 창으로 받는다(L4.cli.spec §4.7) [spec에 더한 필드]
   */
  readonly secretOutOfBand: SecretOutOfBandPort | null;
  /** host.hello가 알린 active·experimental 기능 이름(메서드 이름 포함). 호스트가 아직 구현하지 않은 메서드를 가려낸다 [spec에 더한 필드] */
  supports(feature: string): boolean;
  /** 엔진의 시계. CLI는 전역 시각을 읽지 않는다(TY-21) [spec에 더한 필드] */
  readonly clock: Clock;
  /** turn.start의 requestId로 쓸 새 id. 엔진의 IdFactory가 낸다 [spec에 더한 필드] */
  newRequestId(): string;
  /** in-process면 InProcessHost.close(), socket이면 HostConnection.close()만 한다. 닫는 데 실패하면 원인을 실어 던진다("deadline"이 아니다) */
  shutdown(reason: "user" | "signal"): Promise<"clean" | "deadline">;
}

export type ConnectEngine = (
  options: EngineConnectOptions,
) => Promise<Result<EngineHandle, EngineStartError>>;

/**
 * CLI가 시작한 in-process 호스트에서 쓰는 부분. 실제 InProcessHost가 이 모양을 만족한다. 엔진 전체(Engine)를 좁혀
 * 시험이 가짜를 쉽게 만들게 하고, CLI가 엔진 객체를 다루지 않는다는 규칙(adr.0006 §3.2)을 타입으로도 드러낸다.
 */
export interface StartedHost {
  /** kind "in-process". createHostConnection에 넘긴다 */
  readonly client: Transport;
  /** 값 입력·열람 수단을 맡기는 통로. InProcessHost가 이 모양을 만족한다 */
  readonly secretOutOfBand: SecretOutOfBandPort;
  readonly engine: {
    readonly ports: {
      /** turn.start의 requestId를 만들 때 쓴다 */
      readonly ids: { next(prefix: "evt"): string };
      readonly clock: Clock;
    };
  };
  /** 진행 중 turn이 시한 안에 멈추지 않았으면 "deadline"이다 */
  close(): Promise<"clean" | "deadline">;
}

/** @xeon/host 호출을 바꿔 끼울 수 있게 한 틈. 테스트가 가짜를 넣는다 */
export interface HostApi {
  startInProcessHost(options?: Omit<AssembleOptions, "mode">): Promise<StartedHost>;
  /** CLI 상태 파일 위치와 상태 디렉터리 준비(L4.host-service.spec §3.3.6) */
  resolveHostStatePaths(
    options?: ResolveHostStatePathsOptions,
  ): Promise<Result<HostStatePaths, HostStatePathError>>;
  createHostConnection(transport: Transport, options?: HostConnectionOptions): HostConnection;
}

const REAL_HOST_API: HostApi = {
  startInProcessHost,
  resolveHostStatePaths,
  createHostConnection,
};

/** 전송을 감싸 보내는 메시지와 받는 메시지를 모두 observe에 알린다 */
export function tapTransport(
  inner: Transport,
  observe: (message: JsonRpcMessage) => void,
): Transport {
  return {
    kind: inner.kind,
    send(message) {
      observe(message);
      return inner.send(message);
    },
    onMessage(handler) {
      return inner.onMessage((raw) => {
        const checked = checkEnvelope(raw);
        if (checked.ok) observe(checked.message);
        handler(raw);
      });
    },
    onClose: (handler) => inner.onClose(handler),
    close: (reason) => inner.close(reason),
  };
}

const ISSUE_PRIORITY: readonly AssembleIssue["code"][] = [
  "catalog",
  "store",
  "missingService",
  "plugin",
];

function firstIssue(issues: readonly AssembleIssue[]): AssembleIssue | undefined {
  for (const code of ISSUE_PRIORITY) {
    const found = issues.find((issue) => issue.code === code);
    if (found !== undefined) return found;
  }
  return issues[0];
}

function storeError(message: string): EngineStartError {
  switch (message) {
    case "fts5Missing":
      return {
        kind: "fts5Missing",
        message: "SQLite에 FTS5가 없다",
        fix: "FTS5가 들어 있는 SQLite를 설치한다 (macOS: brew install sqlite)",
      };
    case "dataDirPermission":
      return {
        kind: "dataDirPermission",
        message: "데이터 디렉터리에 쓸 수 없다",
        fix: "디렉터리 권한과 파일 시스템 종류를 확인한다",
      };
    // xeon-disable-next-line xeon/switch-default-never -- AssembleIssue 메시지 키는 문자열이다. 모르는 키는 일반 저장소 오류로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return {
        kind: "storeUnavailable",
        message: "세션 저장소를 열지 못했다",
        fix: "데이터 디렉터리와 디스크 상태를 확인하고 다시 실행한다",
      };
  }
}

/** AssembleError를 CLI의 EngineStartError로 바꾼다(L4.cli.spec §3.3 오류 대응). 순수 함수 */
export function startErrorOf(error: AssembleError): EngineStartError {
  const issue = firstIssue(error.issues);
  if (issue === undefined) {
    return {
      kind: "storeUnavailable",
      message: "엔진을 조립하지 못했다",
      fix: "다시 실행하고 계속되면 보고한다",
    };
  }
  switch (issue.code) {
    case "catalog": {
      const keys = issue.issues
        .map((entry) => ("key" in entry ? entry.key : ""))
        .filter((key) => key.length > 0)
        .slice(0, 3);
      return {
        kind: "catalogConflict",
        message: `설정 키 정의가 충돌한다${keys.length === 0 ? "" : ` (${keys.join(", ")})`}`,
        fix: "설치본이나 확장이 같은 키를 정의하지 않는지 확인한다",
      };
    }
    case "store":
      return storeError(issue.message);
    case "missingService":
      return {
        kind: "missingService",
        message: `필요한 서비스 ${issue.service}가 올라오지 않았다`,
        fix: "설치본이 온전한지 확인한다. 계속되면 이 메시지를 보고한다",
      };
    case "plugin": {
      const sops = issue.plugin === "platform-secrets" || /sops|age/i.test(issue.message);
      if (sops) {
        return {
          kind: "sopsMissing",
          message: "sops 또는 age를 찾을 수 없다",
          fix: "sops와 age를 설치한다 (macOS: brew install sops age)",
        };
      }
      return {
        kind: "pluginFailed",
        message: `플러그인 ${issue.plugin} 설치에 실패했다: ${issue.message}`,
        fix: "이 메시지를 설치본 관리자나 개발자에게 보고한다",
      };
    }
    default:
      return assertNever(issue, "AssembleIssue");
  }
}

function assembleOptionsOf(options: EngineConnectOptions): Omit<AssembleOptions, "mode"> {
  const extra = options.assemble;
  return {
    settingGroups: options.settingGroups,
    devChecks: options.devWireRoundTrip,
    ...(extra?.dataDir === undefined ? {} : { dataDir: extra.dataDir }),
    ...(extra?.extraPlugins === undefined ? {} : { extraPlugins: extra.extraPlugins }),
    ...(extra?.buildModels === undefined ? {} : { buildModels: extra.buildModels }),
    ...(extra?.defaultGroups === undefined ? {} : { defaultGroups: extra.defaultGroups }),
    ...(extra?.clock === undefined ? {} : { clock: extra.clock }),
    ...(extra?.ids === undefined ? {} : { ids: extra.ids }),
  };
}

/**
 * 호스트를 닫고 연결을 닫는다. 한쪽이 던져도 다른 쪽을 닫는다. 닫기 실패는 시한 초과가 아니므로 "deadline"으로 바꾸지 않고
 * 원인을 실어 던진다. 체크포인트 시한(HS-31)은 `InProcessHost.close()`가 재고 `host.stop_timeout`으로 기록한다.
 * close()가 그 결과를 돌려주지 않아 "deadline"은 아직 이 경로에서 나오지 않는다 [미결: L4.host-service.spec §3.3.4 close() 반환]
 */
async function closeEngine(
  host: StartedHost,
  connection: HostConnection,
): Promise<"clean" | "deadline"> {
  const failures: unknown[] = [];
  const closedHost = await attemptAsync(() => host.close());
  if (!closedHost.ok) failures.push(closedHost.error.cause);
  const closedConnection = await attemptAsync(() => connection.close());
  if (!closedConnection.ok) failures.push(closedConnection.error.cause);
  const [first] = failures;
  if (failures.length === 0) return closedHost.ok ? closedHost.value : "clean";
  if (failures.length === 1) {
    throw new Error("engine shutdown failed", { cause: first });
  }
  throw new AggregateError(failures, "engine shutdown failed: host and connection");
}

/** 상태 디렉터리를 정하거나 만들지 못한 오류를 시작 오류로 바꾼다(L4.cli.spec §4.10 표의 dataDirPermission) */
function statePathError(error: HostStatePathError): EngineStartError {
  switch (error.kind) {
    case "dirs_unavailable":
      return {
        kind: "dataDirPermission",
        message: "상태 디렉터리 위치를 정하지 못했다",
        fix: "HOME(Windows는 USERPROFILE)과 XEON_HOME 설정을 확인한다",
      };
    case "permission":
      return {
        kind: "dataDirPermission",
        message: `상태 디렉터리를 만들 수 없다 (${error.path})`,
        fix: "디렉터리 권한과 소유자를 확인한다",
      };
    default:
      return assertNever(error, "statePathError");
  }
}

/** `connectEngine`을 만든다. api는 테스트가 바꿔 끼운다 */
export function createConnectEngine(api: HostApi): ConnectEngine {
  return async (options) => {
    if (options.preference === "service") {
      return err({
        kind: "serviceUnreachable",
        message: "서비스 모드는 아직 쓸 수 없다",
        fix: "서비스 모드는 M3에서 제공한다. in-process로 실행한다",
      });
    }
    const statePaths = await api.resolveHostStatePaths(
      options.stateFile === undefined || options.stateFile === null
        ? {}
        : { cliStateFileOverride: options.stateFile },
    );
    if (!statePaths.ok) return err(statePathError(statePaths.error));
    let host: StartedHost;
    try {
      host = await api.startInProcessHost(assembleOptionsOf(options));
    } catch (caught) {
      if (caught instanceof AssembleError) return err(startErrorOf(caught));
      throw caught;
    }
    try {
      const transport =
        options.observe === undefined ? host.client : tapTransport(host.client, options.observe);
      const connection = api.createHostConnection(transport);
      const hello = await connection.request("host.hello", {
        protocolVersion: WIRE_PROTOCOL_VERSION,
        client: { name: options.client.name, version: options.client.version, kind: "cli" },
      });
      const { ids, clock } = host.engine.ports;
      const features = new Set(
        hello.features
          .filter((feature) => feature.status === "active" || feature.status === "experimental")
          .map((feature) => feature.name),
      );
      const closing: { current: Promise<"clean" | "deadline"> | undefined } = {
        current: undefined,
      };
      const handle: EngineHandle = {
        connection,
        transport: hello.transport,
        storeId: hello.storeId,
        paths: { cliStateFile: statePaths.value.cliStateFile },
        secretOutOfBand: host.secretOutOfBand,
        supports: (feature) => features.has(feature),
        clock,
        newRequestId: () => ids.next("evt"),
        shutdown(_reason) {
          closing.current ??= closeEngine(host, connection);
          return closing.current;
        },
      };
      return ok(handle);
    } catch (caught) {
      // 시작 실패가 본 오류다. 정리 중 실패는 값으로 받고 본 오류를 가리지 않는다
      await attemptAsync(() => host.close());
      if (caught instanceof WireError && caught.data.kind === "protocol.unsupported") {
        return err({
          kind: "protocolUnsupported",
          message: "CLI와 엔진의 계약 버전이 다르다",
          fix: "같은 버전의 바이너리를 쓰거나 서비스를 다시 띄운다",
        });
      }
      throw caught;
    }
  };
}

/** 실제 @xeon/host를 쓰는 connectEngine */
export const connectEngine: ConnectEngine = createConnectEngine(REAL_HOST_API);

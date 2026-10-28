import { detach, err, ok } from "@xeon/contracts";
import { McpClient, McpClientKey } from "@xeon/contracts/capabilities";
import {
  defineManifest,
  McpPortKey,
  type ExtensionEntry,
  type PortKey,
} from "@xeon/contracts/extensions";
import {
  OsPortKey,
  SecretServicePortKey,
  StoreServicePortKey,
  ToolServicePortKey,
  type RuleRegistration,
  type ToolRegistration,
} from "@xeon/contracts/services";
import type { ScopeStack } from "@xeon/contracts/settings";
import {
  createMcp,
  createSecretServiceHeaders,
  createToolServiceRegistrar,
  createTransportFactory,
  type McpMasker,
  type McpProcessPort,
  type McpRulesSink,
} from "@xeon/cap-mcp";
import { hostOf, PrimitiveError, type ExtensionUnit, type ScopeHostApi } from "@xeon/ext-host";
import { messageOf } from "../util.ts";
import { createLoaderFs, type ProjectTrust } from "./trust.ts";

// m2-plan HOST.6, L2.mcp.plan §8.5. cap-mcp는 확장 엔트리와 매니페스트를 내놓지 않는다(`createMcp(deps)`만). 이 파일이 그 몫이다:
// 포트(도구 등록, 헤더 비밀, 프로젝트 신뢰, 상태 표, 설정 층, 승인 규칙, stdio 프로세스)를 `createMcp`에 잇고, 세션 시작에 `load`, 단계를 여는
// `boundary.step.before`(광고 앞)마다 그 대화의 정의를 `reload`하고 도구 표에 `applyBoundary`로 반영하며, 종료에 `shutdown`을 부른다.
// 프로젝트 출처 정의의 기준 폴더는 그 대화의 작업 폴더다(`workspaceOf`, HS-76). 능력 `mcp.client`와 `xeon.mcp`는 `runtime.service`로 낸다.
//
// - stdio 서버(결정 D6, ADR-0011): L0 platform-process의 `createMcpProcessPort`를 조립 루트가 `options.process`로 넘긴다(`mcp-process.ts`).
//   cap-mcp는 L0를 import하지 않는다. 비밀 env를 쓰는 stdio 서버는 기동 승인 지점이 없어 `secret_denied`다(M3).
//
// 아직 없는 것:
// - `session.mcp.after` 발화: 지점 발화에는 thread가 필요한데 서버 변화는 thread에 속하지 않는다.
// 조립 루트 코드(DR-14 예외 2).

export interface HostMcpOptions {
  readonly layers: (threadId: string | undefined) => ScopeStack;
  readonly trust: ProjectTrust;
  /** 엔진 수명 신호. `load`의 `.mcp.json` 읽기와 신뢰 판정을 중단한다 */
  readonly signal: AbortSignal;
  /** 서버에 알리는 클라이언트 버전 */
  readonly version: string;
  /** 서버 도구가 쓰면 안 되는 기계 이름(내장 도구 이름) */
  readonly reservedToolNames: () => ReadonlySet<string>;
  /**
   * 대화의 작업 폴더(`threadWorkspaceOf`, HS-66). 프로젝트 출처 정의(`.mcp.json`)와 그 신뢰 판정이 이 폴더를 따른다(HS-76).
   * 작업 폴더가 없는 대화에는 프로젝트 서버가 없다
   */
  readonly workspaceOf: (threadId: string) => string | undefined;
  /** stdio 서버를 띄우는 포트(L0 platform-process). 없으면 stdio 서버는 연결에 실패한다 */
  readonly process?: McpProcessPort;
  readonly loadIndex?: number;
}

/** stdio 서버 종료 유예(SIGTERM 뒤 SIGKILL 전) */
const STDIO_GRACE_MS = 2000;

const MCP_POINTS = ["boundary.step.before"] as const;

function optionalPort<Api>(host: ScopeHostApi, key: PortKey<Api>): Api | undefined {
  try {
    return host.port(key);
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "port_unavailable") return undefined;
    throw caught;
  }
}

function manifestOf(): ReturnType<typeof defineManifest> {
  return defineManifest({
    schemaVersion: 1,
    name: "cap-mcp",
    version: "0.1.0",
    displayName: "MCP client",
    description: "Connects MCP servers and exposes their tools, prompts and resources (L2).",
    defaultEnabled: true,
    layer: "L2",
    kind: "plugin",
    entry: "./src/index.ts",
    provides: [{ id: McpClient.id, version: McpClient.version }],
    points: [...MCP_POINTS],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}

/** 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다 */
export function hostMcpPlugin(options: HostMcpOptions): ExtensionUnit {
  const manifest = manifestOf();
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const os = host.port(OsPortKey);
      const store = host.port(StoreServicePortKey);
      const tools = host.port(ToolServicePortKey);
      const secrets = optionalPort(host, SecretServicePortKey);
      const logger = os.logger("mcp");

      const masker: McpMasker = {
        mask: (text) => (secrets === undefined ? text : secrets.redactor.mask(text).text),
      };
      // 승인 모드를 권한 규칙으로 공급한다. 같은 출처로 다시 부르면 이전 규칙을 바꾼다
      const ruleState: { registration: RuleRegistration | undefined } = { registration: undefined };
      const rules: McpRulesSink = {
        set(next) {
          const registration = tools.registerRules("core:mcp", next);
          ruleState.registration = registration;
          for (const issue of registration.issues) {
            logger.warn("mcp.rule_rejected", { message: messageOf(issue) });
          }
        },
      };
      const runtime = createMcp({
        clock: os.time.clock,
        scheduler: os.time.scheduler,
        logger,
        masker,
        settings: { layers: options.layers },
        // 엔진을 열 때의 첫 로드에는 대화가 없다. 엔진의 작업 디렉터리는 프로젝트가 아니다(데스크톱 사이드카는 홈): 기본 루트를 두지 않고
        // 프로젝트 출처 정의는 대화의 첫 `boundary.step.before`에서 그 대화의 작업 폴더로 읽는다(HS-76)
        projectRoot: undefined,
        workspaceOf: options.workspaceOf,
        files: createLoaderFs(),
        trust: { isTrusted: (projectRoot, signal) => options.trust.isTrusted(projectRoot, signal) },
        transports: createTransportFactory({
          process: options.process,
          secrets: secrets === undefined ? undefined : createSecretServiceHeaders(secrets),
          scheduler: os.time.scheduler,
          fetch: undefined,
          stdioGraceMs: STDIO_GRACE_MS,
        }),
        tools: createToolServiceRegistrar({
          register: (registration) => tools.register(registration),
        }),
        continuations: undefined,
        rules,
        store,
        reservedToolNames: options.reservedToolNames,
        onServersChange: undefined,
        client: { name: "xeon", version: options.version },
        stdioGraceMs: STDIO_GRACE_MS,
      });
      host.providePort(McpPortKey, runtime.service);
      host.provide(McpClientKey, runtime.service.client);

      // 세션 시작 연결은 시작을 막지 않는다. 서버 도구는 연결되면 다음 turn 시작에 도구 표에 오른다
      detach(runtime.load(options.signal), (caught) => {
        logger.error("mcp.load_failed", { message: messageOf(caught) });
      });
      // 서버 변화는 단계 경계에서 도구 표에 반영한다(L2.mcp.spec §4.9). 단계를 여는 `boundary.step.before`(도구 광고 앞)에서 그 대화의 정의를 다시 읽어
      // 지문이 바뀌었으면 서버를 맞추고, 모아 둔 변화를 한 번에 올린다. 연결이 단계 도중에 끝나면 다음 단계의 `boundary.step.before`에 오른다.
      // `request.provider.before`는 광고 뒤라 쓰지 않는다
      g.on("boundary.step.before", async (_payload, ctx) => {
        await runtime.reload(options.signal, { threadId: ctx.threadId });
        await runtime.applyBoundary();
      });

      const registration: ToolRegistration = {
        kind: "capability",
        def: McpClient,
        key: McpClientKey,
        policy: {
          mcp_servers: { risk: "read" },
          mcp_list_resources: { risk: "read" },
          mcp_read_resource: { risk: "read" },
        },
      };
      const registered = tools.register(registration);
      if (!registered.ok) {
        return err({ reason: registered.error.kind, cause: registered.error });
      }
      g.onDispose(async () => {
        registered.value();
        ruleState.registration?.dispose();
        await runtime.shutdown();
      });
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}

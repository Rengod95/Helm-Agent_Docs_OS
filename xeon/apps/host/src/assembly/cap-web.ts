import { err, ok, parse } from "@xeon/contracts";
import {
  McpClient,
  McpClientKey,
  WebBrowse,
  WebBrowseKey,
  WebFetch,
  WebFetchKey,
  WebSearch,
  WebSearchKey,
  type ServiceKey,
} from "@xeon/contracts/capabilities";
import type { LocalIdFactory, ThreadId } from "@xeon/contracts/conversation";
import {
  defineManifest,
  type ExtensionEntry,
  type PortKey,
  type ScopeApi,
} from "@xeon/contracts/extensions";
import type { SessionService } from "@xeon/contracts/records";
import {
  ApprovalServicePortKey,
  ModelServicePortKey,
  type HostedSearchPort,
  OsPortKey,
  SecretServicePortKey,
  SessionPortKey,
  StoreServicePortKey,
  ToolServicePortKey,
  type ToolRegistration,
} from "@xeon/contracts/services";
import type { ScopeStack } from "@xeon/contracts/settings";
import {
  createAskAdapter,
  createWebRuntime,
  readWebSettings,
  webApprovalTitle,
  webManifest,
  type DnsResolver,
  type HttpTransport,
  type PluginRegistration,
  type RegistrationSource,
  type WebRuntime,
  type WebSessionSourcesPort,
} from "@xeon/cap-web";
import {
  hostOf,
  PrimitiveError,
  webProviderRegistrationOf,
  type ExtensionUnit,
  type ResourceRegistry,
  type ScopeHostApi,
} from "@xeon/ext-host";
import { Type } from "typebox";
import { createBareL2ApprovalsPort } from "./l2-approvals.ts";
import { readMcpSettings, readSettingsServers } from "@xeon/cap-mcp";
import { createBrowseConfirm } from "./web-browse-confirm.ts";
import { BROWSER_MCP_SERVER, createBrowserMcpPort } from "./web-browser-mcp.ts";
import { createWebHeaderSecrets } from "./web-header-secrets.ts";
import type { WebStatusHolder } from "./web-providers.ts";

// m2-plan HOST.6, L2.web.plan §8.5. cap-web은 확장 엔트리를 내놓지 않아(WEB.6) 조립 루트가 `createWebRuntime`에 실제 포트를 이어 붙인다:
// `xeon.store`(WebStorePort), `xeon.approvals`(도메인·URL 승인), `xeon.session` 이벤트 읽기(이미 나온 URL), `xeon.secrets`(외부 전송 마스킹),
// `xeon.models`의 hosted 검색(내장 검색 래퍼, E4), 설정 층. `web.search`의 기본 provider는 내장 검색 래퍼다: 이 조립이 `hostedSearch`를
// 넘기지 않으면 래퍼가 후보에 들지 않아 설정한 provider가 없을 때 검색할 곳이 없다(M2 마감 G1-12, H1). SearXNG와 키 API는 사용자가 설정했을 때만
// 체인에 든다(ADR-0005 개정, L2.web.spec §4.8).
// 지점 구독(결과를 바꾸지 않는 tap): `input.user.before`(나온 URL), `session.shutdown`(닫힌 세션의 보관 원문 정리와 브라우저 세션 닫기).
// 설정이 바뀌면 탐침 기억을 지운다: SearXNG를 새로 띄우거나 주소를 바꾼 뒤 실패 탐침의 30초를 기다리지 않게 한다.
// M3b(B2-WEB): 플러그인 provider 등록(`registrations`, `web_provider` 기록)과 헤더 비밀(`headerSecrets`), 브라우저 MCP(`browserMcp`,
// `playwright` 서버), 브라우저 도구(`web_browse_*`)를 잇는다. `browseConfirm`은 아직 잇지 않아 확인이 필요한 브라우저 동작은 거부된다 [미결].
// `modelTool` 판정(`boundary.step.before`)은 L1.models의 hosted 경로가 연결된 뒤에 한다. 조립 루트 코드(DR-14 예외 2).

export interface HostWebOptions {
  /** 로컬 id 발급(원장·캐시 행). platform-os의 createLocalIdFactory */
  readonly ids: LocalIdFactory;
  /** 설정 층을 호출마다 돌려준다(파일 범위와 세션 범위를 합친 스택) */
  readonly layers: (threadId: string | undefined) => ScopeStack;
  /** 시험 주입(AssembleOptions.webPorts) */
  readonly resolver?: DnsResolver;
  readonly transport?: HttpTransport;
  /** 시험 주입(AssembleOptions.webPorts): 모델 provider의 hosted 검색 대역. 생략하면 `xeon.models`의 포트다 */
  readonly hostedSearch?: HostedSearchPort;
  /** 설정이 바뀔 때마다 부른다. 돌려주는 함수로 구독을 푼다 */
  readonly onSettingsChange: (listener: () => void) => () => void;
  /** 이 엔진이 지금 쓰기 소유를 쥔 thread. `session.shutdown`에서 살아 있는 세션을 가린다 */
  readonly heldThreads: () => readonly string[];
  /**
   * 등록 기록을 읽는 자리(`ExtHost.resources`). 플러그인 provider는 `web_provider` 기록으로 남고 cap-web이 여기서 읽는다(M3-REQ-37)
   */
  readonly resources: () => ResourceRegistry | undefined;
  /** 설정 키의 유효 값. `ext.<이름>.<키>`(플러그인 설정)과 헤더 비밀 참조가 여기서 읽힌다 */
  readonly settingValue: (key: string) => unknown;
  /** 웹 런타임 자리. `web.providers` 처리기가 읽는다. 런타임이 생기면 채우고 확장을 끄면 비운다 */
  readonly status: WebStatusHolder;
  readonly loadIndex?: number;
}

/** 아직 제공되지 않은 포트는 undefined. 그 밖의 오류는 그대로 던진다 */
function optionalPort<Api>(host: ScopeHostApi, key: PortKey<Api>): Api | undefined {
  try {
    return host.port(key);
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "port_unavailable") return undefined;
    throw caught;
  }
}

/** 아직 제공되지 않은 능력 공급자는 undefined. 매니페스트 `optional`로 선언한 능력에만 부른다 */
function optionalCapability<Api>(
  scope: Pick<ScopeApi<unknown>, "capability">,
  key: ServiceKey<Api>,
): Api | undefined {
  try {
    return scope.capability(key);
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "capability_unavailable")
      return undefined;
    throw caught;
  }
}

/**
 * 플러그인이 낸 `web_provider` 기록을 cap-web의 등록 목록으로 옮긴다(M3-REQ-37). 모양이 어긋난 기록(다른 종류, 능력 ID가 셋이 아님,
 * `create`가 함수가 아님)은 `webProviderRegistrationOf`가 거르므로 여기서도 빠진다. 공급자 ID는 `plugin:<확장 이름>`이다
 */
export function webRegistrationSource(
  resources: () => Pick<ResourceRegistry, "list"> | undefined,
): RegistrationSource {
  return {
    list() {
      const found: PluginRegistration[] = [];
      for (const record of resources()?.list("web_provider") ?? []) {
        const registration = webProviderRegistrationOf(record);
        if (registration !== undefined) found.push({ extension: record.extension, registration });
      }
      return found;
    },
  };
}

/**
 * `session.shutdown`(tap). 닫히는 대화가 연 브라우저 세션을 닫고(L2.web.spec §4.10.1), 닫힌 대화가 남긴 session 보관 원문을 지운다.
 * `heldThreads`는 이 엔진이 지금 쓰기 소유를 쥔 thread다(살아 있는 세션)
 */
export async function onWebSessionShutdown(
  runtime: {
    readonly browse: Pick<WebRuntime["browse"], "closeThread">;
    readonly purgeSessionRaw: WebRuntime["purgeSessionRaw"];
  },
  heldThreads: readonly string[],
  threadId: ThreadId,
): Promise<void> {
  await runtime.browse.closeThread(threadId);
  runtime.purgeSessionRaw(new Set(heldThreads.filter((id) => id !== threadId)));
}

const RecordedSourcesSchema = Type.Object({
  output: Type.Object({
    structuredContent: Type.Object({
      sources: Type.Array(
        Type.Object({
          id: Type.String(),
          url: Type.String(),
          finalUrl: Type.Optional(Type.String()),
        }),
      ),
    }),
  }),
});

/**
 * 세션의 웹 도구 결과가 실은 Source를 이벤트에서 읽는다(L2.web.spec §4.2.1). 도구 결과는 `effect.result`의
 * `output.structuredContent`에 남는다. `sources`를 가진 것만 웹 능력의 결과다
 */
function sessionSourcesOf(session: Pick<SessionService, "readBranch">): WebSessionSourcesPort {
  return {
    async recordedSources(threadId) {
      const sources: { id: string; url: string; finalUrl?: string }[] = [];
      for await (const read of session.readBranch(threadId)) {
        if (!read.ok) return err({ kind: "read_failed", cause: read.error.kind });
        if (read.value.kind !== "effect.result") continue;
        const parsed = parse(RecordedSourcesSchema, read.value.payload);
        if (!parsed.ok) continue;
        for (const source of parsed.value.output.structuredContent.sources) {
          sources.push(
            source.finalUrl === undefined
              ? { id: source.id, url: source.url }
              : { id: source.id, url: source.url, finalUrl: source.finalUrl },
          );
        }
      }
      return ok(sources);
    },
  };
}

const WEB_POINTS = ["input.user.before", "session.shutdown"] as const;

/** 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다 */
export function hostWebPlugin(options: HostWebOptions): ExtensionUnit {
  const base = webManifest();
  const manifest = defineManifest({
    ...base,
    // 브라우저 MCP 서버(`playwright`)는 cap-mcp의 `mcp.client`로 부른다. 없으면 브라우저 후보가 빠진다
    optional: [{ id: McpClient.id, range: `^${McpClient.version}` }],
    points: [...WEB_POINTS],
  });
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const os = host.port(OsPortKey);
      const store = host.port(StoreServicePortKey);
      const session = host.port(SessionPortKey);
      const approvals = optionalPort(host, ApprovalServicePortKey);
      const secrets = optionalPort(host, SecretServicePortKey);
      const tools = optionalPort(host, ToolServicePortKey);
      const models = optionalPort(host, ModelServicePortKey);
      const mcp = optionalCapability(g, McpClientKey);
      const hostedSearch = options.hostedSearch ?? models?.hostedSearch;
      const logger = os.logger("web");
      const headerSecrets =
        secrets === undefined
          ? undefined
          : createWebHeaderSecrets({ secrets, settingValue: options.settingValue });
      const browserMcp =
        mcp === undefined
          ? undefined
          : createBrowserMcpPort({
              mcp,
              store,
              // 직접 호출 경로도 `l2.mcp` 승인 모드의 deny를 지킨다(host-service spec §10 42번)
              approvalModeOf: (tool) => {
                const layers = options.layers(undefined);
                const configured = readSettingsServers(layers).servers.find(
                  (server) => server.id === BROWSER_MCP_SERVER,
                );
                return (
                  configured?.def.tools?.approval?.[tool] ?? readMcpSettings(layers).approvalMode
                );
              },
            });

      const runtime = createWebRuntime({
        clock: os.time.clock,
        ids: options.ids,
        logger,
        settings: (threadId) => readWebSettings(options.layers(threadId)),
        sessionSources: sessionSourcesOf(session),
        store,
        ...(approvals === undefined
          ? {}
          : { asker: createAskAdapter(createBareL2ApprovalsPort(approvals, webApprovalTitle)) }),
        ...(secrets === undefined ? {} : { guard: secrets.redactor }),
        ...(headerSecrets === undefined ? {} : { headerSecrets }),
        ...(browserMcp === undefined ? {} : { browserMcp }),
        ...(approvals === undefined ? {} : { browseConfirm: createBrowseConfirm(approvals) }),
        ...(hostedSearch === undefined ? {} : { hostedSearch }),
        registrations: webRegistrationSource(options.resources),
        // 플러그인 설정 `ext.<확장 이름>.<키>`를 설정 엔진의 유효 값으로 읽는다(정의가 카탈로그에 없으면 undefined)
        extensionSetting: (extension, key) => options.settingValue(`ext.${extension}.${key}`),
        ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
        ...(options.transport === undefined ? {} : { transport: options.transport }),
      });
      host.provide(WebSearchKey, runtime.service.search);
      host.provide(WebFetchKey, runtime.service.fetch);
      host.provide(WebBrowseKey, runtime.service.browse);
      if (approvals === undefined) {
        logger.warn("web.approvals_missing", { effect: "domains that need a question are denied" });
      }
      if (hostedSearch === undefined) {
        logger.warn("web.models_missing", { effect: "the built-in search wrapper is not offered" });
      }
      if (mcp === undefined) {
        logger.warn("web.browser_mcp_missing", {
          effect: `the ${BROWSER_MCP_SERVER} browser candidate is not offered`,
        });
      }
      if (approvals === undefined) {
        logger.warn("web.browse_confirm_missing", {
          effect: "browser actions that need a confirmation are denied",
        });
      }
      if (!runtime.cacheEnabled) {
        logger.warn("web.cache_disabled", { effect: "fetch results are not cached on disk" });
      }

      // 사용자가 입력에 쓴 URL은 "대화에 나온 URL"이다(L2.web.spec §4.6.6). 패치는 돌려주지 않는다
      g.on("input.user.before", (_payload, current, ctx) => {
        runtime.deps.seen.noteText(ctx.threadId, current.text);
        return undefined;
      });

      // 대화 세션이 끝나면 그 세션이 연 브라우저 세션을 닫는다(L2.web.spec §4.10.1). 닫힌 세션이 남긴 session 보관 원문도 지운다.
      // 살아 있는 세션은 이 엔진이 지금 쓰기 소유를 쥔 thread다
      g.on("session.shutdown", (_payload, ctx) =>
        onWebSessionShutdown(runtime, options.heldThreads(), ctx.threadId),
      );
      // 설정이 바뀌면 탐침 기억(성공 5분, 실패 30초)을 지운다
      const stopSettings = options.onSettingsChange(() => {
        runtime.probes.forget();
      });

      const unregisters: (() => void)[] = [];
      if (tools === undefined) {
        logger.warn("web.tools_missing", { effect: "no tool is advertised" });
      } else {
        const registrations: readonly ToolRegistration[] = [
          {
            kind: "capability",
            def: WebSearch,
            key: WebSearchKey,
            policy: { web_search: { risk: "read" } },
          },
          {
            kind: "capability",
            def: WebFetch,
            key: WebFetchKey,
            policy: { web_fetch: { risk: "read" } },
          },
          // 브라우저 동작 도구의 위험 등급. 열기·조작·닫기는 쓰기 등급이라 기본 모드에서 승인을 거치고 plan 모드에서는 막힌다.
          // 읽기만 읽기 등급이다 [결정: 오케스트레이터 기본값]
          {
            kind: "capability",
            def: WebBrowse,
            key: WebBrowseKey,
            policy: {
              web_browse_open: { risk: "write" },
              web_browse_act: { risk: "write" },
              web_browse_read: { risk: "read" },
              web_browse_close: { risk: "write" },
            },
          },
        ];
        for (const registration of registrations) {
          const registered = tools.register(registration);
          if (!registered.ok) {
            for (const unregister of unregisters.toReversed()) unregister();
            return err({ reason: registered.error.kind, cause: registered.error });
          }
          unregisters.push(registered.value);
        }
      }
      options.status.current = runtime;
      g.onDispose(async () => {
        if (options.status.current === runtime) options.status.current = undefined;
        stopSettings();
        for (const unregister of unregisters) unregister();
        await runtime.close();
      });
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}

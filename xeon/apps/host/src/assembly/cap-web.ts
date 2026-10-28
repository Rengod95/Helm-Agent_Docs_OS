import { err, ok, parse } from "@xeon/contracts";
import { WebFetch, WebFetchKey, WebSearch, WebSearchKey } from "@xeon/contracts/capabilities";
import type { LocalIdFactory } from "@xeon/contracts/conversation";
import { defineManifest, type ExtensionEntry, type PortKey } from "@xeon/contracts/extensions";
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
  type WebSessionSourcesPort,
} from "@xeon/cap-web";
import { hostOf, PrimitiveError, type ExtensionUnit, type ScopeHostApi } from "@xeon/ext-host";
import { Type } from "typebox";
import { createBareL2ApprovalsPort } from "./l2-approvals.ts";

// m2-plan HOST.6, L2.web.plan §8.5. cap-web은 확장 엔트리를 내놓지 않아(WEB.6) 조립 루트가 `createWebRuntime`에 실제 포트를 이어 붙인다:
// `xeon.store`(WebStorePort), `xeon.approvals`(도메인·URL 승인), `xeon.session` 이벤트 읽기(이미 나온 URL), `xeon.secrets`(외부 전송 마스킹),
// `xeon.models`의 hosted 검색(내장 검색 래퍼, E4), 설정 층. `web.search`의 기본 provider는 내장 검색 래퍼다: 이 조립이 `hostedSearch`를
// 넘기지 않으면 래퍼가 후보에 들지 않아 설정한 provider가 없을 때 검색할 곳이 없다(M2 마감 G1-12, H1). SearXNG와 키 API는 사용자가 설정했을 때만
// 체인에 든다(ADR-0005 개정, L2.web.spec §4.8).
// 지점 구독(결과를 바꾸지 않는 tap): `input`(나온 URL), `session_shutdown`(닫힌 세션의 보관 원문 정리). 설정이 바뀌면 탐침 기억을
// 지운다: SearXNG를 새로 띄우거나 주소를 바꾼 뒤 실패 탐침의 30초를 기다리지 않게 한다.
// 이 조립에 없는 것: 플러그인 provider 등록 목록(`registrations`)과 그 인증 값(`headerSecrets`)은 X의 후보 등록 API가 생긴 뒤에 잇는다
// (L2.web.plan §8.5 X 레인 요청). `modelTool` 판정(`turn_start`)은 L1.models의 hosted 경로가 연결된 뒤에 한다. 조립 루트 코드(DR-14 예외 2).

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
  /** 이 엔진이 지금 쓰기 소유를 쥔 thread. `session_shutdown`에서 살아 있는 세션을 가린다 */
  readonly heldThreads: () => readonly string[];
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

const WEB_POINTS = ["input", "session_shutdown"] as const;

/** 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다 */
export function hostWebPlugin(options: HostWebOptions): ExtensionUnit {
  const manifest = defineManifest({ ...webManifest(), points: [...WEB_POINTS] });
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
      const hostedSearch = options.hostedSearch ?? models?.hostedSearch;
      const logger = os.logger("web");

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
        ...(hostedSearch === undefined ? {} : { hostedSearch }),
        ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
        ...(options.transport === undefined ? {} : { transport: options.transport }),
      });
      host.provide(WebSearchKey, runtime.service.search);
      host.provide(WebFetchKey, runtime.service.fetch);
      if (approvals === undefined) {
        logger.warn("web.approvals_missing", { effect: "domains that need a question are denied" });
      }
      if (hostedSearch === undefined) {
        logger.warn("web.models_missing", { effect: "the built-in search wrapper is not offered" });
      }
      if (!runtime.cacheEnabled) {
        logger.warn("web.cache_disabled", { effect: "fetch results are not cached on disk" });
      }

      // 사용자가 입력에 쓴 URL은 "대화에 나온 URL"이다(L2.web.spec §4.6.6). 패치는 돌려주지 않는다
      g.on("input", (_payload, current, ctx) => {
        runtime.deps.seen.noteText(ctx.threadId, current.text);
        return undefined;
      });

      // 닫힌 세션이 남긴 session 보관 원문을 지운다. 살아 있는 세션은 이 엔진이 지금 쓰기 소유를 쥔 thread다
      g.on("session_shutdown", (_payload, ctx) => {
        runtime.purgeSessionRaw(new Set(options.heldThreads().filter((id) => id !== ctx.threadId)));
      });
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
      g.onDispose(async () => {
        stopSettings();
        for (const unregister of unregisters) unregister();
        await runtime.close();
      });
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}

import { err, ok, parse } from "@xeon/contracts";
import { WebFetch, WebFetchKey, WebSearch, WebSearchKey } from "@xeon/contracts/capabilities";
import type { LocalIdFactory } from "@xeon/contracts/conversation";
import { defineManifest, type ExtensionEntry, type PortKey } from "@xeon/contracts/extensions";
import type { SessionService } from "@xeon/contracts/records";
import {
  ApprovalServicePortKey,
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
// 설정 층. 검색 provider(SearXNG, 내장 래퍼)와 `turn_start` 판정은 WEB.6이라 이 단계에는 없다: `web.search`는 provider가 없다는 실패를 돌려주고
// `web.fetch`는 끝까지 동작한다. 조립 루트 코드(DR-14 예외 2).

export interface HostWebOptions {
  /** 로컬 id 발급(원장·캐시 행). platform-os의 createLocalIdFactory */
  readonly ids: LocalIdFactory;
  /** 설정 층을 호출마다 돌려준다(파일 범위와 세션 범위를 합친 스택) */
  readonly layers: (threadId: string | undefined) => ScopeStack;
  /** 시험 주입(AssembleOptions.webPorts) */
  readonly resolver?: DnsResolver;
  readonly transport?: HttpTransport;
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

const WEB_POINTS = ["input"] as const;

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
        ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
        ...(options.transport === undefined ? {} : { transport: options.transport }),
      });
      host.provide(WebSearchKey, runtime.service.search);
      host.provide(WebFetchKey, runtime.service.fetch);
      if (approvals === undefined) {
        logger.warn("web.approvals_missing", { effect: "domains that need a question are denied" });
      }
      if (!runtime.cacheEnabled) {
        logger.warn("web.cache_disabled", { effect: "fetch results are not cached on disk" });
      }

      // 사용자가 입력에 쓴 URL은 "대화에 나온 URL"이다(L2.web.spec §4.6.6). 패치는 돌려주지 않는다
      g.on("input", (_payload, current, ctx) => {
        runtime.deps.seen.noteText(ctx.threadId, current.text);
        return undefined;
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
        for (const unregister of unregisters) unregister();
        await runtime.close();
      });
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}

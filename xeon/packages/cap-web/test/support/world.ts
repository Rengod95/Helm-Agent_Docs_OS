import type { WebFailure } from "../../src/errors.ts";
import type { CallerInfo } from "@xeon/contracts/capabilities";
import { createAccess, type Access, type AccessContext } from "../../src/policy/access.ts";
import { createContentHttp, type ContentHttp } from "../../src/policy/content-http.ts";
import { createSeenUrls, type SeenUrls } from "../../src/policy/seen-urls.ts";
import { DEFAULT_WEB_SETTINGS, type WebSettings } from "../../src/settings.ts";
import {
  fakeAsker,
  fakeSecretGuard,
  fakeSessionSources,
  type FakeAsker,
} from "../../src/testing/fake-ports.ts";
import { fakeResolver, type FakeResolver } from "../../src/testing/fake-resolver.ts";
import {
  fixtureTransport,
  type FixtureRoute,
  type FixtureTransport,
} from "../../src/testing/http-fixtures.ts";

type PolicyOverrides = Partial<WebSettings["policy"]>;

export interface WorldOptions {
  readonly policy?: PolicyOverrides;
  readonly hosts?: Readonly<Record<string, readonly string[]>>;
  readonly routes?: Readonly<Record<string, FixtureRoute>>;
  readonly asker?: FakeAsker;
  readonly secretValues?: readonly string[];
  /** 전송이 연결 시점에 호스트를 다시 풀어 검사할지. 기본 참 */
  readonly connectCheck?: boolean;
}

export interface World {
  readonly resolver: FakeResolver;
  readonly transport: FixtureTransport;
  readonly asker: FakeAsker;
  readonly access: Access;
  readonly seen: SeenUrls;
  readonly content: ContentHttp;
  readonly settings: WebSettings;
  context(overrides?: Partial<AccessContext>): AccessContext;
}

const HOST_CALLER: CallerInfo = { kind: "host" };

/** 정책·전송 시험의 공통 조립. 기본 설정은 모든 도메인을 allow로 둔다(SSRF 규칙만 보려는 시험용) */
export function makeWorld(options: WorldOptions = {}): World {
  const resolver = fakeResolver(options.hosts ?? {});
  const transport = fixtureTransport(
    options.routes ?? {},
    options.connectCheck === false ? undefined : resolver,
  );
  const asker = options.asker ?? fakeAsker("allow");
  const settings: WebSettings = {
    ...DEFAULT_WEB_SETTINGS,
    policy: { ...DEFAULT_WEB_SETTINGS.policy, allow: ["*"], ...options.policy },
  };
  const seen = createSeenUrls(fakeSessionSources());
  const access = createAccess({
    resolver,
    settings: () => settings,
    seen,
    guard: fakeSecretGuard(options.secretValues ?? []),
    asker,
  });
  const controller = new AbortController();
  return {
    resolver,
    transport,
    asker,
    access,
    seen,
    content: createContentHttp(access, transport),
    settings,
    context: (overrides = {}) => ({
      threadId: undefined,
      caller: HOST_CALLER,
      capability: "web.fetch",
      askKey: "call-1",
      signal: controller.signal,
      ...overrides,
    }),
  };
}

export const PUBLIC_IP = "93.184.216.34";

/** 실패의 detail.reason 문자열 */
export function reasonOfFailure(failure: WebFailure): string | undefined {
  const detail = failure.detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  const reason: unknown = Reflect.get(detail, "reason");
  return typeof reason === "string" ? reason : undefined;
}

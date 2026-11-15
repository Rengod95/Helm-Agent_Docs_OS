import { attempt, err, ok, type Logger, type Result } from "@fresnel/contracts";
import type { CallerInfo } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { deniedFailure, invalidInput, type WebFailure } from "../errors.ts";
import type { AskReason, WebAskPort, WebAskScope } from "../ports/ask.ts";
import type { WebPolicyWriter } from "../ports/policy-writer.ts";
import type { DnsResolver } from "../ports/resolver.ts";
import type { OutboundSecretGuard } from "../ports/secrets.ts";
import type { TransportMode } from "../ports/transport.ts";
import type { WebSettings } from "../settings.ts";
import { sha256Hex } from "../util/hash.ts";
import { decideDomain, isDomainPattern, mergeDomainRules, type DomainRules } from "./domain.ts";
import type { SeenUrls } from "./seen-urls.ts";
import {
  addressVerdict,
  checkUrlSyntax,
  resolvedVerdict,
  type AddressPolicy,
  type CheckedUrl,
  type UrlRejection,
} from "./ssrf.ts";

// L2.web.spec §4.1 3~4단계: 외부 전송 마스킹, 도메인 정책(§4.5), SSRF(§4.6), 대화에 나온 URL(§4.6.6).
// robots.txt(§4.7)는 fetch 파이프라인이 이 검사 뒤에 건다.

export interface AccessDeps {
  readonly resolver: DnsResolver;
  readonly settings: (threadId: ThreadId | undefined) => WebSettings;
  readonly seen: SeenUrls;
  /** 없으면 시크릿 값 검사를 건너뛴다(L0.secrets가 없는 조립) */
  readonly guard: OutboundSecretGuard | undefined;
  /** 없으면 ask 판정은 모두 거부한다 */
  readonly asker: WebAskPort | undefined;
  /**
   * 대화의 권한 모드가 실행 허가 성격의 승인을 덮는가(`ToolService.coversRunApprovals`) [결정: 2026-11-13 사용자].
   * 참이면 도메인 확인(`policy_ask`)과 처음 보는 URL(`unseen_url`)은 묻지 않고 허용한다. 비밀 패턴(`secret_pattern`)이
   * 이유에 있으면 모드와 무관하게 묻는다. 없으면 덮지 않는다
   */
  readonly approvalCover?: (threadId: ThreadId) => boolean;
  /** "이 사이트 계속 허용"·"모든 사이트 허용" 선택을 사용자 범위 설정에 쓴다. 없으면 두 선택은 이번만 허용과 같다 */
  readonly policyWriter?: WebPolicyWriter;
  readonly logger?: Logger;
}

export interface AccessContext {
  readonly threadId: ThreadId | undefined;
  readonly caller: CallerInfo;
  readonly capability: "web.search" | "web.fetch" | "web.browse";
  /** 승인 요청 멱등 키의 재료. 도구 호출 ID나 requestId */
  readonly askKey: string;
  /** 서브에이전트 위임 옵션의 웹 규칙(2차). 부모 규칙을 좁히기만 한다 */
  readonly agentRules?: DomainRules;
  readonly signal: AbortSignal;
}

export interface ApprovedTarget {
  readonly checked: CheckedUrl;
  /** 연결 시점 재검증이 있는 public 전송인지, 앞단이 주소를 검사한 direct 전송인지 */
  readonly mode: TransportMode;
  /** direct 전송이 연결 시점에 주소를 다시 검사하는 정책 */
  readonly addressPolicy: AddressPolicy;
}

export interface Access {
  /** 검색어·URL 문자열에 등록된 시크릿 값이 있으면 `denied`(secret_in_query). §4.1 3단계 */
  checkOutboundText(text: string): WebFailure | undefined;
  /** 처음 요청하는 콘텐츠 URL의 전체 검사 */
  authorize(rawUrl: string, ctx: AccessContext): Promise<Result<ApprovedTarget, WebFailure>>;
  /**
   * 리다이렉트 hop의 재검사: 문법, 도메인 deny, 주소. 묻지 않는다. resolveDns가 거짓이면 이름을 풀지 않고
   * IP 리터럴만 판정한다(따라가지 않을 다른 호스트의 이름을 풀어 새 질의를 보내지 않으려는 용도)
   */
  authorizeHop(
    rawUrl: string,
    ctx: AccessContext,
    options: { readonly resolveDns: boolean },
  ): Promise<Result<ApprovedTarget, WebFailure>>;
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
];

function decodedPathAndQuery(url: URL): string {
  const raw = `${url.pathname}${url.search}`;
  const decoded = attempt(() => decodeURIComponent(raw));
  return decoded.ok ? decoded.value : raw;
}

/** 쿼리 문자열이나 경로에 시크릿 패턴(키 접두 sk-, ghp_, AKIA, JWT 형태)이 보이는가(§4.6.6) */
export function hasSecretPattern(url: URL): boolean {
  const text = decodedPathAndQuery(url);
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function rejectionToFailure(rejection: UrlRejection): WebFailure {
  if (rejection.kind === "invalid_url") return invalidInput("The URL could not be parsed.");
  return deniedFailure(rejection.reason, `The URL is not allowed (${rejection.reason}).`, {
    host: rejection.host,
  });
}

export function createAccess(deps: AccessDeps): Access {
  function checkOutboundText(text: string): WebFailure | undefined {
    if (deps.guard?.containsKnown(text) === true) {
      return deniedFailure(
        "secret_in_query",
        "The request contains a registered secret value and was not sent.",
      );
    }
    return undefined;
  }

  async function resolveTarget(
    checked: CheckedUrl,
    ctx: AccessContext,
    settings: WebSettings,
    resolveDns: boolean,
  ): Promise<Result<ApprovedTarget, WebFailure>> {
    const policy = {
      allowPrivateNetwork: settings.policy.allowPrivateNetwork,
      localEndpoint: false,
    };
    if (checked.literal !== undefined) {
      const verdict = addressVerdict(checked.literal, policy);
      if (!verdict.ok) {
        return err(
          deniedFailure(verdict.reason, `The address is not allowed (${verdict.reason}).`, {
            host: checked.host,
          }),
        );
      }
      return ok({
        checked,
        mode: verdict.class === "public" ? "public" : "direct",
        addressPolicy: policy,
      });
    }
    if (!resolveDns) return ok({ checked, mode: "public", addressPolicy: policy });
    const resolved = await deps.resolver.resolve(checked.host, ctx.signal);
    if (!resolved.ok) {
      return err({
        code: "upstream_error",
        message: `The host could not be resolved: ${checked.host}`,
        retryable: false,
        detail: { reason: "dns_unresolvable", host: checked.host },
      });
    }
    const verdict = resolvedVerdict(resolved.value, policy);
    if (!verdict.ok) {
      return err(
        deniedFailure(
          verdict.reason,
          `The host resolves to a blocked address (${verdict.reason}).`,
          {
            host: checked.host,
            address: verdict.address,
          },
        ),
      );
    }
    return ok({ checked, mode: verdict.mode, addressPolicy: policy });
  }

  async function askUser(
    reasons: readonly AskReason[],
    checked: CheckedUrl,
    ctx: AccessContext,
  ): Promise<WebFailure | undefined> {
    if (ctx.threadId === undefined) {
      return deniedFailure(
        "ask_without_session",
        "Confirmation is needed but no session is attached.",
        {
          host: checked.host,
        },
      );
    }
    if (
      deps.approvalCover?.(ctx.threadId) === true &&
      reasons.every((reason) => reason !== "secret_pattern")
    ) {
      return undefined;
    }
    if (ctx.caller.agent === "background") {
      return deniedFailure("background_ask", "A background fork cannot ask for confirmation.", {
        host: checked.host,
      });
    }
    if (deps.asker === undefined) {
      return deniedFailure("ask_unavailable", "No approval channel is available.", {
        host: checked.host,
      });
    }
    const requestKey = `web-${sha256Hex(`${ctx.askKey}|${checked.host}`).slice(0, 40)}`;
    const secretLike = reasons.includes("secret_pattern");
    // 시크릿이 든 질문은 이번만 허용으로만 답할 수 있다. "계속 허용"이 비밀 확인을 건너뛰게 하지 않는다
    const scopes: readonly WebAskScope[] = secretLike
      ? ["once"]
      : isDomainPattern(checked.host)
        ? ["once", "site", "all"]
        : ["once", "all"];
    const answer = await deps.asker.ask(
      {
        threadId: ctx.threadId,
        capability: ctx.capability,
        host: checked.host,
        url: secretLike ? `${checked.url.origin}/` : checked.url.href,
        reasons,
        scopes,
        requestKey,
      },
      ctx.signal,
    );
    if (!answer.ok) {
      return deniedFailure("ask_unavailable", answer.error.message, { host: checked.host });
    }
    if (answer.value === "deny") {
      return deniedFailure("ask_denied", "The user declined this request.", { host: checked.host });
    }
    if (secretLike || answer.value === "allow") return undefined;
    // 허용 + 계속 허용 선택: 설정에 남긴다. 쓰기가 실패해도 이번 호출은 허용된 채로 진행하고 다음에 다시 묻는다
    const written =
      answer.value === "allow_site" && scopes.includes("site")
        ? await deps.policyWriter?.allowHost(checked.host)
        : answer.value === "allow_all" && scopes.includes("all")
          ? await deps.policyWriter?.allowAllSites()
          : undefined;
    if (written !== undefined && !written.ok) {
      deps.logger?.warn("web.policy_write_failed", {
        choice: answer.value,
        message: written.error.message,
      });
    }
    return undefined;
  }

  async function authorize(
    rawUrl: string,
    ctx: AccessContext,
  ): Promise<Result<ApprovedTarget, WebFailure>> {
    const settings = deps.settings(ctx.threadId);
    const syntax = checkUrlSyntax(rawUrl);
    if (!syntax.ok) return err(rejectionToFailure(syntax.error));
    const checked = syntax.value;
    const leaked = checkOutboundText(rawUrl);
    if (leaked !== undefined) return err(leaked);

    const rules = mergeDomainRules(
      { allow: settings.policy.allow, ask: settings.policy.ask, deny: settings.policy.deny },
      ctx.agentRules,
    );
    const verdict = decideDomain(rules, checked.host, settings.policy.default);
    if (verdict === "deny") {
      return err(
        deniedFailure("domain_denied", `The domain policy denies ${checked.host}.`, {
          host: checked.host,
        }),
      );
    }
    const reasons: AskReason[] = [];
    if (verdict === "ask") reasons.push("policy_ask");

    // 모델 도구 경로: 대화에 나온 적 없는 URL(§4.6.6). 확장·호스트 호출은 대화가 없어 적용하지 않는다
    if (ctx.caller.kind === "model" && ctx.threadId !== undefined) {
      const mode = settings.policy.unseenUrl;
      // 기본값이 allow("모든 사이트 허용")면 처음 보는 URL 확인(ask)도 함께 끈다. deny는 그대로 막는다
      if (mode !== "allow" && !(mode === "ask" && settings.policy.default === "allow")) {
        const seen = await deps.seen.has(ctx.threadId, rawUrl);
        if (!seen.ok) {
          return err({
            code: "unavailable",
            message: "The session history could not be read.",
            retryable: true,
            detail: { reason: seen.error.kind },
          });
        }
        if (!seen.value) {
          if (mode === "deny") {
            return err(
              deniedFailure("unseen_url", "This URL has not appeared in the conversation.", {
                host: checked.host,
              }),
            );
          }
          reasons.push("unseen_url");
        }
      }
    }
    if (hasSecretPattern(checked.url)) reasons.push("secret_pattern");

    if (reasons.length > 0) {
      const refusal = await askUser(reasons, checked, ctx);
      if (refusal !== undefined) return err(refusal);
    }
    return resolveTarget(checked, ctx, settings, true);
  }

  async function authorizeHop(
    rawUrl: string,
    ctx: AccessContext,
    options: { readonly resolveDns: boolean },
  ): Promise<Result<ApprovedTarget, WebFailure>> {
    const settings = deps.settings(ctx.threadId);
    const syntax = checkUrlSyntax(rawUrl);
    if (!syntax.ok) return err(rejectionToFailure(syntax.error));
    const checked = syntax.value;
    const rules = mergeDomainRules(
      { allow: settings.policy.allow, ask: settings.policy.ask, deny: settings.policy.deny },
      ctx.agentRules,
    );
    if (decideDomain(rules, checked.host, settings.policy.default) === "deny") {
      return err(
        deniedFailure("domain_denied", `The domain policy denies ${checked.host}.`, {
          host: checked.host,
        }),
      );
    }
    return resolveTarget(checked, ctx, settings, options.resolveDns);
  }

  return { checkOutboundText, authorize, authorizeHop };
}

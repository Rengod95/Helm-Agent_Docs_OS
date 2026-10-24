import { attempt, err, ok, repeatAsync, type Result } from "@xeon/contracts";
import type { WebFailure } from "../errors.ts";
import type { HttpTransport, TransportResponse } from "../ports/transport.ts";
import type { Access, AccessContext, ApprovedTarget } from "./access.ts";
import { transportFailureToWeb } from "./transport-errors.ts";

// L2.web.spec §4.6.4. 리다이렉트를 자동으로 따르지 않고 hop마다 정책·주소를 다시 검사한다. 같은 호스트로 가는
// 리다이렉트만 최대 5번 따르고, 다른 호스트로 가는 것은 따르지 않고 알린다.

const MAX_SAME_HOST_REDIRECTS = 5;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export interface ContentRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

export type ContentOutcome =
  | {
      readonly kind: "response";
      readonly response: TransportResponse;
      /** 같은 호스트 리다이렉트를 따라간 뒤의 URL */
      readonly finalUrl: string;
      readonly redirectsFollowed: number;
    }
  | {
      readonly kind: "redirect_not_followed";
      readonly from: string;
      readonly to: string;
      readonly status: number;
    };

export interface ContentHttp {
  /** 이미 `Access.authorize`를 통과한 첫 대상을 가져온다 */
  get(
    start: ApprovedTarget,
    request: ContentRequest,
    ctx: AccessContext,
  ): Promise<Result<ContentOutcome, WebFailure>>;
}

export function createContentHttp(access: Access, transport: HttpTransport): ContentHttp {
  return {
    get(start, request, ctx) {
      let target = start;
      let redirects = 0;
      return repeatAsync<Result<ContentOutcome, WebFailure>>(async () => {
        const url = target.checked.url.href;
        const sent = await transport.send({
          method: "GET",
          url,
          headers: request.headers,
          mode: target.mode,
          addressPolicy: target.addressPolicy,
          timeoutMs: request.timeoutMs,
          maxBytes: request.maxBytes,
          signal: ctx.signal,
        });
        if (!sent.ok) return { value: err(transportFailureToWeb(sent.error, target.checked.host)) };
        const response = sent.value;
        const location = response.headers["location"];
        if (!REDIRECT_STATUSES.has(response.status) || location === undefined) {
          return {
            value: ok({ kind: "response", response, finalUrl: url, redirectsFollowed: redirects }),
          };
        }
        const parsedNext = attempt(() => new URL(location, target.checked.url));
        if (!parsedNext.ok) {
          // 읽을 수 없는 Location은 따라갈 수 없으므로 응답을 그대로 돌려준다
          return {
            value: ok({ kind: "response", response, finalUrl: url, redirectsFollowed: redirects }),
          };
        }
        const next = parsedNext.value.href;
        // 다른 호스트로 가는 리다이렉트는 따르지 않으므로 이름을 풀지 않는다. IP 리터럴과 이름 규칙만 본다
        const nextHost = parsedNext.value.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
        const sameHost = nextHost === target.checked.host;
        const checked = await access.authorizeHop(next, ctx, { resolveDns: sameHost });
        if (!checked.ok) return { value: err(checked.error) };
        if (!sameHost) {
          return {
            value: ok({
              kind: "redirect_not_followed",
              from: url,
              to: next,
              status: response.status,
            }),
          };
        }
        if (redirects >= MAX_SAME_HOST_REDIRECTS) {
          return {
            value: err({
              code: "redirect_limit",
              message: `More than ${MAX_SAME_HOST_REDIRECTS} redirects on ${target.checked.host}.`,
              retryable: false,
              detail: { host: target.checked.host },
            }),
          };
        }
        redirects += 1;
        target = checked.value;
        return undefined;
      });
    },
  };
}

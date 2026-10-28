import { err, ok, type Result } from "@xeon/contracts";
import type { SecretHandle } from "@xeon/contracts/capabilities";
import type {
  ApprovalEvidence,
  ConcreteHttpRequest,
  HttpResponseLike,
  HttpTemplate,
  SecretError,
  SecretService,
} from "@xeon/contracts/services";
import { findHandleTokens } from "./ref.ts";
import { planHttp } from "./service.ts";

// L0.secrets.spec §3.6.1 (M3-REQ-60). 웹 검색 플러그인 provider가 헤더 비밀을 쓰는 좁은 통로다. 플러그인은 설정에 `secret://<이름>`만 적고,
// 이 통로의 `send`가 전송 직전에 `SecretService.withHttp`로 값을 읽어 헤더에 치환한다. 설정을 읽는 시점에는 값을 읽지 않는다.
// 치환은 헤더만이다: URL에 핸들이 있으면 거부하고, 호스트는 메타 `use.hosts`에 맞아야 한다(withHttp 규칙).

export interface PluginHttpOptions {
  /** `UseCtx.purpose`. 메타 `use.tools`에 이 값이 허용되어 있어야 한다. 웹 검색 provider는 `web.search`다 */
  readonly purpose: string;
}

/** 호출마다 달라지는 맥락. 세션 밖 호출(서비스 모드 예약 등)은 null을 쓴다 */
export interface PluginHttpCall {
  readonly threadId: string | null;
  readonly toolCallId: string | null;
  readonly projectId: string | null;
  readonly approval: ApprovalEvidence | null;
}

export interface PluginHttp {
  /**
   * 헤더에 쓰인 비밀 핸들을 돌려준다. 값을 읽지 않는다(설정 검사와 doctor 점검용).
   * 헤더 값이 `[스킴 ]secret://<이름>` 모양이 아니거나 이름 규칙에 어긋나면 `invalid_ref`다.
   */
  headerHandles(
    headers: Readonly<Record<string, string>>,
  ): Result<readonly SecretHandle[], SecretError>;
  /** 템플릿의 헤더 핸들을 전송 직전에 값으로 바꿔 `send`를 부르고, 응답 에코를 검사한 뒤 lease를 닫는다 */
  send<T extends HttpResponseLike>(
    template: HttpTemplate,
    call: PluginHttpCall,
    send: (request: ConcreteHttpRequest) => Promise<T>,
  ): Promise<Result<{ readonly response: T; readonly echoed: boolean }, SecretError>>;
}

const PLACEHOLDER_URL = "https://placeholder.invalid/";

export function createPluginHttp(
  service: Pick<SecretService, "withHttp">,
  options: PluginHttpOptions,
): PluginHttp {
  return {
    headerHandles(headers) {
      const plan = planHttp({ method: "GET", url: PLACEHOLDER_URL, headers, body: null });
      return plan.ok ? ok(plan.value.handles) : plan;
    },
    send(template, call, send) {
      // 본문 치환은 이 통로에서 열지 않는다. 본문에 핸들이 있으면 값을 읽기 전에 거부한다
      if (typeof template.body === "string" && findHandleTokens(template.body).length > 0) {
        return Promise.resolve(err({ kind: "invalid_ref", reason: "scheme" }));
      }
      return service.withHttp(
        template,
        { ...call, purpose: options.purpose, actor: "runtime" },
        send,
      );
    },
  };
}

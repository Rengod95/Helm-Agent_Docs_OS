import { err, ok, type Result } from "@xeon/contracts";
import type { HttpTemplate, SecretError, SecretService } from "@xeon/contracts/services";
import type {
  HeaderSecretError,
  HeaderSecretSender,
  HeaderSecretTarget,
  HeaderSendResponse,
  SecretHeader,
} from "@xeon/cap-web";
import { createPluginHttp } from "@xeon/platform-secrets";

// L2.web.spec §3.6.1, L0.secrets.spec §3.6.1(M3-REQ-60). cap-web의 `HeaderSecretSender`를 L0 플러그인 HTTP 통로(`createPluginHttp`)로 옮긴다.
// 설정 값은 `secret://<이름>` 참조 문자열이고 실제 값은 `SecretService.withHttp`가 전송 직전에 헤더에 넣는다. 이 파일은 값을 만들지 않는다.
// 목적(purpose)은 세 능력이 같이 `web.search`다 [결정: 오케스트레이터 기본값]: 인터페이스가 능력별 목적을 받지 않으므로 메타 `use.tools`에
// `web.search`를 허용하면 웹 검색·가져오기·브라우즈 provider의 헤더 비밀이 모두 쓸 수 있다.

/** `UseCtx.purpose`. 메타 `use.tools`에 이 값이 허용되어 있어야 한다 */
export const WEB_SECRET_PURPOSE = "web.search";
const SECRET_PREFIX = "secret://";

export interface WebHeaderSecretDeps {
  readonly secrets: Pick<SecretService, "withHttp">;
  /** `ext.<이름>.<키>` 설정의 유효 값. 참조 문자열이 아니면 값이 없는 것으로 본다 */
  readonly settingValue: (key: string) => unknown;
}

/** 실패한 치환의 설정 키. 핸들이 맞는 설정을 찾고 못 찾으면 첫 설정이다(헤더가 여럿인 경우에만 다르다) */
function settingOfFailure(
  error: SecretError,
  refs: readonly { readonly setting: string; readonly ref: string }[],
): string {
  const handle =
    error.kind === "secret_missing" || error.kind === "denied" ? error.handle : undefined;
  const hit = refs.find((entry) => entry.ref === handle);
  return (hit ?? refs[0])?.setting ?? "";
}

/**
 * 비밀 값 자체는 오류에 싣지 않는다. `unset`은 참조가 없거나 형식이 틀리거나 제공자에 항목이 없는 경우이고, 나머지는 `unavailable`이다
 * (잠긴 키, 승인 필요, 제공자 오류 등 모두).
 */
function headerErrorOf(error: SecretError, setting: string): HeaderSecretError {
  return error.kind === "invalid_ref" || error.kind === "secret_missing"
    ? { kind: "unset", setting }
    : { kind: "unavailable", setting };
}

export function createWebHeaderSecrets(deps: WebHeaderSecretDeps): HeaderSecretSender {
  const http = createPluginHttp(deps.secrets, { purpose: WEB_SECRET_PURPOSE });
  return {
    async send<T extends HeaderSendResponse>(
      secretHeaders: readonly SecretHeader[],
      target: HeaderSecretTarget,
      // 중단 신호는 `send` 콜백이 쓴다(전송이 신호를 받는다). 치환 단계는 기다리지 않고 끝난다
      _signal: AbortSignal,
      send: (headers: Readonly<Record<string, string>>) => Promise<T>,
    ): Promise<Result<{ readonly response: T; readonly echoed: boolean }, HeaderSecretError>> {
      const headers: Record<string, string> = {};
      const refs: { readonly setting: string; readonly ref: string }[] = [];
      for (const secret of secretHeaders) {
        const ref = deps.settingValue(secret.setting);
        if (typeof ref !== "string" || !ref.startsWith(SECRET_PREFIX)) {
          return err({ kind: "unset", setting: secret.setting });
        }
        refs.push({ setting: secret.setting, ref });
        headers[secret.header.toLowerCase()] =
          secret.scheme === undefined ? ref : `${secret.scheme} ${ref}`;
      }
      // 템플릿에는 참조만 든다. 값은 `withHttp`가 `send` 콜백 인자로만 준다
      const template: HttpTemplate = {
        method: target.method,
        url: target.url,
        headers,
        body: target.body,
      };
      const sent = await http.send(
        template,
        { threadId: null, toolCallId: null, projectId: null, approval: null },
        (request) => send(request.headers),
      );
      if (!sent.ok) return err(headerErrorOf(sent.error, settingOfFailure(sent.error, refs)));
      return ok(sent.value);
    },
  };
}

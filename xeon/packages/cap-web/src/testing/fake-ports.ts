import { err, ok } from "@xeon/contracts";
import type { WebAskPort, WebAskRequest } from "../ports/ask.ts";
import type { HeaderSecretSender, OutboundSecretGuard } from "../ports/secrets.ts";
import type { RecordedSource, WebSessionSourcesPort } from "../ports/session-sources.ts";

// 시험용 포트 대역. 비밀 값은 시험 코드가 넘긴 가짜 문자열이다.

export interface FakeAsker extends WebAskPort {
  readonly requests: WebAskRequest[];
}

/** 정해진 답으로 응답하는 승인 포트. answer가 "unavailable"이면 승인 채널이 없는 것처럼 실패한다 */
export function fakeAsker(answer: "allow" | "deny" | "unavailable"): FakeAsker {
  const requests: WebAskRequest[] = [];
  return {
    requests,
    ask(request) {
      requests.push(request);
      if (answer === "unavailable") {
        return Promise.resolve(err({ kind: "unavailable", message: "no approval channel" }));
      }
      return Promise.resolve(ok(answer));
    },
  };
}

/** 등록된 비밀 값 목록. 목록의 문자열이 들어 있으면 containsKnown이 참이다 */
export function fakeSecretGuard(values: readonly string[]): OutboundSecretGuard {
  return { containsKnown: (text) => values.some((value) => text.includes(value)) };
}

/**
 * 설정 키 → 값 표의 헤더 비밀 대역. 표에 없는 설정은 unset이다. `send`에는 값을 붙인 헤더를 넘기고(Bearer 접두 포함),
 * 응답에 쓰인 값이 본문 텍스트나 헤더 값에 있으면 `echoed`가 참이다(L0 withHttp의 에코 검사와 같은 대상).
 */
export function fakeHeaderSecrets(values: Readonly<Record<string, string>>): HeaderSecretSender {
  return {
    async send(secretHeaders, _target, _signal, send) {
      const headers: Record<string, string> = {};
      const used: string[] = [];
      for (const secret of secretHeaders) {
        const value = values[secret.setting];
        if (value === undefined) return err({ kind: "unset", setting: secret.setting });
        used.push(value);
        headers[secret.header.toLowerCase()] =
          secret.scheme === "Bearer" ? `Bearer ${value}` : value;
      }
      const response = await send(headers);
      const texts = [response.bodyText ?? "", ...Object.values(response.headers)];
      const echoed = used.some((value) => texts.some((text) => text.includes(value)));
      return ok({ response, echoed });
    },
  };
}

export function fakeSessionSources(sources: readonly RecordedSource[] = []): WebSessionSourcesPort {
  return { recordedSources: () => Promise.resolve(ok(sources)) };
}

import { err, ok } from "@xeon/contracts";
import type { WebAskPort, WebAskRequest } from "../ports/ask.ts";
import type { HeaderSecretResolver, OutboundSecretGuard } from "../ports/secrets.ts";
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

/** 설정 키 → 값 표. 표에 없으면 unset이다 */
export function fakeHeaderSecrets(values: Readonly<Record<string, string>>): HeaderSecretResolver {
  return {
    valueOf(setting) {
      const value = values[setting];
      return Promise.resolve(value === undefined ? err({ kind: "unset", setting }) : ok(value));
    },
  };
}

export function fakeSessionSources(sources: readonly RecordedSource[] = []): WebSessionSourcesPort {
  return { recordedSources: () => Promise.resolve(ok(sources)) };
}

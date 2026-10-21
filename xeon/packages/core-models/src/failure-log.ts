import type { CredentialFailure } from "./secrets-bridge.ts";

// 비밀 해석 실패의 짧은 기록. pi-ai Models는 CredentialStore.read가 던진 오류의 원인을 종결 메시지에 싣지 않고
// "Credential store read failed for <provider>"로 바꾼다. 파이프라인이 호출 시작 때 표를 받아 두고, 오류 종결 뒤
// 그 사이에 같은 provider의 해석 실패가 있었는지 보아 secret_unresolved 종결 메시지를 만든다(L1.models.spec §4.7).

export interface FailureLog {
  /** 지금까지의 기록 수. 호출 시작에 받아 둔다 */
  mark(): number;
  record(failure: CredentialFailure): void;
  /** mark 이후 provider의 마지막 실패. 없으면 null */
  since(mark: number, providerId: string): CredentialFailure | null;
}

export function createFailureLog(): FailureLog {
  let count = 0;
  const latest = new Map<string, { readonly seq: number; readonly failure: CredentialFailure }>();
  return {
    mark: () => count,
    record(failure) {
      count += 1;
      latest.set(failure.providerId, { seq: count, failure });
    },
    since(mark, providerId) {
      const found = latest.get(providerId);
      return found !== undefined && found.seq > mark ? found.failure : null;
    },
  };
}
